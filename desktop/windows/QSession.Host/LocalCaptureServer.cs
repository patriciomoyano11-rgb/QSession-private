using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace QSession.Host;

/// <summary>
/// Serves the Chrome tab-audio picker from loopback so the feature does not
/// depend on a separate web deployment. URL fragments containing media tokens
/// never reach this server.
/// </summary>
internal sealed class LocalCaptureServer : IDisposable
{
    private static readonly HttpClient RoomClient = new()
    {
        BaseAddress = new Uri("https://qsession.org"),
        Timeout = TimeSpan.FromSeconds(8),
    };

    private readonly CancellationTokenSource _shutdown = new();
    private readonly ConcurrentDictionary<string, string> _captureCommands = new(StringComparer.OrdinalIgnoreCase);
    private TcpListener? _listener;
    private Task? _acceptLoop;

    internal Uri CapturePageUri { get; private set; } = null!;
    internal event Action<string, string, string>? CaptureStateChanged;

    internal void QueueCaptureCommand(string roomCode, string command)
    {
        if (roomCode.Length != 6 || roomCode.Any(character => !char.IsAsciiLetterOrDigit(character))) return;
        bool validBitrate = command.StartsWith("bitrate:", StringComparison.Ordinal)
            && int.TryParse(command["bitrate:".Length..], out int bitrate)
            && bitrate is 128000 or 192000 or 256000 or 320000 or 510000;
        if (command is not ("pause" or "resume" or "stop") && !validBitrate) return;
        _captureCommands[roomCode.ToUpperInvariant()] = command;
    }

    internal void Start()
    {
        if (_listener is not null) return;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        int port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        CapturePageUri = new Uri($"http://127.0.0.1:{port}/tab-capture.html");
        _acceptLoop = Task.Run(() => AcceptLoopAsync(_shutdown.Token));
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && _listener is not null)
        {
            try
            {
                TcpClient client = await _listener.AcceptTcpClientAsync(cancellationToken);
                _ = Task.Run(() => HandleAsync(client, cancellationToken), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }
        }
    }

    private async Task HandleAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        {
            client.NoDelay = true;
            await using NetworkStream stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII, false, 4096, leaveOpen: true);
            string? requestLine = await reader.ReadLineAsync(cancellationToken);
            for (int index = 0; index < 100; index++)
            {
                string? header = await reader.ReadLineAsync(cancellationToken);
                if (string.IsNullOrEmpty(header)) break;
            }

            if (string.IsNullOrWhiteSpace(requestLine)) return;
            string[] request = requestLine.Split(' ', 3, StringSplitOptions.RemoveEmptyEntries);
            if (request.Length < 2 || !string.Equals(request[0], "GET", StringComparison.OrdinalIgnoreCase))
            {
                await WriteResponseAsync(stream, 405, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Method not allowed"), cancellationToken);
                return;
            }

            Uri requestUri;
            try
            {
                requestUri = new Uri(new Uri("http://127.0.0.1"), request[1]);
            }
            catch
            {
                await WriteResponseAsync(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Bad request"), cancellationToken);
                return;
            }
            string path = Uri.UnescapeDataString(requestUri.AbsolutePath);

            if (path == "/api/capture-state")
            {
                await ReceiveCaptureStateAsync(stream, requestUri, cancellationToken);
                return;
            }

            if (path == "/api/capture-command")
            {
                await SendCaptureCommandAsync(stream, requestUri, cancellationToken);
                return;
            }

            if (path.StartsWith("/api/rooms/", StringComparison.Ordinal))
            {
                await ProxyRoomStatusAsync(stream, path, cancellationToken);
                return;
            }

            (string RelativePath, string ContentType)? asset = path switch
            {
                "/" or "/tab-capture.html" => ("tab-capture.html", "text/html; charset=utf-8"),
                "/tab-capture.css" => ("tab-capture.css", "text/css; charset=utf-8"),
                "/tab-capture.js" => ("tab-capture.js", "text/javascript; charset=utf-8"),
                "/vendor/livekit-client.umd.js" => (Path.Combine("vendor", "livekit-client.umd.js"), "text/javascript; charset=utf-8"),
                "/brand/qsession-icon-master.png" => (Path.Combine("brand", "qsession-icon-master.png"), "image/png"),
                _ => null,
            };

            if (asset is null)
            {
                await WriteResponseAsync(stream, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), cancellationToken);
                return;
            }

            string file = Path.Combine(AppContext.BaseDirectory, "Capture", asset.Value.RelativePath);
            if (!File.Exists(file))
            {
                await WriteResponseAsync(stream, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Capture asset missing"), cancellationToken);
                return;
            }

            byte[] body = await File.ReadAllBytesAsync(file, cancellationToken);
            await WriteResponseAsync(stream, 200, asset.Value.ContentType, body, cancellationToken);
        }
    }

