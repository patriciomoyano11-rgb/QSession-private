using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Resources;

namespace QSession.Host;

internal static class WindowsSelfInstaller
{
    private const string InstalledExecutableName = "QSession.exe";
    private const string LegacyExecutableName = "QSession.Host.exe";
    private const string InstalledIconName = "qsession-taskbar-v8.ico";

    public static bool InstallAndLaunchIfRequired()
    {
        string sourceExecutable = Path.GetFullPath(
            Environment.ProcessPath
            ?? throw new InvalidOperationException("Windows no informó la ubicación del instalador."));

        string localPrograms = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs"));
        string installDirectory = Path.GetFullPath(Path.Combine(localPrograms, "QSession"));
        string installedExecutable = Path.Combine(installDirectory, InstalledExecutableName);

        string guardedProgramsRoot = localPrograms.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!installDirectory.StartsWith(guardedProgramsRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("La ubicación de instalación de Q Session no es segura.");
        }

        if (string.Equals(sourceExecutable, installedExecutable, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        Directory.CreateDirectory(installDirectory);
        StopInstalledCopy("QSession", installedExecutable);
        StopInstalledCopy("QSession.Host", Path.Combine(installDirectory, LegacyExecutableName));

        string stagedExecutable = installedExecutable + ".new";
        File.Copy(sourceExecutable, stagedExecutable, overwrite: true);
        File.Move(stagedExecutable, installedExecutable, overwrite: true);

        RemoveLegacyInstallFiles(installDirectory, installedExecutable);
        string installedIcon = InstallTaskbarIcon(installDirectory);
        RemoveLegacyChromeShortcuts();
        CreateShortcuts(installedExecutable, installDirectory, installedIcon);

        Process.Start(new ProcessStartInfo
        {
            FileName = installedExecutable,
            WorkingDirectory = installDirectory,
            UseShellExecute = true,
        });
        return true;
    }

    private static string InstallTaskbarIcon(string installDirectory)
    {
        string installedIcon = Path.Combine(installDirectory, InstalledIconName);
        Uri resourceUri = new("pack://application:,,,/QSession.Host;component/Assets/qsession.ico");
        StreamResourceInfo? resource = Application.GetResourceStream(resourceUri);
        if (resource is null)
        {
            throw new InvalidOperationException("Q Session no encontró su icono de Windows.");
        }

        using Stream input = resource.Stream;
        using FileStream output = File.Create(installedIcon);
        input.CopyTo(output);
        return installedIcon;
    }

    private static void StopInstalledCopy(string processName, string executablePath)
    {
        foreach (Process process in Process.GetProcessesByName(processName))
        {
            try
            {
                if (!string.Equals(process.MainModule?.FileName, executablePath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                process.CloseMainWindow();
                if (!process.WaitForExit(3500))
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(3500);
                }
            }
            catch
            {
                // If Windows protects process details, the atomic replacement below reports the real failure.
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    private static void RemoveLegacyInstallFiles(string installDirectory, string installedExecutable)
    {
        foreach (string file in Directory.GetFiles(installDirectory))
        {
            if (!string.Equals(file, installedExecutable, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(file);
            }
        }

        foreach (string directory in Directory.GetDirectories(installDirectory))
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private static void RemoveLegacyChromeShortcuts()
    {
        string chromeAppsDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft",
            "Windows",
            "Start Menu",
            "Programs",
            "Chrome Apps");
        if (!Directory.Exists(chromeAppsDirectory)) return;

        foreach (string shortcutPath in Directory.GetFiles(chromeAppsDirectory, "Q Session*.lnk"))
        {
            if (ShortcutTargetsChromeApp(shortcutPath)) File.Delete(shortcutPath);
        }
    }

    private static bool ShortcutTargetsChromeApp(string shortcutPath)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell")
            ?? throw new InvalidOperationException("Windows no pudo revisar los accesos anteriores de Q Session.");
        object shellObject = Activator.CreateInstance(shellType)
            ?? throw new InvalidOperationException("Windows no pudo iniciar el revisor de accesos directos.");
        object? shortcutObject = null;
        try
        {
            dynamic shell = shellObject;
            shortcutObject = shell.CreateShortcut(shortcutPath);
            dynamic shortcut = shortcutObject;
            string targetPath = shortcut.TargetPath as string ?? string.Empty;
            string arguments = shortcut.Arguments as string ?? string.Empty;
            return string.Equals(Path.GetFileName(targetPath), "chrome_proxy.exe", StringComparison.OrdinalIgnoreCase)
                && arguments.Contains("--app-id=", StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (shortcutObject is not null && Marshal.IsComObject(shortcutObject))
            {
                Marshal.FinalReleaseComObject(shortcutObject);
            }
            if (Marshal.IsComObject(shellObject))
            {
                Marshal.FinalReleaseComObject(shellObject);
            }
        }
    }

    private static void CreateShortcuts(string installedExecutable, string installDirectory, string installedIcon)
    {
        string desktopDirectory = ResolveDesktopDirectory();
        string startMenuDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft",
            "Windows",
            "Start Menu",
            "Programs",
            "Q Session");
        Directory.CreateDirectory(startMenuDirectory);

        List<string> shortcutPaths = new()
        {
            Path.Combine(desktopDirectory, "Q Session.lnk"),
            Path.Combine(startMenuDirectory, "Q Session.lnk"),
        };

        string pinnedTaskbarShortcut = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft",
            "Internet Explorer",
            "Quick Launch",
            "User Pinned",
            "TaskBar",
            "Q Session.lnk");
        if (File.Exists(pinnedTaskbarShortcut)) shortcutPaths.Add(pinnedTaskbarShortcut);

        foreach (string shortcutPath in shortcutPaths)
        {
            CreateShortcut(shortcutPath, installedExecutable, installDirectory, installedIcon);
        }
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

        string fallback = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Desktop");
        Directory.CreateDirectory(fallback);
        return fallback;
    }

    private static void CreateShortcut(
        string shortcutPath,
        string installedExecutable,
        string installDirectory,
        string installedIcon)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell")
            ?? throw new InvalidOperationException("Windows no pudo crear los accesos directos de Q Session.");
        object shellObject = Activator.CreateInstance(shellType)
            ?? throw new InvalidOperationException("Windows no pudo iniciar el creador de accesos directos.");
        object? shortcutObject = null;

        try
        {
            dynamic shell = shellObject;
            shortcutObject = shell.CreateShortcut(shortcutPath);
            dynamic shortcut = shortcutObject;
            shortcut.TargetPath = installedExecutable;
            shortcut.WorkingDirectory = installDirectory;
            shortcut.Description = "Q Session Desktop · transmisión para anfitriones";
            shortcut.IconLocation = $"{installedIcon},0";
            shortcut.Save();
        }
        finally
        {
            if (shortcutObject is not null && Marshal.IsComObject(shortcutObject))
            {
                Marshal.FinalReleaseComObject(shortcutObject);
            }
            if (Marshal.IsComObject(shellObject))
            {
                Marshal.FinalReleaseComObject(shellObject);
            }
        }
    }
}
