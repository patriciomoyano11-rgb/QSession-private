#include "qsession/wasapi_bridge.h"

#include "qsession/livekit_publisher.h"

#include <Windows.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <future>
#include <limits>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;

constexpr int kPreferredWidth = 1280;
constexpr int kPreferredHeight = 720;
constexpr double kPreferredFps = 30.0;

struct CameraDevice final {
    std::wstring name;
    std::wstring symbolic_link;
};

std::wstring format_hresult(const wchar_t* context, const HRESULT result) {
    wchar_t code[24]{};
    swprintf_s(code, L"0x%08lX", static_cast<unsigned long>(result));
    return std::wstring(context) + L" (" + code + L")";
}

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

class CameraEngine final {
public:
    ~CameraEngine() { stop(); }

    int refresh_devices() {
        stop();
        clear_error();
        const HRESULT com_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        const bool uninitialize_com = SUCCEEDED(com_result);
        if (FAILED(com_result) && com_result != RPC_E_CHANGED_MODE) {
            set_error(format_hresult(L"No fue posible iniciar el sistema de cámaras", com_result));
            return -1;
        }
        const HRESULT startup_result = MFStartup(MF_VERSION, MFSTARTUP_LITE);
        if (FAILED(startup_result)) {
            if (uninitialize_com) {
                CoUninitialize();
            }
            set_error(format_hresult(L"No fue posible iniciar Windows Media Foundation", startup_result));
            return -1;
        }

        ComPtr<IMFAttributes> attributes;
        HRESULT result = MFCreateAttributes(&attributes, 1U);
        if (SUCCEEDED(result)) {
            result = attributes->SetGUID(
                MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
        }

        IMFActivate** activations = nullptr;
        UINT32 count = 0U;
        if (SUCCEEDED(result)) {
            result = MFEnumDeviceSources(attributes.Get(), &activations, &count);
        }

        std::vector<CameraDevice> next_devices;
        if (SUCCEEDED(result)) {
            next_devices.reserve(count);
            for (UINT32 index = 0U; index < count; ++index) {
                wchar_t* friendly_name = nullptr;
                wchar_t* symbolic_link = nullptr;
                UINT32 friendly_length = 0U;
                UINT32 link_length = 0U;
                const HRESULT name_result = activations[index]->GetAllocatedString(
                    MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
                    &friendly_name,
                    &friendly_length);
                const HRESULT link_result = activations[index]->GetAllocatedString(
                    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
                    &symbolic_link,
                    &link_length);
                if (SUCCEEDED(name_result) && SUCCEEDED(link_result) && symbolic_link != nullptr) {
                    next_devices.push_back(CameraDevice{
                        friendly_name == nullptr ? L"Cámara de Windows" : std::wstring(friendly_name),
                        std::wstring(symbolic_link),
                    });
                }
                CoTaskMemFree(friendly_name);
                CoTaskMemFree(symbolic_link);
                activations[index]->Release();
            }
        }
        CoTaskMemFree(activations);
        MFShutdown();
        if (uninitialize_com) {
            CoUninitialize();
        }

        if (FAILED(result)) {
            set_error(format_hresult(L"Windows no pudo enumerar las cámaras", result));
            return -1;
        }
        {
            std::scoped_lock lock(devices_mutex_);
            devices_ = std::move(next_devices);
            return static_cast<int>(devices_.size());
        }
    }

    [[nodiscard]] int device_count() const {
        std::scoped_lock lock(devices_mutex_);
        return static_cast<int>(devices_.size());
    }

    [[nodiscard]] std::wstring device_name(const int index) const {
        std::scoped_lock lock(devices_mutex_);
        if (index < 0 || static_cast<std::size_t>(index) >= devices_.size()) {
            return {};
        }
        return devices_[static_cast<std::size_t>(index)].name;
    }

    int start(const int index) {
        stop();
        clear_error();
        CameraDevice device;
        {
            std::scoped_lock lock(devices_mutex_);
            if (index < 0 || static_cast<std::size_t>(index) >= devices_.size()) {
                set_error(L"Selecciona una cámara válida.");
                return -1;
            }
            device = devices_[static_cast<std::size_t>(index)];
        }

        stop_requested_.store(false);
        sequence_.store(0U);
        fps_.store(0.0F);
        std::promise<int> started;
        std::future<int> result = started.get_future();
        worker_ = std::thread(
            [this, symbolic_link = std::move(device.symbolic_link), promise = std::move(started)]() mutable {
                capture_loop(symbolic_link, std::move(promise));
            });
        const int start_result = result.get();
        if (start_result != 0 && worker_.joinable()) {
            worker_.join();
        }
        return start_result;
    }

    void stop() {
        stop_requested_.store(true);
        if (worker_.joinable()) {
            worker_.join();
        }
        capturing_.store(false);
        fps_.store(0.0F);
        {
            std::scoped_lock lock(frame_mutex_);
            latest_frame_.clear();
        }
    }

    [[nodiscard]] bool is_capturing() const noexcept { return capturing_.load(); }
    [[nodiscard]] int width() const noexcept { return width_.load(); }
    [[nodiscard]] int height() const noexcept { return height_.load(); }
    [[nodiscard]] float fps() const noexcept { return fps_.load(); }

    int copy_frame(unsigned char* buffer, const int capacity, unsigned long long* sequence) const {
        std::scoped_lock lock(frame_mutex_);
        const int required = static_cast<int>(latest_frame_.size());
        if (sequence != nullptr) {
            *sequence = static_cast<unsigned long long>(sequence_.load());
        }
        if (buffer == nullptr || capacity < required || required == 0) {
            return required;
        }
        std::copy(latest_frame_.begin(), latest_frame_.end(), buffer);
        return required;
    }

    [[nodiscard]] std::wstring last_error() const {
        std::scoped_lock lock(error_mutex_);
        return last_error_;
    }

private:
    static double media_type_score(IMFMediaType* type, UINT32& width, UINT32& height, double& fps) {
        width = 0U;
        height = 0U;
        UINT32 numerator = 0U;
        UINT32 denominator = 1U;
        if (FAILED(MFGetAttributeSize(type, MF_MT_FRAME_SIZE, &width, &height)) || width == 0U || height == 0U) {
            return std::numeric_limits<double>::max();
        }
        if (FAILED(MFGetAttributeRatio(type, MF_MT_FRAME_RATE, &numerator, &denominator)) || denominator == 0U) {
            numerator = 30U;
            denominator = 1U;
        }
        fps = static_cast<double>(numerator) / static_cast<double>(denominator);
        const double size_distance = std::abs(static_cast<double>(width) - kPreferredWidth) +
                                     std::abs(static_cast<double>(height) - kPreferredHeight) * 1.4;
        const double oversize_penalty = width > 1920U || height > 1080U ? 2000.0 : 0.0;
        const double fps_penalty = std::abs(std::min(fps, kPreferredFps) - kPreferredFps) * 18.0;
        return size_distance + oversize_penalty + fps_penalty;
    }

    void capture_loop(const std::wstring& symbolic_link, std::promise<int> started) {
        bool promise_completed = false;
        const auto fail_start = [this, &started, &promise_completed](std::wstring message) {
            set_error(std::move(message));
            if (!promise_completed) {
                started.set_value(-1);
                promise_completed = true;
            }
        };

        const HRESULT com_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        const bool uninitialize_com = SUCCEEDED(com_result);
        if (FAILED(com_result) && com_result != RPC_E_CHANGED_MODE) {
            fail_start(format_hresult(L"No fue posible iniciar la cámara", com_result));
            return;
        }
        const HRESULT startup_result = MFStartup(MF_VERSION);
        if (FAILED(startup_result)) {
            fail_start(format_hresult(L"No fue posible iniciar Windows Media Foundation", startup_result));
            if (uninitialize_com) {
                CoUninitialize();
            }
            return;
        }

        ComPtr<IMFAttributes> source_attributes;
        ComPtr<IMFMediaSource> media_source;
        ComPtr<IMFAttributes> reader_attributes;
        ComPtr<IMFSourceReader> reader;
        HRESULT result = MFCreateAttributes(&source_attributes, 2U);
        if (SUCCEEDED(result)) {
            result = source_attributes->SetGUID(
                MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
        }
        if (SUCCEEDED(result)) {
            result = source_attributes->SetString(
                MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
                symbolic_link.c_str());
        }
        if (SUCCEEDED(result)) {
            result = MFCreateDeviceSource(source_attributes.Get(), &media_source);
        }
        if (SUCCEEDED(result)) {
            result = MFCreateAttributes(&reader_attributes, 2U);
        }
        if (SUCCEEDED(result)) {
            result = reader_attributes->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE);
        }
        if (SUCCEEDED(result)) {
            result = reader_attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
        }
        if (SUCCEEDED(result)) {
            result = MFCreateSourceReaderFromMediaSource(media_source.Get(), reader_attributes.Get(), &reader);
        }
        if (FAILED(result)) {
            fail_start(format_hresult(L"Windows no pudo abrir la cámara. Revisa los permisos de privacidad", result));
            media_source.Reset();
            MFShutdown();
            if (uninitialize_com) {
                CoUninitialize();
            }
            return;
        }

        ComPtr<IMFMediaType> best_type;
        UINT32 best_width = 0U;
        UINT32 best_height = 0U;
        double best_fps = 0.0;
        double best_score = std::numeric_limits<double>::max();
        for (DWORD type_index = 0U;; ++type_index) {
            ComPtr<IMFMediaType> native_type;
            const HRESULT type_result = reader->GetNativeMediaType(
                static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),
                type_index,
                &native_type);
            if (type_result == MF_E_NO_MORE_TYPES) {
                break;
            }
            if (FAILED(type_result)) {
                continue;
            }
            UINT32 candidate_width = 0U;
            UINT32 candidate_height = 0U;
            double candidate_fps = 0.0;
            const double score = media_type_score(native_type.Get(), candidate_width, candidate_height, candidate_fps);
            if (score < best_score) {
                best_score = score;
                best_type = native_type;
                best_width = candidate_width;
                best_height = candidate_height;
                best_fps = candidate_fps;
            }
        }
        if (!best_type || best_width == 0U || best_height == 0U) {
            fail_start(L"La cámara no ofrece un formato de video compatible.");
            media_source->Shutdown();
            MFShutdown();
            if (uninitialize_com) {
                CoUninitialize();
            }
            return;
        }

        result = reader->SetCurrentMediaType(
            static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM), nullptr, best_type.Get());
        ComPtr<IMFMediaType> output_type;
        if (SUCCEEDED(result)) {
            result = MFCreateMediaType(&output_type);
        }
        if (SUCCEEDED(result)) {
            result = output_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        }
        if (SUCCEEDED(result)) {
            result = output_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
        }
        if (SUCCEEDED(result)) {
            result = MFSetAttributeSize(output_type.Get(), MF_MT_FRAME_SIZE, best_width, best_height);
        }
        if (SUCCEEDED(result)) {
            const UINT32 fps_numerator = static_cast<UINT32>(std::clamp(best_fps, 1.0, kPreferredFps) * 1000.0);
            result = MFSetAttributeRatio(output_type.Get(), MF_MT_FRAME_RATE, fps_numerator, 1000U);
        }
        if (SUCCEEDED(result)) {
            result = MFSetAttributeRatio(output_type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1U, 1U);
        }
        if (SUCCEEDED(result)) {
            result = output_type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        }
        if (SUCCEEDED(result)) {
            result = reader->SetCurrentMediaType(
                static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM), nullptr, output_type.Get());
        }
        if (SUCCEEDED(result)) {
            result = reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_ALL_STREAMS), FALSE);
        }
        if (SUCCEEDED(result)) {
            result = reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM), TRUE);
        }
        if (FAILED(result)) {
            fail_start(format_hresult(L"La cámara no pudo entregar video compatible", result));
            media_source->Shutdown();
            MFShutdown();
            if (uninitialize_com) {
                CoUninitialize();
            }
            return;
        }

        width_.store(static_cast<int>(best_width));
        height_.store(static_cast<int>(best_height));
        capturing_.store(true);
        started.set_value(0);
        promise_completed = true;

        const std::size_t row_bytes = static_cast<std::size_t>(best_width) * 4U;
        const std::size_t frame_bytes = row_bytes * static_cast<std::size_t>(best_height);
        auto fps_started = std::chrono::steady_clock::now();
        unsigned int fps_frames = 0U;

        while (!stop_requested_.load()) {
            DWORD stream_index = 0U;
            DWORD flags = 0U;
            LONGLONG timestamp = 0;
            ComPtr<IMFSample> sample;
            result = reader->ReadSample(
                static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),
                0U,
                &stream_index,
                &flags,
                &timestamp,
                &sample);
            if (FAILED(result)) {
                set_error(format_hresult(L"Se interrumpió la captura de la cámara", result));
                break;
            }
            if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0U) {
                set_error(L"La cámara dejó de entregar imágenes.");
                break;
            }
            if (!sample) {
                continue;
            }

            ComPtr<IMFMediaBuffer> media_buffer;
            result = sample->ConvertToContiguousBuffer(&media_buffer);
            if (FAILED(result)) {
                continue;
            }
            std::vector<std::uint8_t> frame(frame_bytes);
            ComPtr<IMF2DBuffer> two_dimensional;
            if (SUCCEEDED(media_buffer.As(&two_dimensional))) {
                BYTE* scanline = nullptr;
                LONG pitch = 0;
                if (SUCCEEDED(two_dimensional->Lock2D(&scanline, &pitch))) {
                    for (UINT32 row = 0U; row < best_height; ++row) {
                        const auto offset = static_cast<std::ptrdiff_t>(row) * static_cast<std::ptrdiff_t>(pitch);
                        const BYTE* source_row = scanline + offset;
                        std::copy_n(
                            source_row,
                            row_bytes,
                            frame.data() + (static_cast<std::size_t>(row) * row_bytes));
                    }
                    two_dimensional->Unlock2D();
                } else {
                    continue;
                }
            } else {
                BYTE* data = nullptr;
                DWORD maximum_length = 0U;
                DWORD current_length = 0U;
                if (FAILED(media_buffer->Lock(&data, &maximum_length, &current_length))) {
                    continue;
                }
                const std::size_t available = static_cast<std::size_t>(current_length);
                if (available >= frame_bytes) {
                    std::copy_n(data, frame_bytes, frame.data());
                }
                media_buffer->Unlock();
                if (available < frame_bytes) {
                    continue;
                }
            }
            for (std::size_t alpha = 3U; alpha < frame.size(); alpha += 4U) {
                frame[alpha] = 255U;
            }
            {
                std::scoped_lock lock(frame_mutex_);
                latest_frame_ = frame;
                sequence_.fetch_add(1U);
            }
            qsession::media::publisher().capture_video_frame(
                static_cast<int>(best_width),
                static_cast<int>(best_height),
                std::move(frame));

            ++fps_frames;
            const auto now = std::chrono::steady_clock::now();
            const double seconds = std::chrono::duration<double>(now - fps_started).count();
            if (seconds >= 1.0) {
                fps_.store(static_cast<float>(static_cast<double>(fps_frames) / seconds));
                fps_frames = 0U;
                fps_started = now;
            }
        }

        capturing_.store(false);
        reader.Reset();
        media_source->Shutdown();
        media_source.Reset();
        MFShutdown();
        if (uninitialize_com) {
            CoUninitialize();
        }
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
    std::vector<CameraDevice> devices_;
    std::thread worker_;
    std::atomic<bool> stop_requested_{false};
    std::atomic<bool> capturing_{false};
    std::atomic<int> width_{0};
    std::atomic<int> height_{0};
    std::atomic<float> fps_{0.0F};
    mutable std::mutex frame_mutex_;
    std::vector<std::uint8_t> latest_frame_;
    std::atomic<std::uint64_t> sequence_{0U};
    mutable std::mutex error_mutex_;
    std::wstring last_error_;
};

