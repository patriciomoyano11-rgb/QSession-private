using System.Diagnostics;
using System.IO;

namespace QSession.Host;

internal static class ChromeAppLauncher
{
    private const string ProductUrl = "https://qsession.org/?desktop=windows&app=0.4.15";

    public static void Open()
    {
        string? chrome = FindChrome();
        if (chrome is null)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = ProductUrl,
                UseShellExecute = true,
            });
            return;
        }

        ProcessStartInfo startInfo = new()
        {
            FileName = chrome,
            UseShellExecute = false,
        };
        startInfo.ArgumentList.Add($"--app={ProductUrl}");
        startInfo.ArgumentList.Add("--start-maximized");
        Process.Start(startInfo);
        TaskbarIdentity.SynchronizeChromeTaskbarIdentity(TimeSpan.FromSeconds(8));
    }

    private static string? FindChrome()
    {
        string[] candidates =
        [
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
        ];
        return candidates.FirstOrDefault(File.Exists);
    }
}
