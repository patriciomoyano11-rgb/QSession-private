'use strict';

const byId = id => document.getElementById(id);
const ui = {
  roomBadge: byId('roomBadge'), captureIntro: byId('captureIntro'), start: byId('startCapture'),
  liveConsole: byId('liveConsole'), elapsed: byId('liveElapsed'), quality: byId('signalQuality'),
  equalizer: byId('equalizer'), left: byId('leftLevel'), right: byId('rightLevel'),
  leftDb: byId('leftDb'), rightDb: byId('rightDb'), pause: byId('pauseCapture'),
  pauseLabel: byId('pauseLabel'), change: byId('changeCapture'), stop: byId('stopCapture'),
  status: byId('captureStatus'),
};

let room;
let audioPublication;
let captureStream;
let capturedAudio;
let audioContext;
let animationFrame;
let elapsedTimer;
let roomTimer;
let commandTimer;
let commandBusy = false;
let startedAt = 0;
let paused = false;
let intentionalStop = false;
const CHROME_TAB_AUDIO_BITRATE = 510000;
const BROADCAST_AUDIO_BITRATES = Object.freeze([128000, 192000, 256000, 320000, CHROME_TAB_AUDIO_BITRATE]);
let audioBitrate = CHROME_TAB_AUDIO_BITRATE;
const bars = Array.from({length: 13}, () => {
  const bar = document.createElement('i');
  ui.equalizer.append(bar);
  return bar;
});

function readPayload() {
  try {
    const encoded = location.hash.slice(1);
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!/^wss?:\/\//i.test(value.url || '') || !value.token || !/^[A-Z0-9]{6}$/.test(value.room || '')) return null;
    history.replaceState(null, '', location.pathname);
    return value;
  } catch {
    return null;
  }
}

function normalizedAudioBitrate(value) {
  const numeric = Number(value);
  return BROADCAST_AUDIO_BITRATES.includes(numeric) ? numeric : CHROME_TAB_AUDIO_BITRATE;
}

const payload = readPayload();
audioBitrate = normalizedAudioBitrate(payload?.audioBitrate);
if (payload) document.title = `Q Session · Captura oculta · ${payload.room}`;
ui.roomBadge.textContent = payload ? `SALA ${payload.room}` : 'ENLACE INVÁLIDO';
ui.start.disabled = !payload;
if (!payload) setStatus('Este enlace no es válido. Vuelve a Q Session Desktop para abrir el selector.', 'error');

function setStatus(message, state = '') {
  ui.status.textContent = message;
  ui.status.dataset.state = state;
}

function notifyDesktop(state, detail = '') {
  if (!payload) return Promise.resolve();
  const query = new URLSearchParams({room: payload.room, state});
  if (detail) query.set('detail', String(detail).slice(0, 500));
  return fetch(`/api/capture-state?${query}`, {cache: 'no-store'}).catch(() => undefined);
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function levelOf(values) {
  let sum = 0;
  for (const value of values) {
    const sample = (value - 128) / 128;
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / values.length) * 3.2);
}

