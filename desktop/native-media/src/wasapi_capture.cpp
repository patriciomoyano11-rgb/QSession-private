#include "qsession/wasapi_bridge.h"
#include "qsession/audio_pipeline.h"
#include "qsession/livekit_publisher.h"

#include <Windows.h>
#include <audioclient.h>
#include <propkey.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <future>
#include <mutex>
#include <span>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;

class ComApartment final {
public:
    explicit ComApartment(const DWORD model = COINIT_MULTITHREADED) noexcept
        : result_(CoInitializeEx(nullptr, model)) {}
    ~ComApartment() {
        if (SUCCEEDED(result_)) {
            CoUninitialize();
        }
    }

    [[nodiscard]] bool ready() const noexcept {
        return SUCCEEDED(result_) || result_ == RPC_E_CHANGED_MODE;
    }

    [[nodiscard]] HRESULT result() const noexcept { return result_; }

private:
    HRESULT result_;
};

struct DeviceInfo {
    std::wstring id;
    std::wstring name;
    bool is_default{};
};

struct SampleFormat {
    bool is_float{};
    std::uint16_t channels{};
    std::uint16_t bits_per_sample{};
    std::uint16_t bytes_per_sample{};
};

std::wstring format_hresult(const std::wstring& context, const HRESULT result) {
    wchar_t* system_message = nullptr;
    const DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
                        FORMAT_MESSAGE_IGNORE_INSERTS;
    const DWORD length = FormatMessageW(
        flags,
        nullptr,
        static_cast<DWORD>(result),
        MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        reinterpret_cast<wchar_t*>(&system_message),
        0,
        nullptr);

    std::wostringstream message;
    message << context << L" (0x" << std::hex << std::uppercase
            << static_cast<unsigned long>(result) << L")";
    if (length > 0U && system_message != nullptr) {
        std::wstring detail(system_message, length);
        while (!detail.empty() && (detail.back() == L'\r' || detail.back() == L'\n')) {
            detail.pop_back();
        }
        message << L": " << detail;
        LocalFree(system_message);
    }
    return message.str();
}

bool is_float_format(const WAVEFORMATEX& format) {
    if (format.wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
        return true;
    }
    if (format.wFormatTag != WAVE_FORMAT_EXTENSIBLE ||
        format.cbSize < (sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX))) {
        return false;
    }
    const auto& extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE&>(format);
    return IsEqualGUID(extensible.SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) != FALSE;
}

bool is_pcm_format(const WAVEFORMATEX& format) {
    if (format.wFormatTag == WAVE_FORMAT_PCM) {
        return true;
    }
    if (format.wFormatTag != WAVE_FORMAT_EXTENSIBLE ||
        format.cbSize < (sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX))) {
        return false;
    }
    const auto& extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE&>(format);
    return IsEqualGUID(extensible.SubFormat, KSDATAFORMAT_SUBTYPE_PCM) != FALSE;
}

float read_sample(const std::byte* frame, const std::uint16_t channel, const SampleFormat& format) {
    const std::byte* sample = frame + (static_cast<std::size_t>(channel) * format.bytes_per_sample);
    if (format.is_float && format.bits_per_sample == 32U) {
        float value{};
        std::memcpy(&value, sample, sizeof(value));
        return std::clamp(value, -1.0F, 1.0F);
    }
    if (format.is_float && format.bits_per_sample == 64U) {
        double value{};
        std::memcpy(&value, sample, sizeof(value));
        return static_cast<float>(std::clamp(value, -1.0, 1.0));
    }
    if (format.bits_per_sample == 8U) {
        const auto value = static_cast<std::uint8_t>(*sample);
        return (static_cast<float>(value) - 128.0F) / 128.0F;
    }
    if (format.bits_per_sample == 16U) {
        std::int16_t value{};
        std::memcpy(&value, sample, sizeof(value));
        return static_cast<float>(value) / 32768.0F;
    }
    if (format.bits_per_sample == 24U) {
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(sample);
        std::int32_t value = static_cast<std::int32_t>(bytes[0]) |
                             (static_cast<std::int32_t>(bytes[1]) << 8) |
                             (static_cast<std::int32_t>(bytes[2]) << 16);
        if ((value & 0x00800000) != 0) {
            value |= static_cast<std::int32_t>(0xFF000000);
        }
        return static_cast<float>(value) / 8388608.0F;
    }
    if (format.bits_per_sample == 32U) {
        std::int32_t value{};
        std::memcpy(&value, sample, sizeof(value));
        return static_cast<float>(static_cast<double>(value) / 2147483648.0);
    }
    return 0.0F;
}