CameraEngine g_camera;

}  // namespace

extern "C" {

int qsession_camera_refresh_devices() { return g_camera.refresh_devices(); }
int qsession_camera_get_device_count() { return g_camera.device_count(); }

int qsession_camera_get_device_name(const int index, wchar_t* buffer, const int capacity) {
    return copy_text(g_camera.device_name(index), buffer, capacity);
}

int qsession_camera_start(const int index) { return g_camera.start(index); }
void qsession_camera_stop() { g_camera.stop(); }
int qsession_camera_is_capturing() { return g_camera.is_capturing() ? 1 : 0; }
int qsession_camera_get_width() { return g_camera.width(); }
int qsession_camera_get_height() { return g_camera.height(); }
float qsession_camera_get_fps() { return g_camera.fps(); }

int qsession_camera_copy_frame(
    unsigned char* buffer,
    const int capacity,
    unsigned long long* sequence) {
    return g_camera.copy_frame(buffer, capacity, sequence);
}

int qsession_camera_get_last_error(wchar_t* buffer, const int capacity) {
    return copy_text(g_camera.last_error(), buffer, capacity);
}

int qsession_stream_enable_video(const int width, const int height) {
    return qsession::media::publisher().enable_video(width, height);
}

void qsession_stream_disable_video() { qsession::media::publisher().disable_video(); }
int qsession_stream_is_video_published() { return qsession::media::publisher().video_published() ? 1 : 0; }

unsigned long long qsession_stream_get_dropped_video_frames() {
    return static_cast<unsigned long long>(qsession::media::publisher().dropped_video_frames());
}

}  // extern "C"
