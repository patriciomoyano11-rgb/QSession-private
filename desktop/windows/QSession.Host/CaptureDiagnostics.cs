using System.IO;

namespace QSession.Host;

internal static class CaptureDiagnostics
{
    private static readonly object Gate = new();

    internal static void Write(string room, string state, string detail = "")
    {
        try
        {
            string directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QSession",
                "Host");
            Directory.CreateDirectory(directory);
            string safeRoom = room.Length == 6 ? room : "------";
            string safeDetail = detail.Replace('\r', ' ').Replace('\n', ' ').Trim();
            if (safeDetail.Length > 500) safeDetail = safeDetail[..500];
            lock (Gate)
            {
                File.AppendAllText(
                    Path.Combine(directory, "chrome-tab-capture.log"),
                    $"{DateTimeOffset.Now:O}\t{safeRoom}\t{state}\t{safeDetail}{Environment.NewLine}");
            }
        }
        catch
        {
            // Diagnostics must never interrupt an active transmission.
        }
    }
}