class CaptureEngine final {
public:
    ~CaptureEngine() { stop_capture(); }

    int refresh_devices(const EDataFlow flow) {
        if (capturing_.load()) {
            set_error(L"Detén la captura antes de actualizar los dispositivos de audio.");
            return -1;
        }

        const bool input = flow == eCapture;

        ComApartment apartment;
        if (!apartment.ready()) {
            set_error(format_hresult(L"No se pudo iniciar COM", apartment.result()));
            return -1;
        }

        ComPtr<IMMDeviceEnumerator> enumerator;
        HRESULT result = CoCreateInstance(
            __uuidof(MMDeviceEnumerator),
            nullptr,
            CLSCTX_ALL,
            IID_PPV_ARGS(&enumerator));
        if (FAILED(result)) {
            set_error(format_hresult(L"No se pudo abrir el sistema de audio", result));
            return -1;
        }

        std::wstring default_id;
        ComPtr<IMMDevice> default_device;
        if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(flow, eMultimedia, &default_device))) {
            wchar_t* id = nullptr;
            if (SUCCEEDED(default_device->GetId(&id)) && id != nullptr) {
                default_id = id;
                CoTaskMemFree(id);
            }
        }

        ComPtr<IMMDeviceCollection> collection;
        result = enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &collection);
        if (FAILED(result)) {
            set_error(format_hresult(
                input ? L"No se pudieron enumerar las entradas de audio"
                      : L"No se pudieron enumerar las salidas de audio",
                result));
            return -1;
        }

        UINT count = 0U;
        result = collection->GetCount(&count);
        if (FAILED(result)) {
            set_error(format_hresult(
                input ? L"No se pudo leer la lista de entradas"
                      : L"No se pudo leer la lista de salidas",
                result));
            return -1;
        }

        std::vector<DeviceInfo> discovered;
        discovered.reserve(count);
        for (UINT index = 0U; index < count; ++index) {
            ComPtr<IMMDevice> device;
            if (FAILED(collection->Item(index, &device))) {
                continue;
            }

            wchar_t* id = nullptr;
            if (FAILED(device->GetId(&id)) || id == nullptr) {
                continue;
            }
            std::wstring device_id(id);
            CoTaskMemFree(id);

            std::wstring name = input ? L"Entrada de audio de Windows"
                                      : L"Salida de audio de Windows";
            ComPtr<IPropertyStore> properties;
            if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &properties))) {
                PROPVARIANT value;
                PropVariantInit(&value);
                if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &value)) &&
                    value.vt == VT_LPWSTR && value.pwszVal != nullptr) {
                    name = value.pwszVal;
                }
                PropVariantClear(&value);
            }

            discovered.push_back(DeviceInfo{
                std::move(device_id),
                std::move(name),
                discovered.empty() ? default_id.empty() : false,
            });
            discovered.back().is_default = discovered.back().id == default_id;
        }

        std::stable_sort(discovered.begin(), discovered.end(), [](const DeviceInfo& left, const DeviceInfo& right) {
            return left.is_default && !right.is_default;
        });

        {
            std::scoped_lock lock(devices_mutex_);
            devices_ = std::move(discovered);
        }
        clear_error();
        return device_count();
    }

    [[nodiscard]] int device_count() const {
        std::scoped_lock lock(devices_mutex_);
        return static_cast<int>(devices_.size());
    }

    [[nodiscard]] int default_device_index() const {
        std::scoped_lock lock(devices_mutex_);
        for (std::size_t index = 0U; index < devices_.size(); ++index) {
            if (devices_[index].is_default) {
                return static_cast<int>(index);
            }
        }
        return devices_.empty() ? -1 : 0;
    }

    [[nodiscard]] std::wstring device_name(const int index) const {
        std::scoped_lock lock(devices_mutex_);
        if (index < 0 || static_cast<std::size_t>(index) >= devices_.size()) {
            return {};
        }
        return devices_[static_cast<std::size_t>(index)].name;
    }

    int start_capture(const int index, const bool loopback) {
        stop_capture();

        std::wstring device_id;
        {
            std::scoped_lock lock(devices_mutex_);
            if (index < 0 || static_cast<std::size_t>(index) >= devices_.size()) {
                set_error(loopback ? L"Selecciona una salida de audio válida."
                                   : L"Selecciona una entrada de audio válida.");
                return -1;
            }
            device_id = devices_[static_cast<std::size_t>(index)].id;
        }

        stop_requested_.store(false);
        left_level_.store(0.0F);
        right_level_.store(0.0F);
        std::promise<int> started;
        auto ready = started.get_future();
        worker_ = std::thread(
            [this, selected_device = std::move(device_id), loopback, signal = std::move(started)]() mutable {
                capture_loop(selected_device, loopback, std::move(signal));
            });

        if (ready.wait_for(std::chrono::seconds(8)) != std::future_status::ready) {
            set_error(L"Windows tardó demasiado en iniciar la captura de audio.");
            stop_capture();
            return -1;
        }

        const int result = ready.get();
        if (result != 0 && worker_.joinable()) {
            worker_.join();
        }
        return result;
    }

    void stop_capture() {
        stop_requested_.store(true);
        if (worker_.joinable()) {
            worker_.join();
        }
        capturing_.store(false);
        left_level_.store(0.0F);
        right_level_.store(0.0F);
    }

    [[nodiscard]] bool is_capturing() const noexcept { return capturing_.load(); }

    [[nodiscard]] std::pair<float, float> levels() const noexcept {
        return {left_level_.load(), right_level_.load()};
    }

    [[nodiscard]] std::wstring last_error() const {
        std::scoped_lock lock(error_mutex_);
        return last_error_;
    }

