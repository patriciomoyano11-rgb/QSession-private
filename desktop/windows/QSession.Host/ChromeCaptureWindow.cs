using System.Runtime.InteropServices;
using System.Text;

namespace QSession.Host;

/// <summary>
/// Keeps Chrome's protected capture surface out of the way after the user has
/// approved a tab. The media-owning window must stay alive, so it is hidden
/// instead of closed.
/// </summary>
internal static class ChromeCaptureWindow
{
    private const int SwHide = 0;
    private const int SwRestore = 9;
    private const uint WmClose = 0x0010;

    internal static bool Hide(string roomCode) => ForEach(roomCode, handle => ShowWindow(handle, SwHide));

    internal static bool Show(string roomCode) => ForEach(roomCode, handle =>
    {
        ShowWindow(handle, SwRestore);
        SetForegroundWindow(handle);
    });

    internal static bool Close(string roomCode) => ForEach(roomCode, handle => PostMessage(handle, WmClose, IntPtr.Zero, IntPtr.Zero));

    private static bool ForEach(string roomCode, Action<IntPtr> action)
    {
        string marker = $"Q Session · Captura oculta · {roomCode}";
        bool found = false;
        EnumWindows((handle, _) =>
        {
            int length = GetWindowTextLength(handle);
            if (length <= 0) return true;
            var title = new StringBuilder(length + 1);
            GetWindowText(handle, title, title.Capacity);
            if (!title.ToString().Contains(marker, StringComparison.Ordinal)) return true;
            found = true;
            action(handle);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private delegate bool EnumWindowsCallback(IntPtr handle, IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr handle, StringBuilder text, int maximumCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr handle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr handle, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr handle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
}