function chromeTabAudioConstraints() {
  return {
    channelCount: {ideal: 2},
    sampleRate: {ideal: 48000},
    sampleSize: {ideal: 24},
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

async function prepareChromeTabAudioTrack(track) {
  track.enabled = true;
  try {
    await track.applyConstraints(chromeTabAudioConstraints());
  } catch {
    // Chromium puede exponer un formato de loopback fijo. Conservamos la
    // pista capturada directamente, como en la ruta estable de Q Session.
  }
  try { track.contentHint = 'music'; } catch { /* contentHint no está disponible en todos los navegadores. */ }
}

async function configureChromeTabAudioSender(publication, requestedBitrate = audioBitrate) {
  const sender = publication?.track?.sender;
  if (!sender?.getParameters || !sender?.setParameters) return false;
  try {
    const bitrate = normalizedAudioBitrate(requestedBitrate);
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = bitrate;
    parameters.encodings[0].networkPriority = 'high';
    await sender.setParameters(parameters);
    return true;
  } catch {
    // El preset de publicación conserva el mismo valor como respaldo.
    return false;
  }
}

async function applyCaptureAudioBitrate(value) {
  audioBitrate = normalizedAudioBitrate(value);
  if (!audioPublication) return;
  const applied = await configureChromeTabAudioSender(audioPublication, audioBitrate);
  setStatus(applied
    ? `Calidad actualizada en vivo: hasta ${Math.round(audioBitrate / 1000)} kbps.`
    : `No fue posible cambiar la calidad ahora. Se aplicará al reconectar la pestaña.`,
  applied ? 'live' : 'error');
  await notifyDesktop('live', `${applied ? 'bitrate' : 'bitrate-error'}:${audioBitrate}`);
}

function dbLabel(level) {
  return level < .002 ? '−∞ dB' : `${Math.max(-60, 20 * Math.log10(level)).toFixed(1)} dB`;
}

async function startMeter(track) {
  stopMeter();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext = new AudioContext({sampleRate: 48000});
  await audioContext.resume();
  const source = audioContext.createMediaStreamSource(new MediaStream([track]));
  const splitter = audioContext.createChannelSplitter(2);
  const leftAnalyser = audioContext.createAnalyser();
  const rightAnalyser = audioContext.createAnalyser();
  const spectrum = audioContext.createAnalyser();
  leftAnalyser.fftSize = rightAnalyser.fftSize = 1024;
  spectrum.fftSize = 1024;
  spectrum.smoothingTimeConstant = .78;
  source.connect(splitter);
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, Math.min(1, source.channelCount - 1));
  source.connect(spectrum);
  const leftValues = new Uint8Array(leftAnalyser.fftSize);
  const rightValues = new Uint8Array(rightAnalyser.fftSize);
  const frequencies = new Uint8Array(spectrum.frequencyBinCount);
  startedAt = performance.now();
  elapsedTimer = setInterval(() => { ui.elapsed.textContent = formatElapsed(performance.now() - startedAt); }, 1000);

  const draw = () => {
    leftAnalyser.getByteTimeDomainData(leftValues);
    rightAnalyser.getByteTimeDomainData(rightValues);
    spectrum.getByteFrequencyData(frequencies);
    const left = paused ? 0 : levelOf(leftValues);
    const right = paused ? 0 : levelOf(rightValues);
    ui.left.style.transform = `scaleX(${left})`;
    ui.right.style.transform = `scaleX(${right})`;
    ui.leftDb.textContent = dbLabel(left);
    ui.rightDb.textContent = dbLabel(right);
    const bandSize = Math.max(1, Math.floor(frequencies.length / bars.length));
    bars.forEach((bar, index) => {
      let total = 0;
      for (let offset = 0; offset < bandSize; offset += 1) total += frequencies[index * bandSize + offset] || 0;
      const value = paused ? 0 : total / bandSize / 255;
      bar.style.height = `${16 + value * 210}px`;
    });
    const peak = Math.max(left, right);
    ui.quality.textContent = paused ? 'TRANSMISIÓN PAUSADA' : peak > .94 ? 'NIVEL MUY ALTO' : peak >= .12 ? 'SEÑAL ÓPTIMA' : peak >= .025 ? 'SEÑAL BAJA' : 'ESPERANDO AUDIO';
    animationFrame = requestAnimationFrame(draw);
  };
  animationFrame = requestAnimationFrame(draw);
}

function stopMeter() {
  cancelAnimationFrame(animationFrame);
  clearInterval(elapsedTimer);
  animationFrame = undefined;
  elapsedTimer = undefined;
  void audioContext?.close().catch(() => undefined);
  audioContext = undefined;
  bars.forEach(bar => { bar.style.height = '16px'; });
  ui.left.style.transform = ui.right.style.transform = 'scaleX(0)';
  ui.elapsed.textContent = '00:00';
}

async function roomStillOpen() {
  if (!payload || !captureStream) return;
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(payload.room)}`, {cache: 'no-store'});
    if (response.status === 404) await stopCapture('La sala finalizó. El audio de Chrome se detuvo.', '');
  } catch {
    // A temporary HTTP failure must not interrupt an active WebRTC publication.
  }
}

function startRoomMonitor() {
  clearInterval(roomTimer);
  roomTimer = setInterval(() => void roomStillOpen(), 5000);
}

async function checkDesktopCommand() {
  if (!payload || commandBusy) return;
  commandBusy = true;
  try {
    const query = new URLSearchParams({room: payload.room});
    const response = await fetch(`/api/capture-command?${query}`, {cache: 'no-store'});
    if (!response.ok) return;
    const result = await response.json();
    if (result.command === 'pause' && capturedAudio && !paused) togglePause();
    else if (result.command === 'resume' && capturedAudio && paused) togglePause();
    else if (/^bitrate:\d+$/.test(result.command || '')) await applyCaptureAudioBitrate(result.command.split(':')[1]);
    else if (result.command === 'stop') await stopCapture();
  } catch {
    // El control local es auxiliar; un fallo breve no interrumpe el audio WebRTC.
  } finally {
    commandBusy = false;
  }
}

function startCommandMonitor() {
  clearInterval(commandTimer);
  if (!payload) return;
  commandTimer = setInterval(() => void checkDesktopCommand(), 650);
}

async function stopCapture(message = 'La transmisión está detenida. Puedes elegir otra pestaña.', state = '') {
  intentionalStop = true;
  clearInterval(roomTimer);
  stopMeter();
  if (room) await room.disconnect().catch(() => undefined);
  room = undefined;
  audioPublication = undefined;
  captureStream?.getTracks().forEach(track => track.stop());
  captureStream = undefined;
  capturedAudio = undefined;
  paused = false;
  ui.pauseLabel.textContent = 'Pausar';
  ui.liveConsole.hidden = true;
  ui.captureIntro.hidden = false;
  ui.start.disabled = !payload;
  setStatus(message, state);
  await notifyDesktop('stopped');
  intentionalStop = false;
}

async function startCapture() {
  if (!payload) return;
  if (!navigator.mediaDevices?.getDisplayMedia || !window.LivekitClient) {
    setStatus('Abre este enlace en Google Chrome para compartir el audio de una pestaña.', 'error');
    return;
  }
  ui.start.disabled = true;
  setStatus('Esperando que elijas una pestaña de Chrome…');
  await notifyDesktop('selecting');
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {displaySurface: 'browser', width: 320, height: 180, frameRate: 1},
      audio: {...chromeTabAudioConstraints(), suppressLocalAudioPlayback: false},
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'exclude',
      systemAudio: 'include', windowAudio: 'system',
      audioSelection: 'preferred',
    });
    const [videoTrack] = stream.getVideoTracks();
    const [audioTrack] = stream.getAudioTracks();
    if (videoTrack?.getSettings().displaySurface !== 'browser') {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Elige “Pestaña de Chrome”, no una ventana ni la pantalla completa.');
    }
    if (!audioTrack) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Chrome no recibió audio. Activa “Compartir audio de la pestaña” antes de confirmar.');
    }

    videoTrack?.stop();
    await prepareChromeTabAudioTrack(audioTrack);
    captureStream = stream;
    capturedAudio = audioTrack;
    setStatus('Pestaña confirmada. Conectando su audio con Q Session…');
    const LiveKit = window.LivekitClient;
    room = new LiveKit.Room({adaptiveStream: false, dynacast: false});
    await room.connect(payload.url, payload.token, {autoSubscribe: false});
    audioPublication = await room.localParticipant.publishTrack(audioTrack, {
      name: 'qsession-chrome-tab-audio',
      source: LiveKit.Track.Source.ScreenShareAudio,
      forceStereo: true,
      dtx: false,
      red: false,
      audioPreset: {maxBitrate: audioBitrate, priority: 'high'},
    });
    await configureChromeTabAudioSender(audioPublication, audioBitrate);
    audioTrack.addEventListener('ended', () => void stopCapture(), {once: true});
    room.on(LiveKit.RoomEvent.Disconnected, () => {
      if (!intentionalStop) setStatus('La conexión se cerró. Vuelve a Q Session Desktop y abre nuevamente el selector.', 'error');
    });
    ui.captureIntro.hidden = true;
    ui.liveConsole.hidden = false;
    await startMeter(audioTrack).catch(() => undefined);
    startRoomMonitor();
    setStatus('El audio de esta pestaña se está transmitiendo en vivo.', 'live');
    await notifyDesktop('live');
  } catch (error) {
    await stopCapture();
    const cancelled = ['NotAllowedError', 'AbortError'].includes(error?.name);
    const message = cancelled ? 'No elegiste una pestaña. Puedes volver a intentarlo.' : error?.message || 'Chrome no pudo compartir esa pestaña.';
    setStatus(message, 'error');
    await notifyDesktop('error', message);
  }
}

function togglePause() {
  if (!capturedAudio) return;
  paused = !paused;
  capturedAudio.enabled = !paused;
  ui.pauseLabel.textContent = paused ? 'Reanudar' : 'Pausar';
  setStatus(paused ? 'El envío está pausado.' : 'El audio de esta pestaña se está transmitiendo en vivo.', paused ? '' : 'live');
  void notifyDesktop(paused ? 'paused' : 'live');
}

ui.start.addEventListener('click', () => void startCapture());
ui.pause.addEventListener('click', togglePause);
ui.change.addEventListener('click', async () => { await stopCapture('Elige una nueva pestaña.'); await startCapture(); });
ui.stop.addEventListener('click', () => void stopCapture());
window.addEventListener('beforeunload', () => {
  clearInterval(commandTimer);
  captureStream?.getTracks().forEach(track => track.stop());
  void room?.disconnect();
  void notifyDesktop('stopped');
});

startCommandMonitor();