private:
    void capture_loop(
        const std::wstring& device_id,
        const bool loopback,
        std::promise<int> started) {
        bool signaled = false;
        const auto fail = [this, &started, &signaled](const std::wstring& message) {
            set_error(message);
            if (!signaled) {
                started.set_value(-1);
                signaled = true;
            }
        };

        // Core Audio's first endpoint activation is defined on an STA thread
        // on modern Windows. The dedicated capture thread only makes
        // synchronous WASAPI calls, so it does not require a UI message pump.
        ComApartment apartment(COINIT_APARTMENTTHREADED);
        if (!apartment.ready()) {
            fail(format_hresult(L"No se pudo iniciar el hilo de audio", apartment.result()));
            return;
        }

        ComPtr<IMMDeviceEnumerator> enumerator;
        HRESULT result = CoCreateInstance(
            __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
        if (FAILED(result)) {
            fail(format_hresult(L"No se pudo abrir WASAPI", result));
            return;
        }

        ComPtr<IMMDevice> device;
        result = enumerator->GetDevice(device_id.c_str(), &device);
        if (FAILED(result)) {
            fail(format_hresult(
                loopback ? L"La salida seleccionada ya no está disponible"
                         : L"La entrada seleccionada ya no está disponible",
                result));
            return;
        }

        ComPtr<IAudioClient> audio_client;
        result = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audio_client);
        if (FAILED(result)) {
            fail(format_hresult(
                loopback ? L"No se pudo activar la salida seleccionada"
                         : L"No se pudo activar la entrada seleccionada",
                result));
            return;
        }

        WAVEFORMATEX* mix_format = nullptr;
        result = audio_client->GetMixFormat(&mix_format);
        if (FAILED(result) || mix_format == nullptr) {
            fail(format_hresult(L"No se pudo leer el formato de audio de Windows", result));
            return;
        }

        const bool float_format = is_float_format(*mix_format);
        const bool supported_sample_size =
            (float_format && (mix_format->wBitsPerSample == 32U || mix_format->wBitsPerSample == 64U)) ||
            (!float_format && (mix_format->wBitsPerSample == 8U || mix_format->wBitsPerSample == 16U ||
                               mix_format->wBitsPerSample == 24U || mix_format->wBitsPerSample == 32U));
        if ((!float_format && !is_pcm_format(*mix_format)) || mix_format->nChannels == 0U ||
            mix_format->nBlockAlign == 0U || !supported_sample_size) {
            CoTaskMemFree(mix_format);
            fail(loopback
                ? L"La salida usa un formato de audio que QSession todavía no reconoce."
                : L"La entrada usa un formato de audio que QSession todavía no reconoce.");
            return;
        }

        SampleFormat format{
            float_format,
            mix_format->nChannels,
            mix_format->wBitsPerSample,
            static_cast<std::uint16_t>(mix_format->nBlockAlign / mix_format->nChannels),
        };
        std::uint32_t source_sample_rate = mix_format->nSamplesPerSec;
        std::uint16_t block_align = mix_format->nBlockAlign;

        HANDLE sample_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        if (sample_event == nullptr) {
            CoTaskMemFree(mix_format);
            fail(L"No se pudo crear el evento de captura de Windows.");
            return;
        }

        // Event-driven zero-duration buffering is ideal for loopback. Physical
        // inputs use the broadly compatible polling contract from Microsoft's
        // WASAPI capture guidance; packets are still drained every 10 ms.
        const DWORD capture_flags = loopback
            ? AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_LOOPBACK
            : 0U;
        constexpr REFERENCE_TIME kInputBufferDuration = 0;  // engine-selected shared buffer
        bool used_audio_client3 = false;
        ComPtr<IAudioClient3> audio_client3;
        if (!loopback && SUCCEEDED(audio_client.As(&audio_client3))) {
            UINT32 default_period = 0U;
            UINT32 fundamental_period = 0U;
            UINT32 minimum_period = 0U;
            UINT32 maximum_period = 0U;
            result = audio_client3->GetSharedModeEnginePeriod(
                mix_format,
                &default_period,
                &fundamental_period,
                &minimum_period,
                &maximum_period);
            if (SUCCEEDED(result)) {
                result = audio_client3->InitializeSharedAudioStream(
                    0U,
                    default_period,
                    mix_format,
                    nullptr);
                used_audio_client3 = SUCCEEDED(result);
            }
        } else {
            result = audio_client->Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                capture_flags,
                loopback ? 0 : kInputBufferDuration,
                0,
                mix_format,
                nullptr);
        }
        bool used_legacy_stereo_format = false;
        if (FAILED(result) && !loopback && format.channels <= 2U) {
            // A few Intel/USB drivers expose a valid extensible stereo mix
            // format but reject that same descriptor on Initialize. Retry the
            // equivalent classic PCM/float descriptor on a fresh client.
            WAVEFORMATEX compatible_format = *mix_format;
            compatible_format.wFormatTag = float_format ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM;
            compatible_format.cbSize = 0U;
            audio_client3.Reset();
            audio_client.Reset();
            result = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audio_client);
            if (SUCCEEDED(result)) {
                result = audio_client->Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    0U,
                    kInputBufferDuration,
                    0,
                    &compatible_format,
                    nullptr);
                used_legacy_stereo_format = SUCCEEDED(result);
            }
        }
        bool used_engine_conversion = false;
        if (FAILED(result) && !loopback) {
            // Final shared-mode fallback: ask the Windows audio engine for the
            // QSession contract directly. This is especially useful for array
            // microphones and inexpensive USB devices with fragile drivers.
            WAVEFORMATEX contract_format{};
            contract_format.wFormatTag = WAVE_FORMAT_PCM;
            contract_format.nChannels = qsession::audio::kContractChannels;
            contract_format.nSamplesPerSec = qsession::audio::kContractSampleRate;
            contract_format.wBitsPerSample = 16U;
            contract_format.nBlockAlign = static_cast<WORD>(
                contract_format.nChannels * (contract_format.wBitsPerSample / 8U));
            contract_format.nAvgBytesPerSec =
                contract_format.nSamplesPerSec * contract_format.nBlockAlign;
            contract_format.cbSize = 0U;
            audio_client3.Reset();
            audio_client.Reset();
            result = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audio_client);
            if (SUCCEEDED(result)) {
                result = audio_client->Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                    0,
                    0,
                    &contract_format,
                    nullptr);
                if (SUCCEEDED(result)) {
                    used_engine_conversion = true;
                    format = SampleFormat{false, 2U, 16U, 2U};
                    source_sample_rate = qsession::audio::kContractSampleRate;
                    block_align = contract_format.nBlockAlign;
                }
            }
        }
        const bool event_driven = loopback;
        std::wostringstream format_detail;
        format_detail << L" [tag=" << mix_format->wFormatTag
                      << L", canales=" << mix_format->nChannels
                      << L", Hz=" << mix_format->nSamplesPerSec
                      << L", bits=" << mix_format->wBitsPerSample
                      << L", bloque=" << mix_format->nBlockAlign
                      << L", cb=" << mix_format->cbSize
                      << L", client3=" << (used_audio_client3 ? L"sí" : L"no")
                      << L", conversión=" << (used_engine_conversion ? L"sí" : L"no")
                      << L", compatible=" << (used_legacy_stereo_format ? L"sí" : L"no") << L"]";
        CoTaskMemFree(mix_format);
        if (FAILED(result)) {
            CloseHandle(sample_event);
            fail(format_hresult(
                loopback ? L"No se pudo iniciar el loopback digital"
                         : L"No se pudo iniciar la entrada física",
                result) + format_detail.str());
            return;
        }

        if (event_driven) {
            result = audio_client->SetEventHandle(sample_event);
            if (FAILED(result)) {
                CloseHandle(sample_event);
                fail(format_hresult(L"No se pudo sincronizar la captura de audio", result));
                return;
            }
        }

        ComPtr<IAudioCaptureClient> capture_client;
        result = audio_client->GetService(IID_PPV_ARGS(&capture_client));
        if (FAILED(result)) {
            CloseHandle(sample_event);
            fail(format_hresult(L"No se pudo abrir el flujo de captura", result));
            return;
        }

        result = audio_client->Start();
        if (FAILED(result)) {
            CloseHandle(sample_event);
            fail(format_hresult(L"Windows rechazó el inicio de la captura", result));
            return;
        }

        capturing_.store(true);
        clear_error();
        started.set_value(0);
        signaled = true;

        std::vector<float> resample_input;
        std::vector<float> contract_output;
        double resample_position = 0.0;

        const auto publish_contract_frames = [&contract_output]() {
            constexpr std::size_t kContractSamples =
                qsession::audio::kSamplesPerTenMillisecondFrame * qsession::audio::kContractChannels;
            while (contract_output.size() >= kContractSamples) {
                std::vector<float> frame(
                    contract_output.begin(),
                    contract_output.begin() + static_cast<std::ptrdiff_t>(kContractSamples));
                contract_output.erase(
                    contract_output.begin(),
                    contract_output.begin() + static_cast<std::ptrdiff_t>(kContractSamples));
                auto converted = qsession::audio::convert_float32_to_pcm16(frame);
                qsession::media::publisher().enqueue(std::move(converted.samples));
            }
        };

        const auto process_stereo_packet = [
            source_sample_rate,
            &resample_input,
            &contract_output,
            &resample_position,
            &publish_contract_frames](std::vector<float> stereo) {
            if (source_sample_rate == qsession::audio::kContractSampleRate) {
                contract_output.insert(contract_output.end(), stereo.begin(), stereo.end());
                publish_contract_frames();
                return;
            }

            resample_input.insert(resample_input.end(), stereo.begin(), stereo.end());
            const double source_step = static_cast<double>(source_sample_rate) /
                                       static_cast<double>(qsession::audio::kContractSampleRate);
            const std::size_t buffered_frames = resample_input.size() / 2U;
            while ((resample_position + 1.0) < static_cast<double>(buffered_frames)) {
                const auto base_frame = static_cast<std::size_t>(resample_position);
                const double fraction = resample_position - static_cast<double>(base_frame);
                for (std::size_t channel = 0U; channel < 2U; ++channel) {
                    const float first = resample_input[(base_frame * 2U) + channel];
                    const float second = resample_input[((base_frame + 1U) * 2U) + channel];
                    contract_output.push_back(static_cast<float>(
                        static_cast<double>(first) +
                        ((static_cast<double>(second) - static_cast<double>(first)) * fraction)));
                }
                resample_position += source_step;
            }

            const auto consumed_frames = static_cast<std::size_t>(resample_position);
            if (consumed_frames > 0U) {
                const auto consumed_samples = consumed_frames * 2U;
                resample_input.erase(
                    resample_input.begin(),
                    resample_input.begin() + static_cast<std::ptrdiff_t>(consumed_samples));
                resample_position -= static_cast<double>(consumed_frames);
            }
            publish_contract_frames();
        };

        while (!stop_requested_.load()) {
            const DWORD wait_result = WaitForSingleObject(sample_event, event_driven ? 150U : 10U);
            if (wait_result != WAIT_OBJECT_0 && wait_result != WAIT_TIMEOUT) {
                set_error(L"Se perdió la sincronización con la salida de audio.");
                break;
            }

            float packet_left = 0.0F;
            float packet_right = 0.0F;
            UINT32 next_packet = 0U;
            result = capture_client->GetNextPacketSize(&next_packet);
            if (FAILED(result)) {
                set_error(format_hresult(L"No se pudo leer el siguiente bloque de audio", result));
                break;
            }

            while (next_packet > 0U) {
                BYTE* data = nullptr;
                UINT32 frame_count = 0U;
                DWORD flags = 0U;
                result = capture_client->GetBuffer(&data, &frame_count, &flags, nullptr, nullptr);
                if (FAILED(result)) {
                    set_error(format_hresult(L"No se pudo leer un bloque de audio", result));
                    break;
                }

                std::vector<float> stereo_packet(static_cast<std::size_t>(frame_count) * 2U, 0.0F);
                if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0U && data != nullptr) {
                    const auto* bytes = reinterpret_cast<const std::byte*>(data);
                    for (UINT32 frame_index = 0U; frame_index < frame_count; ++frame_index) {
                        const std::byte* frame = bytes + (static_cast<std::size_t>(frame_index) * block_align);
                        const float left_sample = read_sample(frame, 0U, format);
                        const std::uint16_t right_channel = format.channels > 1U ? 1U : 0U;
                        const float right_sample = read_sample(frame, right_channel, format);
                        stereo_packet[static_cast<std::size_t>(frame_index) * 2U] = left_sample;
                        stereo_packet[(static_cast<std::size_t>(frame_index) * 2U) + 1U] = right_sample;
                        packet_left = std::max(packet_left, std::abs(left_sample));
                        packet_right = std::max(packet_right, std::abs(right_sample));
                    }
                }

                process_stereo_packet(std::move(stereo_packet));

                result = capture_client->ReleaseBuffer(frame_count);
                if (FAILED(result)) {
                    set_error(format_hresult(L"No se pudo liberar un bloque de audio", result));
                    break;
                }
                result = capture_client->GetNextPacketSize(&next_packet);
                if (FAILED(result)) {
                    set_error(format_hresult(L"No se pudo continuar la captura", result));
                    break;
                }
            }

            const float previous_left = left_level_.load();
            const float previous_right = right_level_.load();
            left_level_.store(std::max(packet_left, previous_left * 0.82F));
            right_level_.store(std::max(packet_right, previous_right * 0.82F));
        }

        audio_client->Stop();
        CloseHandle(sample_event);
        capturing_.store(false);
    }

    void set_error(std::wstring message) {
        std::scoped_lock lock(error_mutex_);
        last_error_ = std::move(message);
    }

    void clear_error() {
        std::scoped_lock lock(error_mutex_);
        last_error_.clear();
    }

    mutable std::mutex devices_mutex_;
    std::vector<DeviceInfo> devices_;
    std::thread worker_;
    std::atomic<bool> stop_requested_{false};
    std::atomic<bool> capturing_{false};
    std::atomic<float> left_level_{0.0F};
    std::atomic<float> right_level_{0.0F};
    mutable std::mutex error_mutex_;
    std::wstring last_error_;
};

