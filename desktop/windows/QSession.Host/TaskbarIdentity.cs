using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace QSession.Host;

internal static class TaskbarIdentity
{
    private const uint StgmReadWrite = 0x00000002;
    private const uint ShcneUpdateItem = 0x00002000;
    private const uint ShcnfPathW = 0x0005;
    private const uint VtLpWStr = 31;
    private static readonly PropertyKey AppUserModelIdKey = new(
        new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        5);
    private static readonly Guid PropertyStoreInterfaceId = new("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");

    public static bool SynchronizeChromeTaskbarIdentity(TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow + timeout;
        do
        {
            foreach (nint window in FindQSessionChromeWindows())
            {
                string? chromeAppId = ReadWindowAppUserModelId(window);
                if (chromeAppId is null || !IsQSessionChromeAppId(chromeAppId)) continue;

                bool synchronized = false;
                foreach (string shortcutPath in FindQSessionShortcuts())
                {
                    synchronized |= SetShortcutAppUserModelId(shortcutPath, chromeAppId);
                }

                if (synchronized) return true;
            }
            Thread.Sleep(120);
        }
        while (DateTime.UtcNow < deadline);

        return false;
    }

    private static IEnumerable<nint> FindQSessionChromeWindows()
    {
        List<nint> matches = [];
        EnumWindows((window, _) =>
        {
            if (!IsWindowVisible(window)) return true;

            StringBuilder className = new(128);
            if (GetClassName(window, className, className.Capacity) == 0
                || !string.Equals(className.ToString(), "Chrome_WidgetWin_1", StringComparison.Ordinal))
            {
                return true;
            }

            int titleLength = GetWindowTextLength(window);
            if (titleLength <= 0) return true;
            StringBuilder title = new(titleLength + 1);
            GetWindowText(window, title, title.Capacity);
            string windowTitle = title.ToString();
            if (!windowTitle.StartsWith("Q Session", StringComparison.OrdinalIgnoreCase)
                || windowTitle.Contains("Google Chrome", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            GetWindowThreadProcessId(window, out uint processId);
            try
            {
                using Process process = Process.GetProcessById((int)processId);
                if (string.Equals(process.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase)) matches.Add(window);
            }
            catch
            {
                // The next poll can retry while Chrome finishes creating the app window.
            }
            return true;
        }, nint.Zero);
        return matches;
    }

    private static string? ReadWindowAppUserModelId(nint window)
    {
        Guid interfaceId = PropertyStoreInterfaceId;
        int result = SHGetPropertyStoreForWindow(window, ref interfaceId, out IPropertyStore? store);
        if (result < 0 || store is null) return null;

        try
        {
            PropertyKey key = AppUserModelIdKey;
            result = store.GetValue(ref key, out PropVariant variant);
            try
            {
                return result >= 0 && variant.VariantType == VtLpWStr
                    ? Marshal.PtrToStringUni(variant.PointerValue)
                    : null;
            }
            finally
            {
                PropVariantClear(ref variant);
            }
        }
        finally
        {
            Marshal.FinalReleaseComObject(store);
        }
    }

    private static bool IsQSessionChromeAppId(string? appUserModelId)
    {
        return !string.IsNullOrWhiteSpace(appUserModelId)
            && appUserModelId.StartsWith("Chrome.qsession.org_", StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> FindQSessionShortcuts()
    {
        string startMenuShortcut = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft",
            "Windows",
            "Start Menu",
            "Programs",
            "Q Session",
            "Q Session.lnk");

        string pinnedTaskbarShortcut = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft",
            "Internet Explorer",
            "Quick Launch",
            "User Pinned",
            "TaskBar",
            "Q Session.lnk");

        string desktopShortcut = Path.Combine(ResolveDesktopDirectory(), "Q Session.lnk");
        return new[] { startMenuShortcut, pinnedTaskbarShortcut, desktopShortcut }.Where(File.Exists);
    }

    private static string ResolveDesktopDirectory()
    {
        string desktopDirectory = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (!string.IsNullOrWhiteSpace(desktopDirectory)) return desktopDirectory;

        string? oneDrive = Environment.GetEnvironmentVariable("OneDrive");
        if (!string.IsNullOrWhiteSpace(oneDrive))
        {
            string oneDriveDesktop = Path.Combine(oneDrive, "Desktop");
            if (Directory.Exists(oneDriveDesktop)) return oneDriveDesktop;
        }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Desktop");
    }

    private static bool SetShortcutAppUserModelId(string shortcutPath, string appUserModelId)
    {
        object shellLink = new ShellLink();
        try
        {
            IPersistFile persistFile = (IPersistFile)shellLink;
            persistFile.Load(shortcutPath, StgmReadWrite);

            IPropertyStore store = (IPropertyStore)shellLink;
            PropertyKey key = AppUserModelIdKey;
            SetString(store, key, appUserModelId);
            int result = store.Commit();
            if (result < 0) Marshal.ThrowExceptionForHR(result);

            persistFile.Save(shortcutPath, true);
            SHChangeNotify(ShcneUpdateItem, ShcnfPathW, shortcutPath, null);
            return true;
        }
        catch
        {
            // The other shortcut can still provide Windows with the correct Q Session identity.
            return false;
        }
        finally
        {
            Marshal.FinalReleaseComObject(shellLink);
        }
    }

    private static void SetString(IPropertyStore store, PropertyKey key, string value)
    {
        PropVariant variant = PropVariant.FromString(value);
        try
        {
            int result = store.SetValue(ref key, ref variant);
            if (result < 0) Marshal.ThrowExceptionForHR(result);
        }
        finally
        {
            PropVariantClear(ref variant);
        }
    }

    private delegate bool EnumWindowsCallback(nint window, nint parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, nint parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(nint window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(nint window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(nint window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(nint window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint window, out uint processId);

    [DllImport("shell32.dll")]
    private static extern int SHGetPropertyStoreForWindow(
        nint window,
        ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore? propertyStore);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(
        uint eventId,
        uint flags,
        [MarshalAs(UnmanagedType.LPWStr)] string item1,
        [MarshalAs(UnmanagedType.LPWStr)] string? item2);

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant variant);

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey(Guid formatId, uint propertyId)
    {
        public Guid FormatId = formatId;
        public uint PropertyId = propertyId;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort VariantType;
        [FieldOffset(8)] public nint PointerValue;

        public static PropVariant FromString(string value) => new()
        {
            VariantType = (ushort)VtLpWStr,
            PointerValue = Marshal.StringToCoTaskMemUni(value),
        };
    }

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    private sealed class ShellLink;

    [ComImport]
    [Guid("0000010B-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPersistFile
    {
        void GetClassId(out Guid classId);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, [MarshalAs(UnmanagedType.Bool)] bool remember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint propertyCount);
        [PreserveSig] int GetAt(uint propertyIndex, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }
}
