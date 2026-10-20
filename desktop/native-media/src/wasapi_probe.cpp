#include "qsession/wasapi_bridge.h"

#include <chrono>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

namespace {

std::wstring read_text(int (*reader)(wchar_t*, int)) {
    const int required = reader(nullptr, 0);
    if (required <= 1) {
        return {};
    }
    std::vector<wchar_t> buffer(static_cast<std::size_t>(required));
    reader(buffer.data(), required);
    return buffer.data();
}

std::wstring read_device_name(const int index) {
    const int required = qsession_wasapi_get_device_name(index, nullptr, 0);
    if (required <= 1) {
        return {};
    }
    std::vector<wchar_t> buffer(static_cast<std::size_t>(required));
    qsession_wasapi_get_device_name(index, buffer.data(), required);
    return buffer.data();
}

std::wstring read_camera_name(const int index) {
    const int required = qsession_camera_get_device_name(index, nullptr, 0);
    if (required <= 1) {
        return {};
    }
    std::vector<wchar_t> buffer(static_cast<std::size_t>(required));
    qsession_camera_get_device_name(index, buffer.data(), required);
    return buffer.data();
}

}  // namespace

int wmain(const int argc, wchar_t* argv[]) {
    if (argc > 1 && std::wstring(argv[1]) == L"--list-cameras") {
        const int camera_count = qsession_camera_refresh_devices();
        if (camera_count < 0) {
            std::wcerr << L"Error: " << read_text(qsession_camera_get_last_error) << L'\n';
            return 1;
        }
        std::wcout << L"Cámaras QSession: " << camera_count << L'\n';
        for (int index = 0; index < camera_count; ++index) {
            std::wcout << L"  " << index << L": " << read_camera_name(index) << L'\n';
        }
        return 0;
    }

    const bool input_mode = argc > 1 &&
        (std::wstring(argv[1]) == L"--list-inputs" || std::wstring(argv[1]) == L"--capture-input");
    const int count = input_mode
        ? qsession_wasapi_refresh_input_devices()
        : qsession_wasapi_refresh_devices();
    if (count < 0) {
        std::wcerr << L"Error: " << read_text(qsession_wasapi_get_last_error) << L'\n';
        return 1;
    }
    if (count == 0) {
        std::wcout << (input_mode ? L"No hay entradas de audio activas.\n"
                                  : L"No hay salidas de audio activas.\n");
        return input_mode ? 0 : 2;
    }

    const int default_index = qsession_wasapi_get_default_device_index();
    std::wcout << (input_mode ? L"Entradas de audio QSession: " : L"Salidas de audio QSession: ")
               << count << L'\n';
    for (int index = 0; index < count; ++index) {
        std::wcout << (index == default_index ? L"* " : L"  ")
                   << index << L": " << read_device_name(index) << L'\n';
    }

    const bool should_capture = argc > 1 &&
        (std::wstring(argv[1]) == L"--capture" || std::wstring(argv[1]) == L"--capture-input");
    if (!should_capture) {
        return 0;
    }

    const int selected_index = default_index >= 0 ? default_index : 0;
    const int start_result = input_mode
        ? qsession_wasapi_start_input_capture(selected_index)
        : qsession_wasapi_start_capture(selected_index);
    if (start_result != 0) {
        std::wcerr << L"Error: " << read_text(qsession_wasapi_get_last_error) << L'\n';
        return 3;
    }

    std::wcout << (input_mode ? L"Entrada física activa durante 3 segundos...\n"
                               : L"Captura digital activa durante 3 segundos...\n");
    for (int sample = 0; sample < 15; ++sample) {
        float left = 0.0F;
        float right = 0.0F;
        qsession_wasapi_get_levels(&left, &right);
        std::wcout << L"L=" << left << L" R=" << right << L'\n';
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    qsession_wasapi_stop_capture();
    return 0;
}
