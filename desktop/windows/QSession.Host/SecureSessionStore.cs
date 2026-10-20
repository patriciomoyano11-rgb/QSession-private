using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace QSession.Host;

internal sealed class SecureSessionStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("org.qsession.host.room.v1");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _filePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "QSession",
        "Host",
        "active-session.bin");

    internal void Save(ActiveSession session)
    {
        string directory = Path.GetDirectoryName(_filePath)!;
        Directory.CreateDirectory(directory);
        byte[] clear = JsonSerializer.SerializeToUtf8Bytes(session, JsonOptions);
        byte[] encrypted = ProtectedData.Protect(clear, Entropy, DataProtectionScope.CurrentUser);
        string temporary = _filePath + ".tmp";
        File.WriteAllBytes(temporary, encrypted);
        File.Move(temporary, _filePath, true);
    }

    internal ActiveSession? Load()
    {
        try
        {
            if (!File.Exists(_filePath)) return null;
            byte[] encrypted = File.ReadAllBytes(_filePath);
            byte[] clear = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
            return JsonSerializer.Deserialize<ActiveSession>(clear, JsonOptions);
        }
        catch
        {
            Clear();
            return null;
        }
    }

    internal void Clear()
    {
        try
        {
            if (File.Exists(_filePath)) File.Delete(_filePath);
        }
        catch
        {
        }
    }
}
