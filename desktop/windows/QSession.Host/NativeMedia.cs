using System.Runtime.InteropServices;
using System.Text;

namespace QSession.Host;

internal static class NativeMedia
{
    private const string LibraryName = "QSession.Audio.dll";

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_refresh_devices", CallingConvention = CallingConvention.Cdecl)]
    private static extern int RefreshOutputDevicesNative();

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_refresh_input_devices", CallingConvention = CallingConvention.Cdecl)]
    private static extern int RefreshInputDevicesNative();

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_get_default_device_index", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int GetDefaultAudioDeviceIndex();

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_get_device_name", CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetAudioDeviceNameSize(int index, IntPtr buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_get_device_name", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetAudioDeviceNameValue(int index, StringBuilder buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_start_capture", CallingConvention = CallingConvention.Cdecl)]
    private static extern int StartOutputCaptureNative(int index);

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_start_input_capture", CallingConvention = CallingConvention.Cdecl)]
    private static extern int StartInputCaptureNative(int index);

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_stop_capture", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void StopAudioCapture();

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_is_capturing", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int IsAudioCapturing();

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_get_levels", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void GetAudioLevels(out float left, out float right);

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_get_last_error", CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetAudioErrorSize(IntPtr buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_wasapi_get_last_error", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetAudioErrorValue(StringBuilder buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_stream_start_mode", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    internal static extern int StartStream(string url, string token, int publishAudio);

    [DllImport(LibraryName, EntryPoint = "qsession_stream_stop", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void StopStream();

    [DllImport(LibraryName, EntryPoint = "qsession_stream_is_connected", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int IsStreamConnected();

    [DllImport(LibraryName, EntryPoint = "qsession_stream_get_dropped_frames", CallingConvention = CallingConvention.Cdecl)]
    internal static extern ulong GetDroppedAudioFrames();

    [DllImport(LibraryName, EntryPoint = "qsession_stream_get_last_error", CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetStreamErrorSize(IntPtr buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_stream_get_last_error", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetStreamErrorValue(StringBuilder buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_camera_refresh_devices", CallingConvention = CallingConvention.Cdecl)]
    private static extern int RefreshCamerasNative();

    [DllImport(LibraryName, EntryPoint = "qsession_camera_get_device_name", CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetCameraNameSize(int index, IntPtr buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_camera_get_device_name", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetCameraNameValue(int index, StringBuilder buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_camera_start", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int StartCamera(int index);

    [DllImport(LibraryName, EntryPoint = "qsession_camera_stop", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void StopCamera();

    [DllImport(LibraryName, EntryPoint = "qsession_camera_is_capturing", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int IsCameraCapturing();

    [DllImport(LibraryName, EntryPoint = "qsession_camera_get_width", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int GetCameraWidth();

    [DllImport(LibraryName, EntryPoint = "qsession_camera_get_height", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int GetCameraHeight();

    [DllImport(LibraryName, EntryPoint = "qsession_camera_get_last_error", CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetCameraErrorSize(IntPtr buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_camera_get_last_error", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Cdecl)]
    private static extern int GetCameraErrorValue(StringBuilder buffer, int capacity);

    [DllImport(LibraryName, EntryPoint = "qsession_stream_enable_video", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int EnableVideo(int width, int height);

    [DllImport(LibraryName, EntryPoint = "qsession_stream_disable_video", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void DisableVideo();

    [DllImport(LibraryName, EntryPoint = "qsession_stream_is_video_published", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int IsVideoPublished();

    [DllImport(LibraryName, EntryPoint = "qsession_stream_get_dropped_video_frames", CallingConvention = CallingConvention.Cdecl)]
    internal static extern ulong GetDroppedVideoFrames();

    internal static IReadOnlyList<MediaDevice> GetAudioDevices(AudioSourceKind source)
    {
        int count = source == AudioSourceKind.Output ? RefreshOutputDevicesNative() : RefreshInputDevicesNative();
        if (count < 0) throw new InvalidOperationException(GetAudioError());
        return Enumerable.Range(0, count).Select(index => new MediaDevice(index, ReadString(GetAudioDeviceNameSize, GetAudioDeviceNameValue, index, "Audio de Windows"))).ToArray();
    }

    internal static IReadOnlyList<MediaDevice> GetCameras()
    {
        int count = RefreshCamerasNative();
        if (count < 0) throw new InvalidOperationException(GetCameraError());
        return Enumerable.Range(0, count).Select(index => new MediaDevice(index, ReadString(GetCameraNameSize, GetCameraNameValue, index, "Cámara de Windows"))).ToArray();
    }

    internal static void StartAudio(AudioSourceKind source, int index)
    {
        int result = source == AudioSourceKind.Output ? StartOutputCaptureNative(index) : StartInputCaptureNative(index);
        if (result != 0) throw new InvalidOperationException(GetAudioError());
    }

    internal static string GetStreamError() => ReadError(GetStreamErrorSize, GetStreamErrorValue, "No fue posible publicar la transmisión.");
    internal static string GetAudioError() => ReadError(GetAudioErrorSize, GetAudioErrorValue, "Windows no pudo iniciar el audio.");
    internal static string GetCameraError() => ReadError(GetCameraErrorSize, GetCameraErrorValue, "Windows no pudo iniciar la cámara.");

    private delegate int StringSize(IntPtr buffer, int capacity);
    private delegate int StringValue(StringBuilder buffer, int capacity);
    private delegate int IndexedStringSize(int index, IntPtr buffer, int capacity);
    private delegate int IndexedStringValue(int index, StringBuilder buffer, int capacity);

    private static string ReadString(IndexedStringSize size, IndexedStringValue value, int index, string fallback)
    {
        int required = size(index, IntPtr.Zero, 0);
        if (required <= 1) return fallback;
        var buffer = new StringBuilder(required);
        value(index, buffer, required);
        return buffer.ToString();
    }

    private static string ReadError(StringSize size, StringValue value, string fallback)
    {
        int required = size(IntPtr.Zero, 0);
        if (required <= 1) return fallback;
        var buffer = new StringBuilder(required);
        value(buffer, required);
        return buffer.ToString();
    }
}
