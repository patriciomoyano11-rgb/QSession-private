const fs = require('node:fs');
const path = require('node:path');

describe('QSession native Android listener audio', () => {
  const client = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'QSessionNativeAudioClient.ts'),
    'utf8',
  );
  const engine = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'QSessionAudioEngine.tsx'),
    'utf8',
  );
  const playbackService = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'android',
      'app',
      'src',
      'main',
      'java',
      'org',
      'qsession',
      'app',
      'QSessionPlaybackService.kt',
    ),
    'utf8',
  );
  const mainActivity = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'android',
      'app',
      'src',
      'main',
      'java',
      'org',
      'qsession',
      'app',
      'MainActivity.kt',
    ),
    'utf8',
  );
  const webApp = fs.readFileSync(
    path.join(__dirname, '..', '..', 'platform', 'public', 'app.js'),
    'utf8',
  );
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const headlessTask = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'QSessionAudioHeadlessTask.ts'),
    'utf8',
  );

  test('requests a hidden audio-only listener and never subscribes to video', () => {
    expect(client).toContain('nativeAudio: true');
    expect(client).toContain('autoSubscribe: false');
    expect(client).toContain('publication.kind === Track.Kind.Audio');
  });

  test('uses the Android music stream configuration and reports readiness', () => {
    expect(client).toContain('await playback?.hasWiredOrUsbOutput?.()');
    expect(client).toContain('qsessionMusicAudioTypeOptions(\n            existingPhysicalHeadphones,');
    expect(client).toContain("? ['headset', 'bluetooth', 'speaker', 'earpiece']");
    expect(client).toContain(": ['bluetooth', 'headset', 'speaker', 'earpiece']");
    expect(client).toContain("AudioSession.selectAudioOutput('headset')");
    expect(engine).toContain("JSON.stringify({type: 'ready'})");
  });

  test('starts foreground playback before networking and reconnects after interruption', () => {
    expect(client.indexOf('?.start(session.server, session.roomCode')).toBeLessThan(
      client.indexOf('const response = await fetch'),
    );
    expect(client).toContain('.on(RoomEvent.Disconnected');
    expect(client).toContain('this.scheduleReconnect()');
    expect(client).toContain('private activeSession: ActiveNativeAudioSession | null');
    expect(client).toContain('ensureBackgroundPlayback');
    expect(client).toContain('async resume()');
    expect(engine).toContain("command.type === 'listener-resume'");
    expect(playbackService).toContain('listenerWatchdogHandler.postDelayed(listenerWatchdog, 10_000L)');
    expect(playbackService).toContain('class QSessionPlaybackService : HeadlessJsTaskService()');
    expect(playbackService).toContain('HeadlessJsTaskConfig(');
    expect(playbackService).toContain('"QSessionAudioPlayback"');
    expect(playbackService).toContain('0L');
    expect(index).toContain('AppRegistry.registerHeadlessTask(');
    expect(headlessTask).toContain('return new Promise');
    expect(engine).not.toContain('subscription.remove();\n      void client.stop();');
    expect(playbackService).toContain('QSessionWebAudioBridge.send("{\\\"type\\\":\\\"listener-resume\\\"}")');
    expect(playbackService).toContain('registerDefaultNetworkCallback(networkCallback)');
    expect(playbackService).toContain('Intent.ACTION_SCREEN_OFF');
    expect(playbackService).toContain('ACTION_REASSERT_AUDIO_FOCUS');
    expect(playbackService).toContain('setAcceptsDelayedFocusGain(true)');
    expect(playbackService).toContain('setOnAudioFocusChangeListener(audioFocusChangeListener)');
    expect(playbackService).toContain('AudioManager.AUDIOFOCUS_GAIN ->');
    expect(playbackService).toContain('audioFocusRetryHandler.postDelayed');
    expect(playbackService).toContain('persistListenerSession(session)');
    expect(playbackService).toContain('loadPersistedListenerSession()');
    expect(playbackService).toContain('if (mode != Mode.BROADCAST) {');
    expect(playbackService).toContain('(application as? MainApplication)?.ensureAudioEngineStarted()');
    expect(playbackService).toContain('if (mode == Mode.NATIVE_LISTEN &&');
    const destroyBody = playbackService
      .split('override fun onDestroy()')[1]
      .split('override fun onHeadlessJsTaskFinish')[0];
    expect(destroyBody).not.toContain('listener-runtime-stop');
  });

  test('stops listener audio on an explicit room or app exit', () => {
    expect(playbackService).toContain('override fun onTaskRemoved(rootIntent: Intent?)');
    expect(playbackService).toContain('if (mode != Mode.BROADCAST) stopPlaybackRuntime()');
    expect(playbackService).toContain('if (mode == Mode.WEB_LISTEN)');
    expect(playbackService).toContain('clearPersistedListenerSession(this)');
    expect(playbackService).toMatch(/fun clearPersistedListenerSession[\s\S]*?\.commit\(\)/);
    expect(playbackService).toContain('listener-runtime-stop');
    expect(mainActivity).toContain('stopListenerPlaybackForExplicitExit(message)');
    expect(mainActivity).toContain('listenerStopFallbackHandler.postDelayed(listenerStopFallback, 3_000L)');
    expect(playbackService).toContain('shutdownFallbackHandler.postDelayed(shutdownFallback, 3_000L)');
    expect(client).toContain('this.applyTrackGain(track, 0)');
    expect(client).toContain('track.mediaStreamTrack.enabled = false');
    expect(mainActivity).toContain('isFinishing && !isChangingConfigurations');
  });

  test('applies the listener output preset to native Android playback', () => {
    expect(client).toContain('private outputGain = 1');
    expect(client).toContain('setOutputGain(gain: number)');
    expect(client).toContain('Math.max(0.501, Math.min(1, numeric))');
    expect(client).toContain('AudioSession.setDefaultRemoteAudioTrackVolume(1)');
    expect(client).not.toContain('AudioSession.setDefaultRemoteAudioTrackVolume(appliedGain)');
    expect(client).toContain('forcedGain === undefined');
    expect(client).toContain('? this.muted');
    expect(client).toContain(': this.outputGain');
    expect(engine).toContain("command.type === 'listener-output-gain'");
    expect(engine).toContain('client.setOutputGain(Number(command.gain))');
  });

  test('keeps WebView playback available until the native stereo renderer is ready', () => {
    expect(webApp).toContain("typeof window.QSessionPlaybackBridge?.postMessage === 'function'");
    expect(webApp).toContain('window.QSessionPlaybackBridge.postMessage(JSON.stringify(command))');
    expect(webApp).not.toContain("typeof window.QSessionNativeBridge?.postMessage === 'function'");
    expect(webApp).toContain("window.addEventListener('qsession-native-audio-status'");
    expect(webApp).toContain('state.nativeAudioReady = true');
    expect(webApp).toContain('hasNativeAndroidAudio() && state.nativeAudioReady && !state.nativeAudioFallback');
    expect(webApp).toContain('return state.listenerMuted || listenerShouldUseNativeAudio() ? 0 : state.listenerOutputGain');
    expect(webApp).toContain('state.nativeAudioFallback = false');
    expect(webApp).toContain('applyListenerWebAudioVolume();');
    expect(webApp).toContain('async function resumeListenerAudio');
    expect(webApp).toContain('function scheduleListenerAudioRecovery');
    expect(webApp).toContain("type: 'listener-audio-focus'");
    expect(webApp).toContain("window.addEventListener('qsession-native-audio-resume'");
    expect(webApp).toContain('element.muted = listenerAudioElementShouldStayMuted()');
    expect(webApp).toMatch(/postNativeAudioCommand\(\{\s*type: 'listener-start'/);
    expect(webApp).toContain("type: 'listener-output-gain'");
    expect(webApp).toMatch(/state\.mediaRole === 'listener' && !hasNativeAndroidAudio\(\)/);
    expect(webApp).toContain("await room.connect(credentials.url, credentials.token, {autoSubscribe: false})");
    expect(webApp).toContain("if (state.mediaRole !== 'listener') return false");
    expect(webApp).toContain('return !listenerShouldUseNativeAudio();');
    expect(webApp).toContain('.on(LiveKit.RoomEvent.TrackPublished, () => { void loadPeople(); })');
  });

  test('connects the visible room before native playback and does not stop a listener during retry', () => {
    const connectMedia = webApp.split('async function connectMedia(role)')[1]
      .split('function setMediaControlsActive')[0];
    expect(connectMedia).toContain("preserveNativeListener: role === 'listener' && hasNativeAndroidAudio()");
    expect(connectMedia.indexOf("await room.connect(credentials.url, credentials.token, {autoSubscribe: false})"))
      .toBeLessThan(connectMedia.indexOf("type: 'listener-start'"));
    expect(webApp).toContain('async function disconnectMedia({keepConsole = true, preserveNativeListener = false} = {})');
    expect(webApp).toContain("state.mediaRole === 'listener' && !preserveNativeListener");
  });
});
