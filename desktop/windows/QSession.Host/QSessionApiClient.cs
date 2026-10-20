using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace QSession.Host;

internal sealed class QSessionApiClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http = new()
    {
        BaseAddress = new Uri("https://qsession.org"),
        Timeout = TimeSpan.FromSeconds(15),
    };

    internal QSessionApiClient()
    {
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("QSession-Host-Windows/0.1");
    }

    internal async Task<bool> CheckAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using HttpResponseMessage response = await _http.GetAsync("/api/status", cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    internal Task<CreateRoomResponse> CreateRoomAsync(RoomDraft draft, CancellationToken cancellationToken = default) =>
        PostAsync<CreateRoomResponse>("/api/rooms", draft, cancellationToken);

    internal Task<MediaCredentialsResponse> GetMediaCredentialsAsync(
        string code,
        string hostToken,
        CancellationToken cancellationToken = default) =>
        PostAsync<MediaCredentialsResponse>(
            $"/api/rooms/{Uri.EscapeDataString(code)}/media-token",
            new { role = "dj", hostToken },
            cancellationToken);

    internal async Task EndRoomAsync(string code, string hostToken, CancellationToken cancellationToken = default)
    {
        _ = await PostAsync<JsonElement>(
            $"/api/rooms/{Uri.EscapeDataString(code)}/end",
            new { hostToken },
            cancellationToken);
    }

    internal async Task StartBroadcastDeliveryAsync(string code, string hostToken, CancellationToken cancellationToken = default)
    {
        _ = await PostAsync<JsonElement>(
            $"/api/rooms/{Uri.EscapeDataString(code)}/broadcast/start",
            new { hostToken },
            cancellationToken);
    }

    private async Task<T> PostAsync<T>(string path, object body, CancellationToken cancellationToken)
    {
        using HttpResponseMessage response = await _http.PostAsJsonAsync(path, body, JsonOptions, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            T? result = await response.Content.ReadFromJsonAsync<T>(JsonOptions, cancellationToken);
            return result ?? throw new InvalidOperationException("Q Session devolvió una respuesta vacía.");
        }

        string message = "Q Session no pudo completar la operación.";
        try
        {
            JsonElement payload = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions, cancellationToken);
            if (payload.TryGetProperty("error", out JsonElement error) && !string.IsNullOrWhiteSpace(error.GetString()))
            {
                message = error.GetString()!;
            }
        }
        catch
        {
        }
        throw new InvalidOperationException(message);
    }

    public void Dispose() => _http.Dispose();
}
