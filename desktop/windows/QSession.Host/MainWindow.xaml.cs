using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace QSession.Host;

public partial class MainWindow : Window
{
    private static readonly RoomTypeOption[] RoomTypes =
    [
        new("party", "Fiesta o música", "Música, cámaras y herramientas sociales para compartir el momento.", true, true, true, true, true),
        new("conference", "Conferencia", "Presentación profesional con conversación pública opcional.", true, false, false, false, false),
        new("class", "Clase de yoga, baile o idiomas", "Sesión guiada con cámaras opcionales para acompañar al profesor.", true, true, false, false, true),
        new("workshop", "Taller o capacitación", "Aprendizaje en grupo con chat y participación controlada.", true, true, false, false, false),
        new("networking", "Networking", "Encuentro profesional con perfiles y conexiones entre asistentes.", true, false, true, true, false),
        new("hotel", "Hotel o experiencia privada", "Servicio privado para huéspedes o participantes con invitación.", false, false, false, false, true),
        new("custom", "Personalizada", "Configura individualmente las funciones que necesita tu sesión.", true, true, true, false, true),
    ];

    private static readonly AudioSourceOption[] AudioSources =
    [
        new(AudioSourceKind.BrowserTab, "Pestaña de Chrome · audio aislado"),
        new(AudioSourceKind.Output, "Audio del computador · música y aplicaciones"),
        new(AudioSourceKind.Input, "Entrada física · micrófono, consola o USB"),
    ];

    private readonly QSessionApiClient _api = new();
    private readonly SecureSessionStore _store = new();
    private readonly PowerGuard _powerGuard = new();
    private readonly LocalCaptureServer _captureServer = new();
    private readonly DispatcherTimer _meterTimer = new() { Interval = TimeSpan.FromMilliseconds(90) };
    private readonly DispatcherTimer _connectionTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer _elapsedTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly SolidColorBrush _connectedBrush = new(Color.FromRgb(103, 208, 212));
    private readonly SolidColorBrush _waitingBrush = new(Color.FromRgb(241, 179, 91));
    private readonly SolidColorBrush _offlineBrush = new(Color.FromRgb(147, 165, 178));

    private ActiveSession? _session;
    private CancellationTokenSource? _reconnectCancellation;
    private bool _isLive;
    private bool _isBusy;
    private bool _isReconnecting;
    private bool _isStopping;
    private bool _allowClose;

    public MainWindow()
    {
        InitializeComponent();
        _captureServer.Start();
        _captureServer.CaptureStateChanged += CaptureServer_CaptureStateChanged;
        RoomTypePicker.ItemsSource = RoomTypes;
        RoomTypePicker.SelectedIndex = 0;
        AudioSourcePicker.ItemsSource = AudioSources;
        AudioSourcePicker.SelectedIndex = 0;

        _meterTimer.Tick += MeterTimer_Tick;
        _connectionTimer.Tick += ConnectionTimer_Tick;
        _elapsedTimer.Tick += ElapsedTimer_Tick;
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        await RefreshAudioDevicesAsync();
        await RefreshCamerasAsync();
        ActiveSession? saved = _store.Load();
        RecoverSessionButton.Visibility = saved is null ? Visibility.Collapsed : Visibility.Visible;
        if (saved is not null)
        {
            RecoverSessionButton.Content = $"Recuperar sala {saved.Code} · {saved.Name}";
        }

        bool healthy = await _api.CheckAsync();
        ServerStatus.Text = healthy ? "qsession.org conectado" : "qsession.org sin respuesta";
        ServerDot.Fill = healthy ? _connectedBrush : _waitingBrush;
    }

