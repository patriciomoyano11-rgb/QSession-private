using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace QSession.Host;

public partial class WebShellWindow : Window
{
    private const string ShellVersion = "0.4.15";
    private const string ProductUrl = "https://qsession.org/?desktop=windows&app=0.4.15";
    private MainWindow? _nativeStudio;
    private readonly LocalCaptureServer _captureServer = new();
    private string _activeCaptureRoom = string.Empty;
    private bool _initialized;
    private bool _gpsBusy;
    private readonly CancellationTokenSource _gpsShutdown = new();

    public WebShellWindow()
    {
        InitializeComponent();
        _captureServer.Start();
        _captureServer.CaptureStateChanged += CaptureServer_CaptureStateChanged;
    }

    private async void WebShellWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (_initialized) return;
        _initialized = true;
        await InitializeWebAppAsync();
    }

    private async Task InitializeWebAppAsync()
    {
        LoadingPanel.Visibility = Visibility.Visible;
        OfflinePanel.Visibility = Visibility.Collapsed;
        try
        {
            string profileDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QSession",
                "WebView2");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, profileDirectory);
            await WebApp.EnsureCoreWebView2Async(environment);

            WebApp.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 247, 244, 237);
            WebApp.CoreWebView2.Settings.IsStatusBarEnabled = false;
            WebApp.CoreWebView2.Settings.IsZoomControlEnabled = true;
            WebApp.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            WebApp.CoreWebView2.Settings.UserAgent += $" QSessionDesktop/{ShellVersion} Windows";
            WebApp.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
            WebApp.CoreWebView2.NewWindowRequested += CoreWebView2_NewWindowRequested;
            WebApp.CoreWebView2.ProcessFailed += CoreWebView2_ProcessFailed;
            await WebApp.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(DesktopBridgeScript);
            await RefreshWebExperienceOnceAsync(profileDirectory);
            WebApp.CoreWebView2.Navigate(ProductUrl);
        }
        catch (Exception error)
        {
            ShowOffline($"No fue posible abrir la plataforma. {error.Message}");
        }
    }

    private async Task RefreshWebExperienceOnceAsync(string profileDirectory)
    {
        string marker = Path.Combine(profileDirectory, "qsession-shell-version.txt");
        string previous = File.Exists(marker) ? (await File.ReadAllTextAsync(marker)).Trim() : string.Empty;
        if (string.Equals(previous, ShellVersion, StringComparison.Ordinal)) return;
        await WebApp.CoreWebView2.Profile.ClearBrowsingDataAsync(
            CoreWebView2BrowsingDataKinds.DiskCache
            | CoreWebView2BrowsingDataKinds.CacheStorage
            | CoreWebView2BrowsingDataKinds.ServiceWorkers);
        Directory.CreateDirectory(profileDirectory);
        await File.WriteAllTextAsync(marker, ShellVersion);
    }

    private void WebApp_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        LoadingPanel.Visibility = Visibility.Visible;
        OfflinePanel.Visibility = Visibility.Collapsed;
    }

    private void WebApp_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        LoadingPanel.Visibility = Visibility.Collapsed;
        if (!e.IsSuccess)
        {
            ShowOffline($"No pudimos cargar Q Session ({e.WebErrorStatus}).");
        }
    }

    private void CoreWebView2_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            if (!Uri.TryCreate(e.Source, UriKind.Absolute, out Uri? source)
                || source.Scheme != "https" || !string.Equals(source.Host, "qsession.org", StringComparison.OrdinalIgnoreCase)) return;
            using JsonDocument message = JsonDocument.Parse(e.WebMessageAsJson);
            string? type = message.RootElement.TryGetProperty("type", out JsonElement value) ? value.GetString() : null;
            if (type == "reload-qsession") WebApp.CoreWebView2.Reload();
            else if (type == "request-gps-country") RequestGpsCountry(message.RootElement);
            else if (type == "open-native-studio") OpenNativeStudio();
            else if (type == "start-chrome-tab-capture") StartChromeTabCapture(message.RootElement);
            else if (type == "set-chrome-tab-capture-paused") SetChromeTabCapturePaused(message.RootElement);
            else if (type == "set-chrome-tab-capture-bitrate") SetChromeTabCaptureBitrate(message.RootElement);
            else if (type == "stop-chrome-tab-capture") StopChromeTabCapture(message.RootElement);
        }
        catch (Exception error)
        {
            CaptureDiagnostics.Write(_activeCaptureRoom, "bridge-error", error.Message);
        }
    }

    private async void RequestGpsCountry(JsonElement message)
    {
        if (_gpsBusy || !message.TryGetProperty("requestId", out var id)) return;
        string requestId = id.GetString() ?? string.Empty;
        if (requestId.Length is < 8 or > 100 || requestId.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-')) return;
        _gpsBusy = true;
        object result;
        try
        {
            var coordinate = await SatelliteLocation.RequestAsync(_gpsShutdown.Token);
            var point = coordinate.Point.Position;
            result = new { requestId, verifiedBy = "gps", countryCode = "", accuracy = coordinate.Accuracy, latitude = point.Latitude, longitude = point.Longitude };
        }
        catch (Exception error) { result = new { requestId, verifiedBy = "", error = error.Message }; }
        finally { _gpsBusy = false; }
        if (_gpsShutdown.IsCancellationRequested || WebApp.CoreWebView2 is null) return;
        if (!Uri.TryCreate(WebApp.Source?.ToString(), UriKind.Absolute, out var source) || source.Scheme != "https" || source.Host != "qsession.org") return;
        try { await WebApp.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('qsession-native-gps-country',{detail:" + JsonSerializer.Serialize(result) + "}));"); }
        catch (Exception) { /* The page may have closed while the sensor was acquiring a fix. */ }
    }

    private static bool TryReadCaptureRoom(JsonElement message, out string room)
    {
        room = message.TryGetProperty("room", out JsonElement roomValue)
            ? (roomValue.GetString() ?? string.Empty).ToUpperInvariant()
            : string.Empty;
        return room.Length == 6 && room.All(char.IsAsciiLetterOrDigit);
    }

    private void StartChromeTabCapture(JsonElement message)
    {
        if (!TryReadCaptureRoom(message, out string room)) return;
        string url = message.TryGetProperty("url", out JsonElement urlValue) ? urlValue.GetString() ?? string.Empty : string.Empty;
        string token = message.TryGetProperty("token", out JsonElement tokenValue) ? tokenValue.GetString() ?? string.Empty : string.Empty;
        if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? mediaUrl)
            || mediaUrl.Scheme != "wss"
            || token.Length < 40
            || token.Any(char.IsWhiteSpace)) return;

        if (!string.IsNullOrEmpty(_activeCaptureRoom)) ChromeCaptureWindow.Close(_activeCaptureRoom);
        _activeCaptureRoom = room;
        int bitrate = ReadChromeTabCaptureBitrate(message);
        OpenChromeTabCapture(room, mediaUrl.ToString(), token, bitrate);
    }

    private static int ReadChromeTabCaptureBitrate(JsonElement message)
    {
        int bitrate = message.TryGetProperty("bitrate", out JsonElement bitrateValue) && bitrateValue.TryGetInt32(out int requested)
            ? requested
            : 510000;
        return bitrate is 128000 or 192000 or 256000 or 320000 or 510000 ? bitrate : 510000;
    }

    private void SetChromeTabCapturePaused(JsonElement message)
    {
        if (!TryReadCaptureRoom(message, out string room)
            || !string.Equals(room, _activeCaptureRoom, StringComparison.OrdinalIgnoreCase)) return;
        bool paused = message.TryGetProperty("paused", out JsonElement pausedValue) && pausedValue.ValueKind == JsonValueKind.True;
        _captureServer.QueueCaptureCommand(room, paused ? "pause" : "resume");
    }

    private void SetChromeTabCaptureBitrate(JsonElement message)
    {
        if (!TryReadCaptureRoom(message, out string room)
            || !string.Equals(room, _activeCaptureRoom, StringComparison.OrdinalIgnoreCase)) return;
        int bitrate = ReadChromeTabCaptureBitrate(message);
        _captureServer.QueueCaptureCommand(room, $"bitrate:{bitrate}");
    }

    private void StopChromeTabCapture(JsonElement message)
    {
        if (!TryReadCaptureRoom(message, out string room)) return;
        _captureServer.QueueCaptureCommand(room, "stop");
        ChromeCaptureWindow.Close(room);
        if (string.Equals(room, _activeCaptureRoom, StringComparison.OrdinalIgnoreCase)) _activeCaptureRoom = string.Empty;
    }

    private void CaptureServer_CaptureStateChanged(string room, string state, string detail)
    {
        Dispatcher.BeginInvoke(async () =>
        {
            if (!string.Equals(room, _activeCaptureRoom, StringComparison.OrdinalIgnoreCase)) return;
            CaptureDiagnostics.Write(room, state, detail);
            WebApp.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "chrome-tab-capture-state",
                room,
                state,
                detail,
            }));
            if (state == "live")
            {
                await Task.Delay(450);
                ChromeCaptureWindow.Hide(room);
            }
            else if (state == "error")
            {
                ChromeCaptureWindow.Show(room);
            }
        });
    }

    private void OpenChromeTabCapture(string room, string mediaUrl, string token, int bitrate)
    {
        byte[] payloadBytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            url = mediaUrl,
            token,
            room,
            audioBitrate = bitrate,
            language = "es",
        });
        string encoded = Convert.ToBase64String(payloadBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        string captureUrl = $"{_captureServer.CapturePageUri}#{encoded}";
        string[] chromeCandidates =
        [
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe"),
        ];
        string? chrome = chromeCandidates.FirstOrDefault(File.Exists);
        if (chrome is not null)
        {
            CaptureDiagnostics.Write(room, "opening-chrome", "Ventana normal de Chrome preparada para seleccionar una pestaña.");
            Process.Start(new ProcessStartInfo
            {
                FileName = chrome,
                Arguments = $"--new-window \"{captureUrl}\"",
                UseShellExecute = true,
            });
            return;
        }
        Process.Start(new ProcessStartInfo { FileName = captureUrl, UseShellExecute = true });
    }

    private void CoreWebView2_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri? uri)
            && string.Equals(uri.Host, "qsession.org", StringComparison.OrdinalIgnoreCase))
        {
            e.Handled = true;
            WebApp.CoreWebView2.Navigate(uri.ToString());
        }
    }

    private void CoreWebView2_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.BrowserProcessExited
            or CoreWebView2ProcessFailedKind.RenderProcessExited)
        {
            Dispatcher.Invoke(() => ShowOffline("La interfaz se cerró inesperadamente. Puedes recuperarla sin perder el motor nativo."));
        }
    }

    private void RetryWeb_Click(object sender, RoutedEventArgs e)
    {
        LoadingPanel.Visibility = Visibility.Visible;
        OfflinePanel.Visibility = Visibility.Collapsed;
        if (WebApp.CoreWebView2 is null)
        {
            _initialized = false;
            _ = InitializeWebAppAsync();
            _initialized = true;
            return;
        }
        WebApp.CoreWebView2.Navigate(ProductUrl);
    }

    private void OpenNativeStudio_Click(object sender, RoutedEventArgs e) => OpenNativeStudio();

    private void OpenNativeStudio()
    {
        if (_nativeStudio is { IsVisible: true })
        {
            if (_nativeStudio.WindowState == WindowState.Minimized) _nativeStudio.WindowState = WindowState.Normal;
            _nativeStudio.Activate();
            return;
        }

        _nativeStudio = new MainWindow();
        _nativeStudio.Closed += (_, _) => _nativeStudio = null;
        _nativeStudio.Show();
        _nativeStudio.Activate();
    }

    private void ShowOffline(string detail)
    {
        LoadingPanel.Visibility = Visibility.Collapsed;
        OfflineDetail.Text = detail;
        OfflinePanel.Visibility = Visibility.Visible;
    }

    private void WebShellWindow_Closing(object? sender, CancelEventArgs e)
    {
        if (!string.IsNullOrEmpty(_activeCaptureRoom)) ChromeCaptureWindow.Close(_activeCaptureRoom);
        _gpsShutdown.Cancel();
        _captureServer.Dispose();
    }

    private const string DesktopBridgeScript = """
        (() => {
          if (location.protocol === 'https:' && location.hostname === 'qsession.org') {
            window.QSessionNativeBridge = {requestGpsCountry: requestId => window.chrome.webview.postMessage({type:'request-gps-country',requestId})};
          }
          const install = () => {
            if (!location.hostname.endsWith('qsession.org')) return;
            document.documentElement.dataset.qsessionDesktop = 'windows';
            if (!document.getElementById('qsession-desktop-style')) {
              const style = document.createElement('style');
              style.id = 'qsession-desktop-style';
              style.textContent = `
                #installAppButton, .windows-install-card, .music-live-desk { display: none !important; }
              `;
              document.head.append(style);
            }
          };
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once: true});
          else install();
          new MutationObserver(install).observe(document.documentElement, {childList: true, subtree: true});
        })();
        """;
}
