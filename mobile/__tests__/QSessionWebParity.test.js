const fs = require('node:fs');
const path = require('node:path');

describe('QSession Android canonical web interface and native media plane', () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
  const mainActivity = read(
    'android', 'app', 'src', 'main', 'java', 'org', 'qsession', 'app', 'MainActivity.kt',
  );
  const androidManifest = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const systemBars = read(
    'android', 'app', 'src', 'main', 'java', 'org', 'qsession', 'app', 'QSessionSystemBars.kt',
  );
  const playbackService = read(
    'android', 'app', 'src', 'main', 'java', 'org', 'qsession', 'app', 'QSessionPlaybackService.kt',
  );
  const playbackModule = read(
    'android', 'app', 'src', 'main', 'java', 'org', 'qsession', 'app', 'QSessionPlaybackModule.kt',
  );
  const firebaseService = read(
    'android', 'app', 'src', 'main', 'java', 'org', 'qsession', 'app', 'QSessionFirebaseMessagingService.kt',
  );
  const edgeAudioPlayer = read(
    'android', 'app', 'src', 'main', 'java', 'org', 'qsession', 'app', 'QSessionEdgeAudioPlayer.kt',
  );
  const mainApplication = read(
    'android', 'app', 'src', 'main', 'java', 'org', 'qsession', 'app', 'MainApplication.kt',
  );
  const webHome = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'index.html'),
    'utf8',
  );
  const webApp = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'app.js'),
    'utf8',
  );
  const webStyles = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'styles.css'),
    'utf8',
  );
  const webStudioStyles = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'studio-light.css'),
    'utf8',
  );
  const webMixer = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'dj-mixer.js'),
    'utf8',
  );
  const webMusic = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'music-library.js'),
    'utf8',
  );
  const serviceWorker = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'sw.js'),
    'utf8',
  );
  const assetLinks = JSON.parse(fs.readFileSync(
    path.join(
      __dirname, '..', '..', 'platform', 'public', '.well-known', 'assetlinks.json',
    ),
    'utf8',
  ));
  const androidTheme = read('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');

  test('renders the one production interface instead of a second Android design', () => {
    expect(mainActivity).toContain('class MainActivity : Activity()');
    expect(mainActivity).toContain('private const val QSESSION_ORIGIN = "https://qsession.org"');
    expect(mainActivity).toContain('private fun createQSessionWebView() = WebView(this)');
    expect(mainActivity).toContain('webView.loadUrl(qSessionUrlFromIntent(intent))');
    expect(mainActivity).toContain('QSessionAndroid/${BuildConfig.VERSION_NAME}');
    expect(mainActivity).toContain('cacheMode = WebSettings.LOAD_NO_CACHE');
    expect(mainActivity).toContain('appendQueryParameter("androidVersion", BuildConfig.VERSION_NAME)');
    expect(mainActivity).not.toContain('class MainActivity : ReactActivity()');
    expect(mainActivity).not.toContain('getMainComponentName');
  });

  test('exposes all canonical En vivo, Personas, Chat and Global functions', () => {
    expect(webHome).toMatch(/data-view="live"[^>]*>[\s\S]*?<span>En vivo<\/span>/);
    expect(webHome).toMatch(/data-view="people"[^>]*>[\s\S]*?<span>Personas<\/span>/);
    expect(webHome).toMatch(/data-view="chat"[^>]*>[\s\S]*?<span>Chat<\/span>/);
    expect(webHome).toMatch(/data-view="global"[^>]*>[\s\S]*?<span>Global<\/span>/);
    expect(webHome).toContain('id="peopleGrid"');
    expect(webHome).toContain('id="privateChatPanel"');
    expect(webHome).toContain('id="publicChatPanel"');
    expect(webApp).toContain("all('button[data-view], [data-route]').forEach");
    expect(webApp).toContain('showView(control.dataset.view || control.dataset.route)');
  });

  test('shares unambiguous media-control states with Android', () => {
    expect(webApp).toContain('function mediaActionPresentation');
    expect(webApp).toContain("{icon: 'pause', state: 'active'}");
    expect(webApp).toContain("{icon: 'play', state: 'paused'}");
    expect(webApp).toContain("{icon: 'volume-muted', state: 'muted'}");
    expect(webStyles).toContain('.media-icon-action[data-control-state="active"]');
    expect(webStyles).toContain('.media-icon-action:disabled::after');
  });

  test('keeps native permissions, invitation links, clipboard and Android sharing', () => {
    expect(mainActivity).toContain('addJavascriptInterface(NativeBridge(), "QSessionNativeBridge")');
    expect(mainActivity).toContain('fun copyText(label: String, text: String)');
    expect(mainActivity).toContain('fun shareRoom(title: String, text: String)');
    expect(mainActivity).toContain('Intent.ACTION_SEND');
    expect(mainActivity).toContain('handleMediaPermissionRequest(request)');
    expect(androidManifest).toContain('<intent-filter android:autoVerify="true">');
    expect(androidManifest).toContain('<data android:scheme="https" android:host="qsession.org" />');
    expect(androidManifest).toContain('android:launchMode="singleTask"');
    expect(mainActivity).toContain('override fun onNewIntent(intent: Intent)');
    expect(mainActivity).toContain('if (intent.data != null)');
    expect(playbackService).toContain('qsession://join?room=$roomCode');
  });

  test('shows native alerts for private messages and incoming calls', () => {
    expect(androidManifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(mainActivity).toContain('fun requestNotificationPermission()');
    expect(mainActivity).toContain('fun showSocialNotification(');
    expect(firebaseService).toContain('MESSAGE_CHANNEL');
    expect(firebaseService).toContain('CALL_CHANNEL');
    expect(firebaseService).toContain('Notification.CATEGORY_MESSAGE');
    expect(firebaseService).toContain('Notification.CATEGORY_CALL');
    expect(firebaseService).toContain('appendQueryParameter("conversation", conversationId)');
    expect(firebaseService).toContain('class QSessionFirebaseMessagingService');
    expect(mainActivity).toContain('fun requestPushToken()');
    expect(webApp).toContain("'/api/push/devices'");
    expect(webApp).toContain('connectProfileActivityRealtime(result.realtime)');
    expect(webApp).toContain("['message', 'call'].includes(action.type)");
    expect(webApp).toContain('bridge.showSocialNotification(');
    expect(webApp).toContain('notifyMembers: !state.answeringPrivateCall');
  });

  test('binds qsession.org invitations to the permanent Android release identity', () => {
    expect(assetLinks).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'org.qsession.app',
          sha256_cert_fingerprints: [
            '3E:A3:EB:CC:15:81:8A:4E:08:F7:23:6D:EA:05:57:02:F8:40:FC:65:A8:FE:62:31:F3:BC:7B:43:29:7F:47:14',
          ],
        },
      },
    ]);
  });

  test('uses the exact web audio renderer with native background continuity', () => {
    expect(mainActivity).toContain('addJavascriptInterface(PlaybackBridge(), "QSessionPlaybackBridge")');
    expect(webApp).toContain("typeof window.QSessionPlaybackBridge?.postMessage === 'function'");
    expect(webApp).toContain('window.QSessionPlaybackBridge.postMessage(JSON.stringify(command))');
    expect(webApp).toContain("preserveNativeListener: role === 'listener' && hasNativeAndroidAudio()");
    expect(mainActivity).toContain('setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)');
    expect(mainActivity).toContain("send({type: 'listener-web-service-start', roomCode: code})");
    expect(mainActivity).toContain('new MutationObserver(syncListenerService)');
    expect(mainActivity).not.toContain('attachNativeAudioEngine()');
    const applicationCreate = mainApplication
      .split('override fun onCreate()')[1]
      .split('@Synchronized')[0];
    expect(applicationCreate).not.toContain('LiveKitReactNative.setup');
    expect(applicationCreate).not.toContain('ensureAudioEngineStarted()');
    expect(androidManifest).toContain('android:stopWithTask="false"');
    expect(androidManifest).toContain('android:foregroundServiceType="mediaPlayback|microphone|camera"');
    expect(playbackService).toContain('PowerManager.PARTIAL_WAKE_LOCK');
    expect(playbackService).toContain('WifiManager.WIFI_MODE_FULL_HIGH_PERF');
    expect(playbackService).toContain('return START_REDELIVER_INTENT');
    expect(playbackService).toContain('ACTION_START_WEB_PLAYBACK');
    expect(playbackService).toContain('ACTION_REASSERT_AUDIO_FOCUS');
    expect(playbackService).toContain('Mode.WEB_LISTEN');
    expect(playbackService).toContain('mode == Mode.NATIVE_LISTEN || mode == Mode.WEB_LISTEN');
    expect(mainActivity).toContain('if (activityInBackground) return');
    expect(mainActivity).toContain('stopListenerPlaybackForExplicitExit(message)');
    expect(playbackService).toContain('listenerWatchdog');
    expect(playbackService).toContain('override fun onTaskRemoved(rootIntent: Intent?)');
    expect(playbackService).toContain('if (mode != Mode.BROADCAST) stopPlaybackRuntime()');
    expect(playbackService).toContain('registerDefaultNetworkCallback(networkCallback)');
    expect(playbackService).toContain('Intent.ACTION_SCREEN_OFF');
    expect(playbackService).toContain('setAcceptsDelayedFocusGain(true)');
    expect(mainActivity).toContain('reassertListenerAudioFocus()');
    expect(mainActivity).toContain("qsession-native-audio-resume");
    expect(webApp).toContain('scheduleListenerAudioRecovery()');
    expect(androidManifest).not.toContain('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(playbackModule).not.toContain('Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(playbackModule).toContain('promise.resolve(true)');
    expect(webApp).toMatch(/state\.mediaRole === 'listener' && !hasNativeAndroidAudio\(\)/);
  });

  test('receives the adaptive qDJ mixer and blue QSession studio in Android', () => {
    expect(webHome).toContain('/dj-mixer.js?v=20261016-autodj-calibration-v2');
    expect(webHome).toContain('/music-library.js?v=20261016-autodj-calibration-v2');
    expect(webHome).toContain('/studio-light.css?v=20261015-blue-music-v1');
    expect(webHome).toContain('/qsession-sky-palette.css?v=20261016-sky-palette-v1');
    expect(webHome.indexOf('/dj-mixer.js')).toBeLessThan(webHome.indexOf('/music-library.js'));
    expect(webMixer).toContain('function transitionProfile(');
    expect(webMixer).toContain("id='lift'");
    expect(webMixer).toContain("id='release'");
    expect(webMixer).toContain("id='contrast'");
    expect(webMixer).toContain("id='handoff'");
    expect(webMixer).toContain('alignedIncomingTime');
    expect(webMusic).toContain('mixer.journey=journey');
    expect(webMusic).toContain("profile.label||'transición conservadora'");
    expect(webStudioStyles).toContain('QSession music identity');
    expect(serviceWorker).toContain("qsession-20261016-global-rave-paused-v1");
  });

  test('hands edge HLS audio to Android while the screen is locked', () => {
    expect(mainActivity).toContain('volumeControlStream = android.media.AudioManager.STREAM_MUSIC');
    expect(mainActivity).toContain('"listener-edge-start"');
    expect(mainActivity).toContain('setEdgeBackgroundPlayback(true)');
    expect(mainActivity).toContain('override fun onPause()');
    expect(mainActivity.indexOf('setEdgeBackgroundPlayback(true)')).toBeLessThan(
      mainActivity.indexOf('notifyWebEdgeBackground(true)'),
    );
    expect(mainActivity).toContain("qsession-native-edge-background");
    expect(playbackService).toContain('ACTION_START_EDGE_PLAYBACK');
    expect(playbackService).toContain('Mode.EDGE_LISTEN');
    expect(playbackService).toContain('setEdgeBackgroundPlayback(true)');
    expect(edgeAudioPlayer).toContain('AudioAttributes.Builder()');
    expect(edgeAudioPlayer).toContain('setUsage(C.USAGE_MEDIA)');
    expect(edgeAudioPlayer).toContain('setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true)');
    expect(edgeAudioPlayer).toContain('setWakeMode(C.WAKE_MODE_NETWORK)');
    expect(edgeAudioPlayer).toContain('recoverAtLiveEdge');
    expect(edgeAudioPlayer).not.toContain('setStreamVolume');
    expect(webApp).toContain("type: 'listener-edge-start'");
    expect(webApp).toContain("qsession-native-edge-background");
    expect(webApp).toContain('state.broadcastHls?.stopLoad?.()');
    expect(webApp).toContain("type: 'listener-edge-foreground-ready'");
  });

  test('keeps direct audio and video until the edge stream is truly ready', () => {
    expect(webApp).toContain('state.broadcastUsingEdge && state.broadcastEdgeReady');
    expect(webApp).toContain('state.broadcastEdgeReady = true');
    expect(webApp).toContain('Preparando la señal distribuida sin interrumpir la señal directa');
    expect(webApp).toContain('Este teléfono está recuperando automáticamente el audio y el video');
  });

  test('protects a web DJ broadcast with the Android foreground service', () => {
    expect(mainActivity).toContain('installNativeLifecycleHooks(view)');
    expect(mainActivity).not.toContain("document.getElementById('startBroadcast')?.addEventListener('click'");
    expect(mainActivity).toContain('command.optBoolean("requiresMicrophone", true)');
    expect(mainActivity).toContain('EXTRA_REQUIRES_MICROPHONE, requiresMicrophone');
    expect(playbackService).toContain('mode == Mode.BROADCAST && broadcastRequiresMicrophone');
    expect(playbackService).toContain('catch (error: Exception)');
    expect(playbackService).toContain('broadcast-service-ready');
    expect(webApp).toMatch(/type:\s*'broadcast-service-start'/);
    expect(webApp).toContain("postNativeAudioCommand({type: 'broadcast-service-stop'})");
  });

  test('shares the canonical content notice without restoring a retired Android-only confirmation', () => {
    expect(webHome).toContain('Contenido preparado para una audiencia pública.');
    expect(webHome).toContain('Usa la biblioteca original de Qsession');
    expect(webHome).not.toContain('id="musicRightsDeclaration"');
    expect(webHome).not.toContain('id="musicRightsAccepted"');
    expect(webApp).not.toContain("if (!byId('musicRightsAccepted').checked)");
  });

  test('keeps phone status and navigation data legible on light surfaces', () => {
    expect(systemBars).toContain('isAppearanceLightStatusBars = true');
    expect(systemBars).toContain('isAppearanceLightNavigationBars = true');
    expect(systemBars).toContain('isNavigationBarContrastEnforced = false');
    expect(systemBars).toContain('content.setBackgroundColor(surfaceColor)');
    expect(mainActivity).toContain('QSessionSystemBars.apply(this)');
    expect(androidTheme).toContain('<item name="android:statusBarColor">#F7F4EE</item>');
    expect(androidTheme).toContain('<item name="android:navigationBarColor">#F7F4EE</item>');
  });
});
