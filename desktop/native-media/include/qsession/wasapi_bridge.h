#pragma once

#include <cstddef>

#if defined(_WIN32)
#if defined(QSESSION_WASAPI_EXPORTS)
#define QSESSION_WASAPI_API __declspec(dllexport)
#else
#define QSESSION_WASAPI_API __declspec(dllimport)
#endif
#else
#define QSESSION_WASAPI_API
#endif

extern "C" {

// Refreshes the active Windows render endpoints and returns their count.
// Returns -1 on failure; use qsession_wasapi_get_last_error for details.
QSESSION_WASAPI_API int qsession_wasapi_refresh_devices();

// Refreshes physical capture endpoints: USB interfaces, line inputs and
// microphones. Device getters below expose the most recently refreshed list.
QSESSION_WASAPI_API int qsession_wasapi_refresh_input_devices();

QSESSION_WASAPI_API int qsession_wasapi_get_device_count();
QSESSION_WASAPI_API int qsession_wasapi_get_default_device_index();

// Returns the number of wchar_t values required, including the trailing null.
// Supplying a null buffer or zero capacity only queries the required size.
QSESSION_WASAPI_API int qsession_wasapi_get_device_name(
    int index,
    wchar_t* buffer,
    int capacity);

// Starts digital loopback capture for the selected render endpoint.
QSESSION_WASAPI_API int qsession_wasapi_start_capture(int index);
// Starts direct capture for the selected physical input endpoint.
QSESSION_WASAPI_API int qsession_wasapi_start_input_capture(int index);
QSESSION_WASAPI_API void qsession_wasapi_stop_capture();
QSESSION_WASAPI_API int qsession_wasapi_is_capturing();
QSESSION_WASAPI_API void qsession_wasapi_get_levels(float* left, float* right);

// Connects the captured 48 kHz stereo signal to the QSession SFU. URL and token
// are UTF-16 and the token is never retained after the publisher stops.
QSESSION_WASAPI_API int qsession_stream_start(const wchar_t* url, const wchar_t* token);
// Connects the native publisher while optionally leaving audio to an isolated
// browser-tab publisher. Video can still be enabled on this connection.
QSESSION_WASAPI_API int qsession_stream_start_mode(
    const wchar_t* url,
    const wchar_t* token,
    int publish_audio);
QSESSION_WASAPI_API void qsession_stream_stop();
QSESSION_WASAPI_API int qsession_stream_is_connected();
QSESSION_WASAPI_API unsigned long long qsession_stream_get_dropped_frames();
QSESSION_WASAPI_API int qsession_stream_get_last_error(wchar_t* buffer, int capacity);

// Camera capture uses Windows Media Foundation. Frames are exposed as tightly
// packed, top-down BGRA so WPF and LiveKit consume exactly the same image.
QSESSION_WASAPI_API int qsession_camera_refresh_devices();
QSESSION_WASAPI_API int qsession_camera_get_device_count();
QSESSION_WASAPI_API int qsession_camera_get_device_name(int index, wchar_t* buffer, int capacity);
QSESSION_WASAPI_API int qsession_camera_start(int index);
QSESSION_WASAPI_API void qsession_camera_stop();
QSESSION_WASAPI_API int qsession_camera_is_capturing();
QSESSION_WASAPI_API int qsession_camera_get_width();
QSESSION_WASAPI_API int qsession_camera_get_height();
QSESSION_WASAPI_API float qsession_camera_get_fps();
QSESSION_WASAPI_API int qsession_camera_copy_frame(
    unsigned char* buffer,
    int capacity,
    unsigned long long* sequence);
QSESSION_WASAPI_API int qsession_camera_get_last_error(wchar_t* buffer, int capacity);

QSESSION_WASAPI_API int qsession_stream_enable_video(int width, int height);
QSESSION_WASAPI_API void qsession_stream_disable_video();
QSESSION_WASAPI_API int qsession_stream_is_video_published();
QSESSION_WASAPI_API unsigned long long qsession_stream_get_dropped_video_frames();

// Same sizing contract as qsession_wasapi_get_device_name.
QSESSION_WASAPI_API int qsession_wasapi_get_last_error(wchar_t* buffer, int capacity);

}  // extern "C"