    private void RoomTypePicker_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (RoomTypePicker.SelectedItem is not RoomTypeOption roomType || RoomTypeDescription is null) return;
        RoomTypeDescription.Text = roomType.Description;
        PublicChatCheck.IsChecked = roomType.AllowPublicChat;
        GuestCamerasCheck.IsChecked = roomType.AllowGuestCameras;
        SocialProfilesCheck.IsChecked = roomType.AllowSocialProfiles;
        MatchmakingCheck.IsChecked = roomType.AllowMatchmaking;
        ProfileGiftsCheck.IsChecked = roomType.AllowProfileGifts;

        if (roomType.Value == "hotel")
        {
            PrivateRoomRadio.IsChecked = true;
        }
    }

    private void SocialProfilesCheck_Changed(object sender, RoutedEventArgs e)
    {
        if (MatchmakingCheck is null || ProfileGiftsCheck is null) return;
        bool enabled = SocialProfilesCheck.IsChecked == true;
        MatchmakingCheck.IsEnabled = enabled;
        ProfileGiftsCheck.IsEnabled = enabled;
        if (!enabled)
        {
            MatchmakingCheck.IsChecked = false;
            ProfileGiftsCheck.IsChecked = false;
        }
    }

    private async void AudioSourcePicker_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (IsLoaded) await RefreshAudioDevicesAsync();
    }

    private async void RefreshAudioButton_Click(object sender, RoutedEventArgs e) => await RefreshAudioDevicesAsync();

    private async Task RefreshAudioDevicesAsync(string? preferredName = null)
    {
        try
        {
            var source = (AudioSourcePicker.SelectedItem as AudioSourceOption)?.Kind ?? AudioSourceKind.BrowserTab;
            RefreshAudioButton.IsEnabled = false;
            bool browserTab = source == AudioSourceKind.BrowserTab;
            BrowserCaptureNote.Visibility = browserTab ? Visibility.Visible : Visibility.Collapsed;
            AudioSourceNote.Text = browserTab
                ? "Sólo se transmitirá el sonido de la pestaña que confirmes. No entrarán notificaciones ni otras aplicaciones."
                : source == AudioSourceKind.Input
                    ? "Usa un micrófono, una consola o una interfaz USB conectada a Windows."
                    : "Audio digital directo, sin depender del volumen de los altavoces.";
            if (browserTab)
            {
                MediaDevice[] browserDevices = [new MediaDevice(-1, "Chrome · elegir pestaña al iniciar")];
                DevicePicker.ItemsSource = browserDevices;
                DevicePicker.SelectedIndex = 0;
                DevicePicker.IsEnabled = false;
                return;
            }
            IReadOnlyList<MediaDevice> devices = await Task.Run(() => NativeMedia.GetAudioDevices(source));
            DevicePicker.ItemsSource = devices;
            int preferredIndex = preferredName is null ? -1 : devices.ToList().FindIndex(device => device.Name == preferredName);
            int defaultIndex = NativeMedia.GetDefaultAudioDeviceIndex();
            DevicePicker.SelectedIndex = preferredIndex >= 0
                ? preferredIndex
                : defaultIndex >= 0 && defaultIndex < devices.Count ? defaultIndex : devices.Count > 0 ? 0 : -1;
            if (devices.Count == 0) LiveStatus.Text = "No se encontraron dispositivos de audio para esa fuente.";
            DevicePicker.IsEnabled = !_isBusy && !_isLive;
        }
        catch (Exception error)
        {
            ShowError(error.Message);
        }
        finally
        {
            RefreshAudioButton.IsEnabled = !_isBusy;
        }
    }

    private void PublishCameraCheck_Changed(object sender, RoutedEventArgs e)
    {
        if (CameraPicker is null) return;
        CameraPicker.IsEnabled = PublishCameraCheck.IsChecked == true && !_isBusy;
    }

    private async void RefreshCameraButton_Click(object sender, RoutedEventArgs e) => await RefreshCamerasAsync();

    private async Task RefreshCamerasAsync(string? preferredName = null)
    {
        try
        {
            RefreshCameraButton.IsEnabled = false;
            IReadOnlyList<MediaDevice> cameras = await Task.Run(NativeMedia.GetCameras);
            CameraPicker.ItemsSource = cameras;
            int preferredIndex = preferredName is null ? -1 : cameras.ToList().FindIndex(device => device.Name == preferredName);
            CameraPicker.SelectedIndex = preferredIndex >= 0 ? preferredIndex : cameras.Count > 0 ? 0 : -1;
            PublishCameraCheck.IsEnabled = cameras.Count > 0 && !_isBusy;
        }
        catch (Exception error)
        {
            PublishCameraCheck.IsEnabled = false;
            CameraStatusText.Text = "Cámara: no disponible";
            ShowError(error.Message);
        }
        finally
        {
            RefreshCameraButton.IsEnabled = !_isBusy;
        }
    }

    private async void StartBroadcastButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || _isLive) return;
        if (!TryReadConfiguration(out RoomDraft? draft, out MediaDevice? audioDevice, out MediaDevice? cameraDevice, out AudioSourceKind source)) return;

        CreateRoomResponse? created = null;
        try
        {
            SetBusy(true);
            SetConnectionState("CREANDO SALA", "Preparando una sala segura en Q Session…", _waitingBrush);
            created = await _api.CreateRoomAsync(draft!);
            if (!created.MediaConfigured) throw new InvalidOperationException("El servidor multimedia todavía no está disponible.");

            var pending = new ActiveSession(
                created.Room.Code,
                created.HostToken,
                NormalizeJoinUrl(created.JoinUrl, created.Room.Code),
                created.Room.Name,
                created.Room.DjName,
                created.Room.RoomType,
                created.Room.Visibility,
                created.Room.StartedAt ?? DateTimeOffset.Now,
                source,
                audioDevice!.Name,
                cameraDevice is not null,
                cameraDevice?.Name);

            await ConnectMediaAsync(pending, audioDevice, cameraDevice, startCapture: true, openBrowserCapture: true, CancellationToken.None);
            ActivateSession(pending);
        }
        catch (Exception error)
        {
            CleanupNativeMedia();
            if (created is not null)
            {
                try { await _api.EndRoomAsync(created.Room.Code, created.HostToken); } catch { }
            }
            SetConnectionState("NO SE PUDO INICIAR", error.Message, _waitingBrush);
            ShowError(error.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private bool TryReadConfiguration(
        out RoomDraft? draft,
        out MediaDevice? audioDevice,
        out MediaDevice? cameraDevice,
        out AudioSourceKind source)
    {
        draft = null;
        audioDevice = DevicePicker.SelectedItem as MediaDevice;
        cameraDevice = PublishCameraCheck.IsChecked == true ? CameraPicker.SelectedItem as MediaDevice : null;
        source = (AudioSourcePicker.SelectedItem as AudioSourceOption)?.Kind ?? AudioSourceKind.BrowserTab;

        string roomName = RoomNameBox.Text.Trim();
        string hostName = HostNameBox.Text.Trim();
        if (roomName.Length < 2) return ValidationError("Escribe el nombre de la sesión.", RoomNameBox);
        if (hostName.Length < 2) return ValidationError("Escribe el nombre del anfitrión.", HostNameBox);
        if (RoomTypePicker.SelectedItem is not RoomTypeOption roomType) return ValidationError("Elige un tipo de sesión.", RoomTypePicker);
        if (audioDevice is null) return ValidationError("Elige el audio que vas a transmitir.", DevicePicker);
        if (PublishCameraCheck.IsChecked == true && cameraDevice is null) return ValidationError("Elige una cámara o desactiva la cámara.", CameraPicker);

        bool social = SocialProfilesCheck.IsChecked == true;
        draft = new RoomDraft(
            roomName,
            hostName,
            roomType.Value,
            PublicRoomRadio.IsChecked == true ? "public" : "private",
            string.IsNullOrWhiteSpace(RoomPasswordBox.Password) ? null : RoomPasswordBox.Password,
            PublicChatCheck.IsChecked == true,
            GuestCamerasCheck.IsChecked == true,
            social,
            social && MatchmakingCheck.IsChecked == true,
            social && ProfileGiftsCheck.IsChecked == true,
            TimeZoneInfo.Local.Id);
        return true;
    }

    private bool ValidationError(string message, Control control)
    {
        ShowError(message);
        control.Focus();
        return false;
    }

    private async Task ConnectMediaAsync(
        ActiveSession session,
        MediaDevice audioDevice,
        MediaDevice? cameraDevice,
        bool startCapture,
        bool openBrowserCapture,
        CancellationToken cancellationToken)
    {
        SetConnectionState("CONECTANDO", "Solicitando una credencial multimedia nueva…", _waitingBrush);
        MediaCredentialsResponse credentials = await _api.GetMediaCredentialsAsync(session.Code, session.HostToken, cancellationToken);
        MediaCredentialsResponse? browserCredentials = null;
        bool browserTab = session.AudioSource == AudioSourceKind.BrowserTab;
        if (browserTab && openBrowserCapture)
        {
            browserCredentials = await _api.GetMediaCredentialsAsync(session.Code, session.HostToken, cancellationToken);
        }

        if (!browserTab && (startCapture || NativeMedia.IsAudioCapturing() == 0))
        {
            NativeMedia.StopAudioCapture();
            await Task.Run(() => NativeMedia.StartAudio(session.AudioSource, audioDevice.Index), cancellationToken);
        }
        else if (browserTab)
        {
            NativeMedia.StopAudioCapture();
        }

        if (session.CameraEnabled && cameraDevice is not null && (startCapture || NativeMedia.IsCameraCapturing() == 0))
        {
            NativeMedia.StopCamera();
            int cameraResult = await Task.Run(() => NativeMedia.StartCamera(cameraDevice.Index), cancellationToken);
            if (cameraResult != 0) throw new InvalidOperationException(NativeMedia.GetCameraError());
        }

        NativeMedia.DisableVideo();
        NativeMedia.StopStream();
        int streamResult = await Task.Run(() => NativeMedia.StartStream(credentials.Url, credentials.Token, browserTab ? 0 : 1), cancellationToken);
        if (streamResult != 0) throw new InvalidOperationException(NativeMedia.GetStreamError());

        if (session.CameraEnabled && NativeMedia.IsCameraCapturing() != 0)
        {
            int videoResult = NativeMedia.EnableVideo(NativeMedia.GetCameraWidth(), NativeMedia.GetCameraHeight());
            if (videoResult != 0) throw new InvalidOperationException(NativeMedia.GetCameraError());
        }

        if (browserCredentials is not null)
        {
            OpenChromeTabCapture(session.Code, browserCredentials);
        }

        try
        {
            await _api.StartBroadcastDeliveryAsync(session.Code, session.HostToken, cancellationToken);
        }
        catch
        {
            // La captura LiveKit permanece activa. El mezclador de borde puede
            // recuperarse después sin cerrar la sala ni cortar el audio del DJ.
        }
    }

    private void ActivateSession(ActiveSession session)
    {
        _session = session;
        _store.Save(session);
        _isLive = true;
        _reconnectCancellation?.Cancel();
        _reconnectCancellation = new CancellationTokenSource();
        _powerGuard.Acquire();

        RoomCodeText.Text = FormatRoomCode(session.Code);
        JoinLinkText.Text = session.JoinUrl;
        CopyCodeButton.IsEnabled = true;
        CopyLinkButton.IsEnabled = true;
        StopBroadcastButton.IsEnabled = true;
        RecoverSessionButton.Visibility = Visibility.Collapsed;
        RetryNowButton.Visibility = Visibility.Collapsed;
        LiveTitle.Text = session.Name;
        CameraStatusText.Text = session.CameraEnabled ? "Cámara: en vivo" : "Cámara: desactivada";
        OpenChromeCaptureButton.IsEnabled = session.AudioSource == AudioSourceKind.BrowserTab;
        if (session.AudioSource == AudioSourceKind.BrowserTab)
        {
            OpenChromeCaptureButton.Content = "Mostrar selector";
            SetConnectionState("CONFIRMA EN CHROME", "Confirma una pestaña una sola vez. Después, la captura quedará oculta en segundo plano.", _waitingBrush);
        }
        else
        {
            SetConnectionState("EN VIVO", "La señal está activa. Puedes minimizar esta ventana sin interrumpirla.", _connectedBrush);
        }

        _meterTimer.Start();
        _connectionTimer.Start();
        _elapsedTimer.Start();
    }

    private async void RecoverSessionButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || _isLive) return;
        ActiveSession? saved = _store.Load();
        if (saved is null)
        {
            RecoverSessionButton.Visibility = Visibility.Collapsed;
            return;
        }

        try
        {
            SetBusy(true);
            AudioSourcePicker.SelectedIndex = Array.FindIndex(AudioSources, option => option.Kind == saved.AudioSource);
            await RefreshAudioDevicesAsync(saved.AudioDeviceName);
            MediaDevice? audioDevice = DevicePicker.Items.Cast<MediaDevice>().FirstOrDefault(device => device.Name == saved.AudioDeviceName)
                ?? DevicePicker.SelectedItem as MediaDevice;
            if (audioDevice is null) throw new InvalidOperationException("No se encontró la fuente de audio usada por esta sala.");

            MediaDevice? cameraDevice = null;
            if (saved.CameraEnabled)
            {
                PublishCameraCheck.IsChecked = true;
                await RefreshCamerasAsync(saved.CameraName);
                cameraDevice = CameraPicker.Items.Cast<MediaDevice>().FirstOrDefault(device => device.Name == saved.CameraName)
                    ?? CameraPicker.SelectedItem as MediaDevice;
                if (cameraDevice is null) throw new InvalidOperationException("No se encontró la cámara usada por esta sala.");
            }

            await ConnectMediaAsync(saved, audioDevice, cameraDevice, startCapture: true, openBrowserCapture: true, CancellationToken.None);
            ActivateSession(saved with { StartedAt = DateTimeOffset.Now });
        }
        catch (Exception error)
        {
            CleanupNativeMedia();
            SetConnectionState("NO SE PUDO RECUPERAR", error.Message, _waitingBrush);
            ShowError($"No pudimos recuperar la sala. Puede haber finalizado o cambiado de servidor.\n\n{error.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void ConnectionTimer_Tick(object? sender, EventArgs e)
    {
        if (!_isLive || _isStopping || _isReconnecting) return;
        if (NativeMedia.IsStreamConnected() != 0) return;
        await ReconnectAsync();
    }

    private async Task ReconnectAsync()
    {
        if (_session is null || _isReconnecting || !_isLive) return;
        _isReconnecting = true;
        RetryNowButton.Visibility = Visibility.Visible;
        int[] delays = [0, 2, 5, 10, 20, 30];
        try
        {
            for (int attempt = 0; _isLive && _session is not null; attempt++)
            {
                CancellationToken token = _reconnectCancellation?.Token ?? CancellationToken.None;
                int delay = delays[Math.Min(attempt, delays.Length - 1)];
                if (delay > 0)
                {
                    SetConnectionState("RECONECTANDO", $"La señal se interrumpió. Nuevo intento en {delay} segundos…", _waitingBrush);
                    await Task.Delay(TimeSpan.FromSeconds(delay), token);
                }

                try
                {
                    MediaDevice? audio = FindAudioDevice(_session.AudioDeviceName);
                    MediaDevice? camera = _session.CameraEnabled ? FindCamera(_session.CameraName) : null;
                    if (audio is null) throw new InvalidOperationException("La fuente de audio dejó de estar disponible.");
                    await ConnectMediaAsync(_session, audio, camera, startCapture: false, openBrowserCapture: false, token);
                    if (NativeMedia.IsStreamConnected() != 0)
                    {
                        SetConnectionState("EN VIVO", "Conexión recuperada automáticamente.", _connectedBrush);
                        RetryNowButton.Visibility = Visibility.Collapsed;
                        return;
                    }
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception error)
                {
                    SetConnectionState("RECONECTANDO", error.Message, _waitingBrush);
                }
            }
        }
        finally
        {
            _isReconnecting = false;
        }
    }

    private MediaDevice? FindAudioDevice(string name) =>
        DevicePicker.Items.Cast<MediaDevice>().FirstOrDefault(device => device.Name == name) ?? DevicePicker.SelectedItem as MediaDevice;

    private MediaDevice? FindCamera(string? name) =>
        CameraPicker.Items.Cast<MediaDevice>().FirstOrDefault(device => device.Name == name) ?? CameraPicker.SelectedItem as MediaDevice;

    private async void RetryNowButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isReconnecting)
        {
            _reconnectCancellation?.Cancel();
            _reconnectCancellation = new CancellationTokenSource();
            _isReconnecting = false;
        }
        await ReconnectAsync();
    }

    private void MeterTimer_Tick(object? sender, EventArgs e)
    {
        if (!_isLive) return;
        if (_session?.AudioSource == AudioSourceKind.BrowserTab)
        {
            LeftMeter.Value = 0;
            RightMeter.Value = 0;
            DroppedText.Text = "Audio de Chrome · medidor en la pestaña";
            return;
        }
        NativeMedia.GetAudioLevels(out float left, out float right);
        LeftMeter.Value = Math.Clamp(left, 0, 1);
        RightMeter.Value = Math.Clamp(right, 0, 1);
        ulong dropped = NativeMedia.GetDroppedAudioFrames() + NativeMedia.GetDroppedVideoFrames();
        DroppedText.Text = $"Paquetes descartados: {dropped:N0}";
        if (_session?.CameraEnabled == true)
        {
            CameraStatusText.Text = NativeMedia.IsVideoPublished() != 0 ? "Cámara: en vivo" : "Cámara: reconectando";
        }
    }

    private void ElapsedTimer_Tick(object? sender, EventArgs e)
    {
        if (_session is null) return;
        TimeSpan elapsed = DateTimeOffset.Now - _session.StartedAt;
        ElapsedText.Text = elapsed < TimeSpan.Zero ? "00:00:00" : $"{(int)elapsed.TotalHours:00}:{elapsed.Minutes:00}:{elapsed.Seconds:00}";
    }

    private void CopyCodeButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is not null) Clipboard.SetText(_session.Code);
    }

    private void CopyLinkButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is not null) Clipboard.SetText(_session.JoinUrl);
    }

    private async void OpenChromeCaptureButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session?.AudioSource != AudioSourceKind.BrowserTab || _isBusy) return;
        if (ChromeCaptureWindow.Show(_session.Code)) return;
        try
        {
            OpenChromeCaptureButton.IsEnabled = false;
            MediaCredentialsResponse credentials = await _api.GetMediaCredentialsAsync(_session.Code, _session.HostToken);
            OpenChromeTabCapture(_session.Code, credentials);
            SetConnectionState("CONFIRMA EN CHROME", "Elige la pestaña y marca “Compartir audio de la pestaña”. Después quedará oculta.", _waitingBrush);
        }
        catch (Exception error)
        {
            ShowError(error.Message);
        }
        finally
        {
            OpenChromeCaptureButton.IsEnabled = _isLive && _session?.AudioSource == AudioSourceKind.BrowserTab;
        }
    }

    private async void StopBroadcastButton_Click(object sender, RoutedEventArgs e) => await StopBroadcastAsync(endRoom: true);

    private async Task StopBroadcastAsync(bool endRoom)
    {
        if (_isStopping) return;
        _isStopping = true;
        ActiveSession? ending = _session;
        _isLive = false;
        _reconnectCancellation?.Cancel();
        SetConnectionState("FINALIZANDO", "Cerrando la señal de forma segura…", _waitingBrush);
        StopBroadcastButton.IsEnabled = false;

        CleanupNativeMedia();
        if (ending?.AudioSource == AudioSourceKind.BrowserTab)
        {
            ChromeCaptureWindow.Close(ending.Code);
        }
        if (endRoom && ending is not null)
        {
            try
            {
                await _api.EndRoomAsync(ending.Code, ending.HostToken);
            }
            catch (Exception error)
            {
                ShowError($"La señal local se detuvo, pero el servidor no confirmó el cierre: {error.Message}");
            }
        }

        _store.Clear();
        _session = null;
        _meterTimer.Stop();
        _connectionTimer.Stop();
        _elapsedTimer.Stop();
        _powerGuard.Dispose();
        _isStopping = false;
        ResetDashboard();
    }

    private void CleanupNativeMedia()
    {
        try { NativeMedia.DisableVideo(); } catch { }
        try { NativeMedia.StopCamera(); } catch { }
        try { NativeMedia.StopStream(); } catch { }
        try { NativeMedia.StopAudioCapture(); } catch { }
    }

    private void ResetDashboard()
    {
        RoomCodeText.Text = "—— ——";
        JoinLinkText.Text = "El enlace aparecerá al crear la sala";
        CopyCodeButton.IsEnabled = false;
        CopyLinkButton.IsEnabled = false;
        RetryNowButton.Visibility = Visibility.Collapsed;
        ElapsedText.Text = "00:00:00";
        LeftMeter.Value = 0;
        RightMeter.Value = 0;
        DroppedText.Text = "Paquetes descartados: 0";
        CameraStatusText.Text = "Cámara: desactivada";
        OpenChromeCaptureButton.IsEnabled = false;
        OpenChromeCaptureButton.Content = "Mostrar selector";
        LiveTitle.Text = "Tu señal aparecerá aquí";
        SetConnectionState("LISTO PARA EMPEZAR", "Configura la sala y selecciona el audio. Q Session cuidará la reconexión mientras esta aplicación permanezca abierta.", _offlineBrush);
    }

    private void SetBusy(bool busy)
    {
        _isBusy = busy;
        StartBroadcastButton.IsEnabled = !busy && !_isLive;
        RecoverSessionButton.IsEnabled = !busy && !_isLive;
        RoomNameBox.IsEnabled = !busy && !_isLive;
        HostNameBox.IsEnabled = !busy && !_isLive;
        RoomTypePicker.IsEnabled = !busy && !_isLive;
        AudioSourcePicker.IsEnabled = !busy && !_isLive;
        bool browserTab = (AudioSourcePicker.SelectedItem as AudioSourceOption)?.Kind == AudioSourceKind.BrowserTab;
        DevicePicker.IsEnabled = !busy && !_isLive && !browserTab;
        RefreshAudioButton.IsEnabled = !busy && !_isLive;
        PublishCameraCheck.IsEnabled = !busy && !_isLive && CameraPicker.Items.Count > 0;
        CameraPicker.IsEnabled = !busy && !_isLive && PublishCameraCheck.IsChecked == true;
        RefreshCameraButton.IsEnabled = !busy && !_isLive;
        PublicRoomRadio.IsEnabled = !busy && !_isLive;
        PrivateRoomRadio.IsEnabled = !busy && !_isLive;
    }

    private void SetConnectionState(string badge, string detail, Brush color)
    {
        ConnectionBadgeText.Text = badge;
        LiveStatus.Text = detail;
        ConnectionBadge.BorderBrush = color;
        ConnectionBadge.BorderThickness = new Thickness(1);
    }

    private static string FormatRoomCode(string code) => code.Length == 6 ? $"{code[..3]} {code[3..]}" : code;

    private static string NormalizeJoinUrl(string joinUrl, string code)
    {
        if (Uri.TryCreate(joinUrl, UriKind.Absolute, out Uri? absolute)) return absolute.ToString();
        return $"https://qsession.org/?room={Uri.EscapeDataString(code)}";
    }

    private void CaptureServer_CaptureStateChanged(string roomCode, string state, string detail)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (_session?.AudioSource != AudioSourceKind.BrowserTab
                || !string.Equals(_session.Code, roomCode, StringComparison.OrdinalIgnoreCase)) return;
            CaptureDiagnostics.Write(roomCode, state, detail);

            switch (state)
            {
                case "live":
                    OpenChromeCaptureButton.Content = "Ver o cambiar";
                    SetConnectionState("EN VIVO", "El audio aislado de Chrome sigue activo en segundo plano.", _connectedBrush);
                    _ = HideChromeCaptureWindowAsync(roomCode);
                    break;
                case "paused":
                    OpenChromeCaptureButton.Content = "Ver o cambiar";
                    SetConnectionState("EN PAUSA", "El audio de Chrome está pausado. Puedes volver a mostrar el control.", _waitingBrush);
                    break;
                case "selecting":
                    OpenChromeCaptureButton.Content = "Mostrar selector";
                    SetConnectionState("CONFIRMA EN CHROME", "Elige la pestaña y activa “Compartir audio de la pestaña”.", _waitingBrush);
                    break;
                case "error":
                    OpenChromeCaptureButton.Content = "Revisar captura";
                    SetConnectionState("REVISAR CHROME", string.IsNullOrWhiteSpace(detail) ? "La captura necesita atención. Q Session volvió a mostrar el control." : detail, _waitingBrush);
                    ChromeCaptureWindow.Show(roomCode);
                    break;
                default:
                    OpenChromeCaptureButton.Content = "Mostrar selector";
                    SetConnectionState("SIN AUDIO", "La sala sigue abierta. Pulsa “Mostrar selector” para volver a compartir una pestaña.", _waitingBrush);
                    break;
            }
        });
    }

    private static async Task HideChromeCaptureWindowAsync(string roomCode)
    {
        // Let Chrome finish painting its capture indicator before hiding only
        // Q Session's auxiliary app window. The protected system indicator stays.
        await Task.Delay(450);
        ChromeCaptureWindow.Hide(roomCode);
    }

    private void OpenChromeTabCapture(string roomCode, MediaCredentialsResponse credentials)
    {
        byte[] payloadBytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            url = credentials.Url,
            token = credentials.Token,
            room = roomCode,
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
            CaptureDiagnostics.Write(roomCode, "opening-chrome", "Ventana normal de Chrome preparada para seleccionar una pestaña.");
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

    private static void ShowError(string message) =>
        MessageBox.Show(message, "Q Session", MessageBoxButton.OK, MessageBoxImage.Information);

    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_allowClose)
        {
            if (_session?.AudioSource == AudioSourceKind.BrowserTab) ChromeCaptureWindow.Close(_session.Code);
            _api.Dispose();
            _powerGuard.Dispose();
            _captureServer.Dispose();
            return;
        }

        if (_isLive)
        {
            MessageBoxResult result = MessageBox.Show(
                "¿Quieres finalizar la transmisión y cerrar la sala?",
                "Q Session está transmitiendo",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (result != MessageBoxResult.Yes)
            {
                e.Cancel = true;
                return;
            }

            e.Cancel = true;
            await StopBroadcastAsync(endRoom: true);
            _allowClose = true;
            Close();
            return;
        }

        CleanupNativeMedia();
        if (_session?.AudioSource == AudioSourceKind.BrowserTab) ChromeCaptureWindow.Close(_session.Code);
        _api.Dispose();
        _powerGuard.Dispose();
        _captureServer.Dispose();
    }
}