CaptureEngine g_engine;

int copy_text(const std::wstring& value, wchar_t* buffer, const int capacity) {
    const int required = static_cast<int>(value.size() + 1U);
    if (buffer == nullptr || capacity <= 0) {
        return required;
    }
    const int copied = std::min(capacity - 1, static_cast<int>(value.size()));
    std::copy_n(value.data(), copied, buffer);
    buffer[copied] = L'\0';
    return required;
}

std::string narrow(const wchar_t* value) {
    if (value == nullptr || *value == L'\0') {
        return {};
    }
    const int length = static_cast<int>(std::wcslen(value));
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, length, nullptr, 0, nullptr, nullptr);
    if (size <= 0) {
        return {};
    }
    std::string result(static_cast<std::size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, length, result.data(), size, nullptr, nullptr);
    return result;
}

}  // namespace

extern "C" {

int qsession_wasapi_refresh_devices() { return g_engine.refresh_devices(eRender); }
int qsession_wasapi_refresh_input_devices() { return g_engine.refresh_devices(eCapture); }
int qsession_wasapi_get_device_count() { return g_engine.device_count(); }
int qsession_wasapi_get_default_device_index() { return g_engine.default_device_index(); }

int qsession_wasapi_get_device_name(const int index, wchar_t* buffer, const int capacity) {
    return copy_text(g_engine.device_name(index), buffer, capacity);
}

int qsession_wasapi_start_capture(const int index) { return g_engine.start_capture(index, true); }
int qsession_wasapi_start_input_capture(const int index) { return g_engine.start_capture(index, false); }
void qsession_wasapi_stop_capture() { g_engine.stop_capture(); }
int qsession_wasapi_is_capturing() { return g_engine.is_capturing() ? 1 : 0; }

void qsession_wasapi_get_levels(float* left, float* right) {
    const auto [left_value, right_value] = g_engine.levels();
    if (left != nullptr) {
        *left = left_value;
    }
    if (right != nullptr) {
        *right = right_value;
    }
}

int qsession_stream_start(const wchar_t* url, const wchar_t* token) {
    return qsession_stream_start_mode(url, token, 1);
}

int qsession_stream_start_mode(const wchar_t* url, const wchar_t* token, const int publish_audio) {
    const std::string media_url = narrow(url);
    const std::string media_token = narrow(token);
    if (media_url.empty() || media_token.empty()) {
        return -1;
    }
    return qsession::media::publisher().start(media_url, media_token, publish_audio != 0);
}

void qsession_stream_stop() { qsession::media::publisher().stop(); }
int qsession_stream_is_connected() { return qsession::media::publisher().connected() ? 1 : 0; }

unsigned long long qsession_stream_get_dropped_frames() {
    return static_cast<unsigned long long>(qsession::media::publisher().dropped_frames());
}

int qsession_stream_get_last_error(wchar_t* buffer, const int capacity) {
    return copy_text(qsession::media::publisher().last_error(), buffer, capacity);
}

int qsession_wasapi_get_last_error(wchar_t* buffer, const int capacity) {
    return copy_text(g_engine.last_error(), buffer, capacity);
}

}  // extern "C"