    private async Task ReceiveCaptureStateAsync(NetworkStream stream, Uri requestUri, CancellationToken cancellationToken)
    {
        Dictionary<string, string> values = requestUri.Query
            .TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(part => part.Length == 2)
            .ToDictionary(
                part => Uri.UnescapeDataString(part[0]),
                part => Uri.UnescapeDataString(part[1]),
                StringComparer.OrdinalIgnoreCase);

        values.TryGetValue("room", out string? room);
        values.TryGetValue("state", out string? state);
        values.TryGetValue("detail", out string? detail);
        string[] validStates = ["selecting", "live", "paused", "stopped", "error"];
        if (room?.Length != 6
            || room.Any(character => !char.IsAsciiLetterOrDigit(character))
            || state is null
            || !validStates.Contains(state, StringComparer.Ordinal))
        {
            await WriteResponseAsync(stream, 400, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":false}"), cancellationToken);
            return;
        }

        string safeDetail = detail ?? string.Empty;
        if (safeDetail.Length > 500) safeDetail = safeDetail[..500];
        CaptureStateChanged?.Invoke(room.ToUpperInvariant(), state, safeDetail);
        await WriteResponseAsync(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), cancellationToken);
    }

    private async Task SendCaptureCommandAsync(NetworkStream stream, Uri requestUri, CancellationToken cancellationToken)
    {
        string room = requestUri.Query
            .TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(part => part.Length == 2 && string.Equals(part[0], "room", StringComparison.OrdinalIgnoreCase))
            .Select(part => Uri.UnescapeDataString(part[1]).ToUpperInvariant())
            .FirstOrDefault() ?? string.Empty;
        if (room.Length != 6 || room.Any(character => !char.IsAsciiLetterOrDigit(character)))
        {
            await WriteResponseAsync(stream, 400, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":false}"), cancellationToken);
            return;
        }

        _captureCommands.TryRemove(room, out string? command);
        byte[] body = JsonSerializer.SerializeToUtf8Bytes(new { ok = true, command = command ?? string.Empty });
        await WriteResponseAsync(stream, 200, "application/json; charset=utf-8", body, cancellationToken);
    }

    private static async Task ProxyRoomStatusAsync(NetworkStream stream, string path, CancellationToken cancellationToken)
    {
        string code = path["/api/rooms/".Length..];
        if (code.Length != 6 || code.Any(character => !char.IsAsciiLetterOrDigit(character)))
        {
            await WriteResponseAsync(stream, 400, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":false}"), cancellationToken);
            return;
        }

        try
        {
            using HttpResponseMessage response = await RoomClient.GetAsync($"/api/rooms/{Uri.EscapeDataString(code)}", cancellationToken);
            byte[] body = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            string contentType = response.Content.Headers.ContentType?.ToString() ?? "application/json; charset=utf-8";
            await WriteResponseAsync(stream, (int)response.StatusCode, contentType, body, cancellationToken);
        }
        catch
        {
            await WriteResponseAsync(stream, 503, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":false}"), cancellationToken);
        }
    }

    private static async Task WriteResponseAsync(
        NetworkStream stream,
        int statusCode,
        string contentType,
        byte[] body,
        CancellationToken cancellationToken)
    {
        string reason = statusCode switch
        {
            200 => "OK",
            400 => "Bad Request",
            404 => "Not Found",
            405 => "Method Not Allowed",
            503 => "Service Unavailable",
            _ => "Response",
        };
        string headers = $"HTTP/1.1 {statusCode} {reason}\r\nContent-Type: {contentType}\r\nContent-Length: {body.Length}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(headers), cancellationToken);
        await stream.WriteAsync(body, cancellationToken);
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        _listener?.Stop();
        _listener = null;
        try { _acceptLoop?.Wait(TimeSpan.FromSeconds(1)); } catch { }
        _shutdown.Dispose();
    }
}
