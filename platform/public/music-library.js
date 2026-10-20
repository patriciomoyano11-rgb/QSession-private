/* QSession music library, original catalog importer and continuous DJ autopilot. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = 'metadata';
  let catalog = null;
  let queue = [];
  let pendingSet=null,pendingTarget=null,pendingRevision=0,setEpoch=0;
  let current = null;
  let playlists = [];
  let family = 'electronic';
  let browseAll = false;
  let browseFamily = null, browsePage = 0;
  const browsePageSize = 12;
  let generation = 0;
  let context = null;
  let mixer = null;
  let prepareTask = null;
  let gain = null;
  let destination = null;
  let broadcasting = false;
  let playbackRequested = false;
  let loading = false;
  let adminMode = false;
  let autopilot = true;
  let autopilotLoading = false;
  let targetBpm = 124;
  let bpmManual = false;
  let transitioning = false;
  let liveSteering=false,liveEnergy=3,liveCurve='steady',liveRevision=0,liveTimer=null,liveTask=null,liveAbort=null;
  let manualPreparation=false,manualTransitionPending=false;
  let requestInterpretation='';
  const liveMoods=['any','deep','warm','euphoric','sensual','meditative','focused','celebratory','dark'];
  const liveMoodNames=['Cualquiera','Profunda','Cálida','Eufórica','Sensual','Meditativa','Enfocada','Celebración','Oscura'];
  const liveEnergyNames=['Suave','Baja','Media','Alta','Intensa'];
  let feedback = {};
  let roomTrackId = null;
  let playHistory = [];
  let selectionHistory = [], playlistRotation = 0, lastSelectionInfo = null;
  try { const saved=JSON.parse(localStorage.getItem('qsession-dj-history')||'[]'); if(Array.isArray(saved))playHistory=saved.slice(-100); } catch {}
  try { const saved=JSON.parse(localStorage.getItem('qsession-dj-selection-history')||'[]'); if(Array.isArray(saved))selectionHistory=saved.slice(-200);playlistRotation=Math.max(0,Number(localStorage.getItem('qsession-dj-playlist-rotation'))||0); } catch {}
  function rememberPlayback(track){
    if(playHistory.at(-1)?.id===track.id)return;
    playHistory.push({id:track.id,artist:track.artist,at:Date.now()});playHistory=playHistory.slice(-100);
    try{localStorage.setItem('qsession-dj-history',JSON.stringify(playHistory));}catch{}
  }
  function rememberSelection(tracks){
    const at=Date.now();selectionHistory.push(...tracks.map((track,index)=>({id:track.id,artist:track.artist,at:at+index})));selectionHistory=selectionHistory.slice(-200);
    try{localStorage.setItem('qsession-dj-selection-history',JSON.stringify(selectionHistory));}catch{}
  }
  function nextPlaylistRotation(){playlistRotation=(playlistRotation+1)%1000000;try{localStorage.setItem('qsession-dj-playlist-rotation',String(playlistRotation));}catch{}return playlistRotation;}
  const pendingVotes = new Set();

  const icon = name => ({
    previous:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5h3v14H5zm14 0v14L9 12z"/></svg>',
    play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m8 5 12 7-12 7z"/></svg>',
    pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>',
    next:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 5h3v14h-3zM5 5l10 7-10 7z"/></svg>',
    volume:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4 5 9H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    sparkle:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c.7 5.1 3.3 7.7 8.4 8.4-5.1.7-7.7 3.3-8.4 8.4-.7-5.1-3.3-7.7-8.4-8.4 5.1-.7 7.7-3.3 8.4-8.4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    clock:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    pulse:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h4l2-6 4 11 2-7 2 2h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mood:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10h.01M15.5 10h.01M8.5 14c1.8 2 5.2 2 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wave:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12c2.3-5 4.7-5 7 0s4.7 5 7 0 4.7-5 7 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    bolt:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13.5 2-7 11h5L10.5 22l7-12h-5l1-8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    mix:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M10 14v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="7" r="2" fill="currentColor"/><circle cx="10" cy="17" r="2" fill="currentColor"/></svg>',
    queue:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h10M5 12h10M5 17h7M18 15v6m-3-3h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    fx:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Zm7 12 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    transition:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h5c4 0 3 10 7 10h4M17 14l3 3-3 3M4 17h3c1.6 0 2.5-1.6 3.2-3.5M17 4l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h7l2-2h9v13H3v-11Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  })[name];

  const dialog = document.createElement('section');
  dialog.id = 'musicLibrary';
  dialog.setAttribute('aria-labelledby', 'musicTitle');
  dialog.className = 'music-inline';
  dialog.innerHTML = `
    <header class="music-header">
      <div class="music-brand"><span class="music-brand-mark"><img src="/brand/qsession-icon-master.png?v=20260911-brand-logo-v1" alt=""></span><span><small>QSESSION MUSIC</small><h2 id="musicTitle">Biblioteca</h2></span></div>
      <nav class="music-view-tabs" aria-label="Tu música"><button type="button" data-music-view="catalog" aria-pressed="true">Biblioteca</button><button type="button" data-music-view="playlists" aria-pressed="false">Mis playlists</button></nav><div class="music-header-actions"><span class="music-live-pill"><i></i> CABINA qDJ</span><button type="button" id="musicClose" aria-label="Contraer biblioteca" aria-expanded="true">⌃</button></div>
    </header>
    <section class="music-session-start" aria-label="Crear una sesión automática">
      <label for="musicMoment">¿Cuál es tu momento?</label><select id="musicMoment" aria-label="Momento"><option value="dance">Bailar y compartir</option><option value="friends">Conversar con amigos</option><option value="focus">Trabajar o estudiar</option><option value="relax">Descansar</option><option value="exercise">Entrenar</option></select>
      <input id="musicMomentCommand" aria-label="Describe tu momento" placeholder="Ej.: una fiesta que vaya subiendo de energía" maxlength="180"><button type="button" id="musicStartSession">▶ Crear sesión y mezclar</button><button type="button" id="musicShowAuto">⚙ Ajustar qDJ</button><output id="musicMixState" aria-live="polite">Elige tu momento. qDJ selecciona las canciones y mezcla la sesión.</output>
    </section>
    <div hidden aria-hidden="true" class="music-legacy-engine-state"><input id="musicLiveEnergy" value="3"><output id="musicLiveEnergyValue"></output><input id="musicLiveMood" value="0"><output id="musicLiveMoodValue"></output><input id="musicLiveGenre" value="0"><output id="musicLiveGenreValue"></output><button id="musicLiveRelease"></button><select id="musicLiveFx"><option value="none">Sin efecto</option></select><button id="musicLiveTransition"></button><p id="musicLiveStatus"></p></div>
    <div class="music-workspace">
      <aside class="music-sidebar">
        <div><small>COLECCIONES</small><h3>Tu sonido</h3></div>
        <nav id="musicFamilies" class="music-families" aria-label="Géneros musicales"></nav>
        <div class="music-origin-note"><span>Q</span><p><strong>Originales QSession</strong><small>Música propia y selecciones autorizadas, listas para transmitir.</small></p></div>
      </aside>
      <section id="musicCatalogView" class="music-catalog">
        <section class="music-catalog-head">
          <div><small>EXPLORAR</small><h3 id="musicFamilyTitle">Electrónica</h3><p id="musicFamilyDescription"></p></div>
          <span id="musicCount" class="music-count"></span>
        </section>
        <div class="music-filter-row">
          <label class="music-search"><span aria-hidden="true">${icon('search')}</span><input aria-label="Buscar pista, artista o estilo" id="musicSearch" type="search" placeholder="Buscar pista, artista o estilo" maxlength="100"></label>
          <label class="music-subgenre-label"><span class="music-visually-hidden">Subgénero</span><select id="musicSubgenre"><option value="">Todos los subgéneros</option></select></label>
        </div>
        <details class="music-autopilot" open>
          <summary><span class="music-auto-orbit" aria-hidden="true">${icon('sparkle')}</span><span><small>qDJ</small><strong id="musicAutoTitle">Autopiloto DJ</strong></span><label class="music-switch" title="Mezcla continua"><input id="musicAutopilot" aria-label="Mezcla continua automática" type="checkbox" checked><span></span><b>Activo</b></label><i aria-hidden="true">⌄</i></summary>
          <div class="music-auto-body">
            <div class="music-auto-settings">
              <label class="music-setting" title="Duración del set"><span class="music-setting-name">${icon('clock')}<span>Duración del set</span></span><select id="musicDuration" aria-label="Duración"><option value="15">15 min</option><option value="30" selected>30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option></select></label>
              <label class="music-setting" title="Velocidad · BPM"><span class="music-setting-name">${icon('pulse')}<span>Velocidad · BPM</span></span><select id="musicBpm" aria-label="Rango de BPM"><option value="0-0" selected>BPM libre</option><option value="70-95">70–95</option><option value="96-115">96–115</option><option value="116-123">116–123</option><option value="124-130">124–130</option><option value="131-145">131–145</option><option value="146-190">146–190</option></select></label>
              <label class="music-setting" title="Emoción"><span class="music-setting-name">${icon('mood')}<span>Emoción</span></span><select id="musicMood" aria-label="Emoción"><option value="any">Cualquiera</option><option value="deep">Profunda</option><option value="warm">Cálida</option><option value="euphoric">Eufórica</option><option value="sensual">Sensual</option><option value="meditative">Meditativa</option><option value="focused">Enfocada</option><option value="celebratory">Celebración</option><option value="dark">Oscura</option></select></label>
              <label class="music-setting" title="Ritmo"><span class="music-setting-name">${icon('wave')}<span>Ritmo</span></span><select id="musicRhythm" aria-label="Ritmo"><option value="any">Cualquiera</option><option value="smooth">Suave</option><option value="groove">Groove</option><option value="drive">Impulso</option><option value="peak">Pico</option></select></label>
              <label class="music-setting" title="Curva de energía"><span class="music-setting-name">${icon('bolt')}<span>Curva de energía</span></span><select id="musicEnergy" aria-label="Energía"><option value="steady">Equilibrada</option><option value="rise">En ascenso</option><option value="calm">Descendente</option><option value="wave">En oleadas</option></select></label>
              <label class="music-setting" title="Longitud de mezcla"><span class="music-setting-name">${icon('transition')}<span>Mezcla Auto DJ</span></span><select id="musicMixBars" aria-label="Longitud de mezcla Auto DJ"><option value="4">4 compases</option><option value="8" selected>8 compases</option><option value="16">16 compases</option></select></label><button type="button" id="musicGenerate" title="Preparar mezcla">${icon('mix')}<span>Preparar mezcla</span></button>
            </div>
            <p class="music-mix-description">Dos decks · sincronización de pulso · intercambio de graves</p><div class="music-qdj-command"><label class="music-command-label" for="musicQdjCommand">${icon('sparkle')}<span>Instrucciones para qDJ</span></label><input id="musicQdjCommand" maxlength="180" aria-label="Indicación para qDJ" placeholder="Techno oscuro · 128 BPM · energía en ascenso"><button type="button" id="musicApplyCommand" title="Aplicar indicación" aria-label="Aplicar indicación"><span aria-hidden="true">→</span><span>Aplicar instrucciones</span></button><button type="button" id="musicAiCreate" title="Requiere conectar un proveedor de creación musical" disabled aria-label="Crear música con IA">${icon('sparkle')}<span>Crear música con IA</span></button><small id="musicAiAvailability" class="music-ai-availability">Requiere un proveedor musical conectado.</small></div>
          </div>
        </details>
        <section id="musicImportPanel" class="music-import" hidden>
          <div><small>CATÁLOGO PROPIO</small><strong>Importar música</strong><p>MP3 · WAV · M4A · AAC · OGG · FLAC</p></div>
          <button type="button" id="musicImportButton">${icon('folder')}<span>Elegir carpeta</span></button>
          <input id="musicFolderInput" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac" multiple hidden>
          <details class="music-feedback-report"><summary>▤ Estadísticas de canciones</summary><button type="button" id="musicFeedbackRefresh">↻ Actualizar estadísticas</button><div id="musicFeedbackStats" aria-live="polite"></div></details>
          <div id="musicImportProgress" class="music-import-progress" hidden><span><i></i></span><p></p></div>
        </section>
        <div class="music-list-heading"><span>PISTA</span><span>BPM</span><span>TIEMPO</span><span></span></div>
        <div id="musicTracks" class="music-tracks"></div>
      </section>
      <section id="musicPlaylistsView" class="music-playlists-view" hidden><section class="music-catalog-head"><div><small>TU COLECCIÓN</small><h3>Mis playlists</h3><p>Sesiones guardadas para volver a tu sonido.</p></div></section><div id="musicPlaylistCards" class="music-playlist-cards"></div></section>
      <aside class="music-queue">
        <div class="music-panel-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-music-panel="queue">${icon('queue')}<span>Cola de pistas</span></button><button type="button" role="tab" aria-selected="false" data-music-panel="effects">${icon('fx')}<span>Efectos en vivo</span></button></div>
        <section id="musicQueuePanel" class="music-side-panel is-active">
          <div class="music-queue-head"><div><small>EN CABINA</small><h3>Próximas pistas</h3></div><span id="musicTotal">0 pistas</span></div>
          <button type="button" id="musicClearUpcoming" class="music-clear-upcoming">Limpiar próximas pistas</button><ol id="musicQueue"></ol>
          <details class="music-playlist-save"><summary>Guardar este set <span>＋</span></summary><div><label>Nombre<input id="musicName" maxlength="80" placeholder="Nombre de tu sesión"></label><button type="button" id="musicSave">Guardar playlist</button><button type="button" id="musicSaveAsNew">Guardar como nueva</button><label>Mis playlists<select id="musicSaved"><option value="">Seleccionar…</option></select></label><p><button type="button" id="musicLoad">Cargar</button><button type="button" id="musicDelete">Eliminar</button></p></div></details>
        </section>
        <section id="musicEffectsPanel" class="music-side-panel" hidden>
          <div class="music-fx-head"><small>EFECTOS EN VIVO</small><h3>Un toque, una reacción</h3></div>
          <div class="music-fx-section"><span>SONIDO</span><div class="music-sfx-grid"><button type="button" data-music-sfx="impact" title="Impacto"><b>◉</b><small>Impacto</small></button><button type="button" data-music-sfx="riser" title="Subida"><b>↗</b><small>Subida</small></button><button type="button" data-music-sfx="chime" title="Destello"><b>✦</b><small>Destello</small></button><button type="button" data-music-sfx="airhorn" title="Alerta"><b>◖</b><small>Alerta</small></button></div></div>
          <div class="music-fx-section"><span>VIDEO</span><div class="music-reaction-grid"><button type="button" data-music-reaction="💙" title="Corazones">💙</button><button type="button" data-music-reaction="✨" title="Destellos">✨</button><button type="button" data-music-reaction="🌸" title="Flores">🌸</button><button type="button" data-music-reaction="🔥" title="Fuego">🔥</button><button type="button" data-music-reaction="🎉" title="Celebración">🎉</button><button type="button" data-music-reaction="⚡" title="Energía">⚡</button></div></div>
          <p class="music-fx-note">Las reacciones aparecen sobre la señal de cámara procesada.</p>
        </section>
      </aside>
    </div>
    <div id="musicFxOverlay" class="music-fx-overlay" aria-hidden="true"></div>
    <p id="musicStatus" role="status" aria-live="polite"></p>
    <footer class="music-player" aria-label="Reproductor musical">
      <div class="music-now-art" aria-hidden="true"><span>Q</span><i></i><i></i></div>
      <div id="musicNow" class="music-now" aria-live="polite"><small>SIN REPRODUCCIÓN</small><strong>Elige tu primera pista</strong><span>Tu mezcla aparecerá aquí.</span></div>
      <div class="music-deck">
        <div class="music-transport"><button id="musicPrevious" type="button" aria-label="Pista anterior" title="Anterior">${icon('previous')}<span class="music-transport-label">Anterior</span></button><button id="musicPlay" type="button" aria-label="Reproducir" title="Reproducir">${icon('play')}<span class="music-transport-label">Reproducir</span></button><button id="musicPause" type="button" aria-label="Pausar" title="Pausar" hidden>${icon('pause')}<span class="music-transport-label">Pausar</span></button><button id="musicNext" type="button" aria-label="Pista siguiente" title="Siguiente">${icon('next')}<span class="music-transport-label">Siguiente</span></button></div>
        <div class="music-progress"><span id="musicElapsed">0:00</span><input id="musicSeek" type="range" min="0" max="100" value="0" step="1" aria-label="Posición de la pista" disabled><span id="musicLength">0:00</span></div>
      </div>
      <details id="musicPlayerSettings" class="music-performance-panel" open><summary>BPM, mezcla y volumen <span aria-hidden="true">⌄</span></summary><div class="music-performance">
        <div class="music-bpm-control" title="BPM de salida"><span class="music-control-caption">Velocidad · BPM</span><button type="button" id="musicBpmDown" aria-label="Bajar BPM">−</button><output id="musicBpmValue">124 <small>BPM</small></output><button type="button" id="musicBpmUp" aria-label="Subir BPM">＋</button><button type="button" id="musicBpmReset" aria-label="Restablecer BPM" title="BPM original">↺<span class="music-reset-label">Original</span></button></div>
        <div class="music-transition-control"><label class="music-control-caption" for="musicTransitionSeconds">Mezcla manual</label><select id="musicTransitionSeconds" aria-label="Duración de transición" title="Duración de transición"><option value="2">2s</option><option value="4" selected>4s</option><option value="8">8s</option><option value="12">12s</option></select><button type="button" id="musicTransition" title="Mezclar con la siguiente pista">${icon('transition')}<span>Mezclar</span></button></div>
        <label class="music-volume" title="Volumen"><span class="music-control-caption">Volumen</span>${icon('volume')}<input id="musicVolume" type="range" min="0" max="100" value="100" aria-label="Volumen"><output id="musicVolumeValue">100%</output></label>
      </div></details>
    </footer>`;
  $('musicLibrarySlot').append(dialog);
  const appViewHost = $('view-live')?.parentElement || null;
  const standaloneAdmin = !appViewHost;
  function setupSetDesk(){
    dialog.classList.add('set-desk');$('musicTitle').textContent='Tu set';
    const auto=$('musicAutopilot').closest('details');auto.id='musicAutoSettings';auto.open=false;dialog.append(auto);
    const hint=node('small','Abrir ajustes · género, duración, BPM y energía','music-auto-hint');auto.querySelector('summary strong').after(hint);auto.addEventListener('toggle',()=>{hint.textContent=auto.open?'Cerrar ajustes del Auto DJ':'Abrir ajustes · género, duración, BPM y energía';});
    const settings=auto.querySelector('.music-auto-settings');
    settings.insertAdjacentHTML('afterbegin',`<label class="music-setting"><span class="music-setting-name">${icon('folder')} Género</span><select id="musicAutoFamily" aria-label="Género del set"></select></label><label class="music-setting"><span class="music-setting-name">${icon('wave')} Subgénero</span><select id="musicAutoSubgenre" aria-label="Subgénero del set"><option value="">Cualquier subgénero compatible</option></select></label><label class="music-setting"><span class="music-setting-name">${icon('bolt')} Nivel de energía</span><select id="musicEnergyLevel" aria-label="Nivel de energía"><option value="">Seguir la curva</option><option value="1">1 · Suave</option><option value="2">2 · Baja</option><option value="3">3 · Media</option><option value="4">4 · Alta</option><option value="5">5 · Intensa</option></select></label>`);
    const builder=document.createElement('section');builder.className='music-set-builder';builder.innerHTML=`<form id="musicSetRequestForm"><label class="music-request-input" for="musicSetRequest">${icon('search')}<input id="musicSetRequest" maxlength="600" placeholder="Cuéntale a qDJ el ambiente, la actividad y cómo quieres que evolucione…" aria-label="Describe la idea musical y el recorrido que quieres"></label><button type="submit" id="musicCreateSet">${icon('sparkle')}<span>Crear playlist</span></button></form><div class="music-explore-actions"><button type="button" id="musicExplore">${icon('folder')}<span>Explorar toda la música</span></button><output id="musicRequestSummary" aria-live="polite">Puedes pedir una escena completa: género, ambiente, energía, ritmo, duración y recorrido.</output></div>`;dialog.append(builder);
    if(appViewHost){
      const explorer=document.createElement('section');explorer.id='musicExplorer';explorer.className='view-panel music-explorer';explorer.dataset.viewPanel='music';explorer.hidden=true;
      explorer.innerHTML='<header class="music-explorer-header"><div><small>QSESSION MUSIC</small><h2>Encuentra tu sonido</h2><p>Elige un género o busca una canción. Tu set sigue sonando.</p></div><button id="musicBackToSet" type="button">← Volver al set</button></header><div id="musicExplorerBody"></div>';
      appViewHost.append(explorer);
      const body=$('musicExplorerBody');body.append(dialog.querySelector('.music-view-tabs'),dialog.querySelector('.music-sidebar'),$('musicCatalogView'),$('musicPlaylistsView'));
      $('musicBackToSet').onclick=()=>{showView('live');dialog.scrollIntoView({block:'start',behavior:'smooth'});};
    }else{
      dialog.classList.add('music-admin-workspace');
    }
    const pager=node('nav',undefined,'music-catalog-pages');pager.setAttribute('aria-label','Páginas de canciones');pager.append(button('← Anterior',()=>{browsePage--;renderTracks();}),node('output','','music-page-status'),button('Siguiente →',()=>{browsePage++;renderTracks();}));pager.id='musicCatalogPages';$('musicCatalogView').append(pager);
    $('musicExplore').onclick=()=>void open().catch(e=>status(e.message));
    $('musicSetRequestForm').onsubmit=event=>{event.preventDefault();void prepareRequestedSet().catch(e=>{$('musicRequestSummary').textContent=e.message;status(e.message);});};
    $('musicGenerate').onclick=()=>void prepareSetFromControls().catch(e=>status(e.message));
    $('musicAutoFamily').onchange=()=>{family=$('musicAutoFamily').value;browseAll=false;renderFamilies();};
    $('musicAutoSubgenre').onchange=()=>{$('musicRequestSummary').textContent='Subgénero actualizado. Pulsa “Actualizar playlist” para aplicarlo.';};
    $('musicGenerate').querySelector('span').textContent='Actualizar playlist';
    $('musicShowAuto').onclick=()=>{auto.open=true;auto.scrollIntoView({block:'nearest',behavior:'smooth'});};
    $('musicPlayerSettings').open=true;
    const oldClose=$('musicClose');oldClose.setAttribute('aria-label','Contraer o expandir tu set');oldClose.onclick=()=>setWorkspaceExpanded(dialog.classList.contains('is-collapsed'));
    $('musicQueuePanel').querySelector('h3').textContent='Tu playlist';
    const waiting=document.createElement('section');waiting.id='musicPendingSet';waiting.className='music-pending-set';waiting.hidden=true;waiting.innerHTML='<header><strong>Playlist en espera</strong><span id="musicPendingCount"></span></header><p>El set actual continúa. Se mezclará al finalizar su última pista o cuando tú lo decidas.</p><ol id="musicPendingTracks"></ol><div><button id="musicPendingMix" type="button">Mezclar con este set</button><button id="musicPendingCancel" type="button">Descartar</button></div>';$('musicQueuePanel').append(waiting);
    $('musicPendingMix').onclick=()=>void manualTransition().catch(e=>status(e.message));$('musicPendingCancel').onclick=()=>{pendingRevision++;pendingSet=null;generation++;prepareTask=null;mixer?.cancel();if(mixer)mixer.auto=autopilot;renderPendingSet();void prepareNext();status('Playlist en espera descartada. El set actual continúa.');};
  }
  function syncAutoGenres(){
    if(!catalog)return;
    $('musicAutoFamily').replaceChildren(...catalog.families.map(f=>new Option(f.name,f.id)));$('musicAutoFamily').value=family;
    const selected=$('musicAutoSubgenre').value,values=[...new Set(catalog.tracks.filter(t=>t.family===family).map(t=>t.subgenre||t.style).filter(Boolean))].sort();
    $('musicAutoSubgenre').replaceChildren(new Option('Cualquier subgénero compatible',''),...values.map(v=>new Option(v,v)));if(values.includes(selected))$('musicAutoSubgenre').value=selected;
  }
  function applyRequestCriteria(criteria,{reset=true}={}){
    if(criteria.family){family=criteria.family;browseAll=false;renderFamilies();}
    const set=(id,value)=>{if(value==null)return;const control=$(id);if(![...control.options].some(o=>o.value===String(value)))control.add(new Option(String(value),String(value)));control.value=String(value);};
    if(reset){set('musicAutoSubgenre','');set('musicMood','any');set('musicRhythm','any');set('musicEnergy','steady');set('musicEnergyLevel','');set('musicBpm','0-0');}
    if(criteria.subgenre)set('musicAutoSubgenre',criteria.subgenre);if(criteria.mood)set('musicMood',criteria.mood);if(criteria.rhythm)set('musicRhythm',criteria.rhythm);if(criteria.energy)set('musicEnergy',criteria.energy);if(criteria.energyTarget!=null)set('musicEnergyLevel',criteria.energyTarget);if(criteria.minutes!=null)set('musicDuration',criteria.minutes);
    if(criteria.bpmMin!=null){const maximum=criteria.bpmMax??criteria.bpmMin,value=criteria.bpmMin+'-'+maximum;set('musicBpm',value);$('musicBpm').selectedOptions[0].textContent=criteria.bpmMin===maximum?criteria.bpmMin+' BPM':criteria.bpmMin+'–'+maximum+' BPM';}
  }
  async function prepareRequestedSet(){
    await loadWorkspace();const command=$('musicSetRequest').value.trim();if(!command)throw new Error('Describe la música, el momento o el recorrido que quieres.');
    const button=$('musicCreateSet');button.disabled=true;$('musicRequestSummary').textContent='qDJ está interpretando tu idea y revisando el catálogo…';
    try{
      let interpretation;
      try{interpretation=await request('/api/music/interpret',{method:'POST',body:JSON.stringify({command})});}
      catch{const criteria=window.QSessionSetRequest.interpret(command,catalog);interpretation={criteria,summary:''};}
      applyRequestCriteria(interpretation.criteria||{});requestInterpretation=interpretation.summary||'';$('musicName').value=command;return await prepareSetFromControls();
    }finally{button.disabled=false;}
  }
  async function prepareSetFromControls(){
    await loadWorkspace();$('musicCreateSet').disabled=true;
    try{let count;if(current){count=await stageRequestedSet();}else count=await createAutopilot();
      const controls=qdjControls(),name=catalog.families.find(f=>f.id===family)?.name||family,limited=controls.subgenre&&lastSelectionInfo?.subgenreTracks<=count?` El catálogo tiene ${lastSelectionInfo.subgenreTracks} pistas de ${controls.subgenre}; para ampliar la rotación, prueba sin fijar el subgénero.`:'';
      const understood=requestInterpretation?`Entendí: ${requestInterpretation}. `:'';requestInterpretation='';
      $('musicRequestSummary').textContent=count?`${understood}${name}${controls.subgenre?' · '+controls.subgenre:''} · ${controls.minutes} min solicitados · ${count} pistas preparadas. ${current?'Nueva playlist en espera; el set actual sigue completo.':'Pulsa reproducir para empezar.'}${limited}`:`${understood}No hay suficientes canciones compatibles en el catálogo. Tu set actual no cambia; prueba una idea un poco más amplia.`;
      dialog.classList.remove('is-exploring');$('musicExplore').setAttribute('aria-expanded','false');renderQueue();return count;
    }finally{$('musicCreateSet').disabled=false;}
  }
  function renderPendingSet(){
    const box=$('musicPendingSet');if(!box)return;box.hidden=!pendingSet;if(!pendingSet)return;
    $('musicPendingCount').textContent=pendingSet.ids.length+' pistas';$('musicPendingTracks').replaceChildren(...pendingSet.ids.map(id=>{const track=trackById(id);const item=node('li');item.append(node('strong',track?.title||id),node('small',`${track?.artist||''} · ${track?.bpm||'—'} BPM · ${time(track?.duration)}`));return item;}));
    $('musicPendingMix').disabled=!current||audio.paused||transitioning||Boolean(mixer?.mixing);
    $('musicPendingCancel').disabled=transitioning||Boolean(mixer?.mixing);
  }
  function commitPendingSet(id,{force=false}={}){
    if(!pendingSet||pendingSet.ids[0]!==id||(!force&&pendingTarget!==id))return false;
    queue=[...pendingSet.ids];pendingSet=null;pendingTarget=null;if(mixer)mixer.auto=autopilot;renderPendingSet();return true;
  }
  async function stageRequestedSet(){
    if(pendingSet&&(transitioning||mixer?.mixing))throw Error('La transición está en curso. Espera a que termine para preparar otro set.');
    const revision=++pendingRevision,epoch=setEpoch,controls=qdjControls();
    const result=await request('/api/music/session',{method:'POST',body:JSON.stringify({...controls,rotation:nextPlaylistRotation(),previousTrackId:queue.at(-1)||current,excludeIds:queue.slice(-100)})});lastSelectionInfo=result;
    if(revision!==pendingRevision||epoch!==setEpoch)return 0;
    const ids=result.tracks.map(track=>{rememberTrack(track);return track.id;});if(!ids.length)return 0;rememberSelection(result.tracks);
    pendingTarget=null;pendingSet={ids,controls,name:$('musicName').value};renderPendingSet();
    if(!current){queue=ids;pendingSet=null;renderQueue();renderPendingSet();}
    else if(queue.indexOf(current)===queue.length-1&&!mixer?.mixing){generation++;prepareTask=null;mixer?.cancel();void prepareNext();}
    return ids.length;
  }
  const compactPlayer=matchMedia('(max-width:720px)');
  $('musicPlayerSettings').open=true;
  $('musicAutopilot').closest('details').open=false;
  compactPlayer.addEventListener('change',()=>{$('musicPlayerSettings').open=true;});
  $('musicFolderInput').setAttribute('webkitdirectory', '');
  $('musicFolderInput').setAttribute('directory', '');

  const editor = document.createElement('dialog');
  editor.id = 'musicMetadataEditor';
  editor.innerHTML = `<form method="dialog" class="music-editor-card"><header><div><small>CLASIFICACIÓN qDJ</small><h3>Revisar pista</h3></div><button value="cancel" aria-label="Cerrar">×</button></header><input id="musicEditId" type="hidden"><label>Título<input id="musicEditTitle" maxlength="120"></label><label>Artista<input id="musicEditArtist" maxlength="100"></label><label>Género<select id="musicEditFamily"></select></label><label>Subgénero<input id="musicEditSubgenre" maxlength="80"></label><label>BPM<input id="musicEditBpm" type="number" min="40" max="220" step="1"></label><details class="music-grid-editor"><summary>Datos DJ verificados</summary><p>Completa estos datos sólo si has comprobado la pista. Sin ellos, qDJ analiza el pulso en vivo.</p><label>Tonalidad Camelot<input id="musicEditKey" maxlength="3" placeholder="Ej. 8A o 8B"></label><label>Primer pulso (segundos)<input id="musicEditBeatOffset" type="number" min="0" step="0.001" placeholder="Sin verificar"></label><label>Inicio de frase (segundos)<input id="musicEditPhraseStart" type="number" min="0" step="0.001" placeholder="Opcional"></label></details><label>Emoción<select id="musicEditMood"><option value="deep">Profunda</option><option value="warm">Cálida</option><option value="euphoric">Eufórica</option><option value="sensual">Sensual</option><option value="meditative">Meditativa</option><option value="focused">Enfocada</option><option value="celebratory">Celebración</option><option value="dark">Oscura</option></select></label><label>Ritmo<select id="musicEditRhythm"><option value="smooth">Suave</option><option value="groove">Groove</option><option value="drive">Impulso</option><option value="peak">Pico</option></select></label><label>Energía<select id="musicEditEnergy"><option value="1">1 · Suave</option><option value="2">2 · Baja</option><option value="3">3 · Media</option><option value="4">4 · Alta</option><option value="5">5 · Intensa</option></select></label><footer><button value="cancel">Cancelar</button><button id="musicEditSave" value="default">Guardar cambios</button></footer></form>`;
  document.body.append(editor);

  const status = text => {$('musicStatus').textContent = text || '';};
  const node = (tag,text,cls) => {const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(cls)element.className=cls;return element;};
  function button(text, action, label) {const element=node('button',text);element.type='button';if(label)element.setAttribute('aria-label',label);element.addEventListener('click',()=>Promise.resolve().then(action).catch(error=>status(error.message)));return element;}
  async function request(url, options={}) {const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error||'No fue posible completar la acción');return data;}
  const time = seconds => {const value=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;};
  const trackById = id => catalog?.tracks.find(track=>track.id===id);
  function rememberTrack(track){if(!track?.id||!catalog)return;const index=catalog.tracks.findIndex(item=>item.id===track.id);if(index>=0)catalog.tracks[index]={...catalog.tracks[index],...track};}

  async function renderFeedbackStats() {
    const box=$('musicFeedbackStats'),control=$('musicFeedbackRefresh');control.disabled=true;
    try {
      const data=await request('/api/admin/music/feedback');
      const rows=Object.entries(data.tracks).filter(([,entry])=>entry.votes>0).sort((a,b)=>b[1].votes-a[1].votes||b[1].score-a[1].score);
      box.replaceChildren();
      if(!rows.length){box.append(node('p','Aún no hay votos. Las valoraciones del DJ y los oyentes aparecerán aquí.'));return;}
      const total=rows.reduce((sum,[,entry])=>sum+entry.votes,0);
      box.append(node('p',total+' votos actuales · '+rows.length+' canciones valoradas'));
      const table=node('table'),head=node('thead'),heading=node('tr');
      for(const label of ['Canción','Me gusta','No me gusta','Aprobación']){const th=node('th',label);th.scope='col';heading.append(th);}
      head.append(heading);table.append(head);const body=node('tbody');
      for(const [id,entry] of rows){const row=node('tr'),track=trackById(id);row.append(node('td',track?.title||id),node('td',String(entry.likes)),node('td',String(entry.dislikes)),node('td',entry.approval+'%'));body.append(row);}
      table.append(body);box.append(table);
    } catch(error){box.replaceChildren(node('p',error.message));}finally{control.disabled=false;}
  }
  function feedbackNode(track) {
    const group=node('div',undefined,'music-feedback');
    group.dataset.feedbackTrack=track.id;
    group.setAttribute('role','group');group.setAttribute('aria-label','Tu opinión sobre '+track.title);
    for(const [vote,label,symbol] of [[1,'Me gusta','👍'],[-1,'No me gusta','👎']]){
      const control=button(symbol+' '+label,()=>void voteTrack(track.id,vote),label+': '+track.title);
      control.dataset.vote=String(vote);control.dataset.voteLabel=label;control.dataset.voteSymbol=symbol;
      control.setAttribute('aria-pressed','false');group.append(control);
    }
    const message=node('small',undefined,'music-feedback-message');message.setAttribute('role','status');group.append(message);
    updateFeedbackGroup(group);return group;
  }
  function updateFeedbackGroup(group) {
    const entry=feedback[group.dataset.feedbackTrack]||{likes:0,dislikes:0,myVote:0};
    group.querySelectorAll('[data-vote]').forEach(control=>{
      const vote=Number(control.dataset.vote),count=vote===1?entry.likes:entry.dislikes;
      control.textContent=control.dataset.voteSymbol+' '+control.dataset.voteLabel+' · '+count;
      control.setAttribute('aria-pressed',String(entry.myVote===vote));
      control.disabled=pendingVotes.has(group.dataset.feedbackTrack);
    });
  }
  function syncFeedback() { document.querySelectorAll('[data-feedback-track]').forEach(updateFeedbackGroup); }
  async function refreshFeedback(trackId=null) {
    const data=await request('/api/music/feedback'+(trackId?'?trackId='+encodeURIComponent(trackId):''));
    feedback=trackId?{...feedback,...data.tracks}:data.tracks;syncFeedback();
  }
  async function voteTrack(id,vote) {
    if(pendingVotes.has(id))return;
    pendingVotes.add(id);syncFeedback();
    try {
      const next=feedback[id]?.myVote===vote?0:vote;
      const data=await request('/api/music/tracks/'+encodeURIComponent(id)+'/feedback',{method:'PUT',body:JSON.stringify({vote:next})});
      feedback[id]=data.feedback;
      document.querySelectorAll('[data-feedback-track]').forEach(group=>{if(group.dataset.feedbackTrack===id)group.querySelector('.music-feedback-message').textContent=next===0?'Voto retirado.':'Voto guardado. Gracias por ayudar a elegir la música.';});
    } catch(error) {
      document.querySelectorAll('[data-feedback-track]').forEach(group=>{if(group.dataset.feedbackTrack===id)group.querySelector('.music-feedback-message').textContent=error.message;});
    } finally { pendingVotes.delete(id);syncFeedback(); }
  }

  function creditNode(track) {
    const box=node('div',undefined,'music-credit');box.setAttribute('data-i18n-ignore','');
    const title=node(track.sourceUrl?'a':'strong',`${track.title} — ${track.artist}`);
    if(track.sourceUrl){title.href=track.sourceUrl;title.target='_blank';title.rel='noopener';}
    box.append(title,node('small',track.sourceType==='qsession-original' ? `${track.subgenre||track.style} · Original QSession` : `${track.copyright} · Audius`));
    box.append(feedbackNode(track));
    return box;
  }

  function setNow(track=null) {
    const box=$('musicNow');
    const identity=track?JSON.stringify([track.id,track.title,track.artist,track.subgenre,track.style,track.sourceUrl,track.copyright]):'';
    const existingState=box.querySelector('.music-playback-state');
    if(box.dataset.trackIdentity===identity&&existingState){existingState.textContent=loading?'CARGANDO':audio.paused?(track?'EN PAUSA':'SIN REPRODUCCIÓN'):'AL AIRE';return;}
    box.dataset.trackIdentity=identity;box.replaceChildren();
    box.append(node('small',loading?'CARGANDO':audio.paused?(track?'EN PAUSA':'SIN REPRODUCCIÓN'):'AL AIRE','music-playback-state'));
    if(track) box.append(creditNode(track));
    else box.append(node('strong','Elige tu primera pista'),node('span','Tu mezcla aparecerá aquí.'));
  }

  function renderPlayer() {
    const playing=!audio.paused;
    $('musicPlay').hidden=playing;$('musicPause').hidden=!playing;
    $('musicPlay').disabled=(!queue.length&&!autopilot)||loading||autopilotLoading;$('musicPause').disabled=!playing;
    $('musicPrevious').disabled=!queue.length||loading;$('musicNext').disabled=!queue.length||loading;
    const duration=Number.isFinite(audio.duration)?audio.duration:0;
    $('musicSeek').disabled=!duration||loading;$('musicSeek').max=duration||100;$('musicSeek').value=audio.currentTime||0;
    $('musicSeek').style.setProperty('--progress',`${duration?100*audio.currentTime/duration:0}%`);
    $('musicElapsed').textContent=time(audio.currentTime);$('musicLength').textContent=time(duration);
    $('musicBpmValue').innerHTML=`${targetBpm} <small>BPM</small>`;
    $('musicLiveTransition').disabled=!current||!playing||loading||transitioning||manualTransitionPending;dialog.classList.toggle('is-playing',playing);setNow(trackById(current));renderPendingSet();
  }

  function filteredTracks() {
    const search=$('musicSearch').value.trim().toLocaleLowerCase();const subgenre=$('musicSubgenre').value;
    return (catalog?.tracks||[]).filter(track=>(browseAll||!browseFamily||track.family===browseFamily)&&(!subgenre||(track.subgenre||track.style)===subgenre)&&`${track.title} ${track.artist} ${track.style} ${track.genre} ${track.subgenre}`.toLocaleLowerCase().includes(search));
  }
  function editTrack(track) {$('musicEditId').value=track.id;$('musicEditTitle').value=track.title;$('musicEditArtist').value=track.artist;$('musicEditFamily').value=track.family;$('musicEditSubgenre').value=track.subgenre||track.style||'';$('musicEditBpm').value=String(track.bpm||124);$('musicEditKey').value=track.camelotKey||'';$('musicEditBeatOffset').value=track.beatGrid?.verified?String(track.beatGrid.offset):'';$('musicEditPhraseStart').value=track.beatGrid?.phraseStart!=null?String(track.beatGrid.phraseStart):'';$('musicEditMood').value=track.mood||'focused';$('musicEditRhythm').value=track.rhythm||'drive';$('musicEditEnergy').value=String(track.energy||3);editor.showModal();}

  function renderTracks() {
    const list=$('musicTracks');list.replaceChildren();const tracks=filteredTracks();const familyInfo=catalog?.families.find(item=>item.id===browseFamily);
    const overview=!browseFamily&&!browseAll&&!$('musicSearch').value.trim();
    const pages=Math.max(1,Math.ceil(tracks.length/browsePageSize));browsePage=Math.max(0,Math.min(browsePage,pages-1));
    const pager=$('musicCatalogPages');if(pager){pager.hidden=overview||tracks.length<=browsePageSize;pager.querySelector('output').textContent=`${browsePage+1} / ${pages}`;pager.firstElementChild.disabled=browsePage===0;pager.lastElementChild.disabled=browsePage===pages-1;}
    if(overview){$('musicFamilyTitle').textContent='Explora por género';$('musicFamilyDescription').textContent='Abre una colección para ver sus canciones y subgéneros.';$('musicCount').textContent=(catalog?.tracks.length||0)+' pistas';return;}
    $('musicFamilyDescription').textContent=browseAll?'Tu catálogo completo: busca, escucha y prepara tu set.':familyInfo?.description||'';$('musicFamilyTitle').textContent=browseAll?'Toda tu música':familyInfo?.name||'Tu música';$('musicCount').textContent=`${tracks.length} ${tracks.length===1?'pista':'pistas'}`;
    for(const track of tracks.slice(browsePage*browsePageSize,(browsePage+1)*browsePageSize)){
      const row=node('article',undefined,`music-track${current===track.id?' is-playing':''}`);
      const play=button('',async()=>{await prime();if(current===track.id&&!audio.paused){generation++;prepareTask=null;loading=false;playbackRequested=false;mixer.pause();return;}if(!queue.includes(track.id))queue.push(track.id);await playAt(queue.indexOf(track.id));},`${current===track.id&&!audio.paused?'Pausar':'Reproducir'} ${track.title}`);play.className='music-track-play';play.innerHTML=current===track.id&&!audio.paused?icon('pause'):icon('play');
      const info=node('div',undefined,'music-track-info');info.append(node('strong',track.title),node('span',track.artist));const tags=node('p',undefined,'music-track-tags');tags.append(node('b',track.subgenre||track.style||track.genre),node('b',`${track.bpm||'—'} BPM`),node('b',({deep:'Profunda',warm:'Cálida',euphoric:'Eufórica',sensual:'Sensual',meditative:'Meditativa',focused:'Enfocada',celebratory:'Celebración',dark:'Oscura'})[track.mood]||'Por interpretar'));if(track.sourceType==='qsession-original')tags.append(node('i','ORIGINAL Q'));if(track.audioAnalysis){const assessment=track.classification;const label=track.audioAnalysis.status==='ready'?(assessment?.method==='manual'?'Revisión musical':assessment?.genreCertain&&assessment?.moodCertain?'Audio interpretado':'Audio analizado · clasificación por revisar'):track.audioAnalysis.status==='failed'?'Análisis no disponible':'Análisis de audio pendiente';tags.append(node('b',label));}info.append(tags,feedbackNode(track));
      const controls=node('div',undefined,'music-track-actions');if(adminMode&&track.sourceType==='qsession-original'){const edit=button('Ajustar',()=>editTrack(track),`Revisar clasificación de ${track.title}`);edit.className='music-meta-edit';controls.append(edit);}const add=button(queue.includes(track.id)?'✓':'＋',()=>{if(!queue.includes(track.id)&&queue.length<100)queue.push(track.id);renderQueue();renderTracks();},`Agregar ${track.title}`);add.className='music-add';add.disabled=queue.includes(track.id);controls.append(add);
      row.append(play,info,node('span',String(track.bpm||'—'),'music-track-bpm'),node('span',time(track.duration),'music-track-duration'),controls);list.append(row);
    }
    if(!tracks.length)list.append(node('p','Todavía no hay pistas en esta combinación. Prueba otro género o importa una carpeta.','music-empty'));
  }

  function renderSubgenres(){const selected=$('musicSubgenre').value;const values=[...new Set((catalog?.tracks||[]).filter(track=>browseAll||!browseFamily||track.family===browseFamily).map(track=>track.subgenre||track.style).filter(Boolean))].sort();$('musicSubgenre').replaceChildren(new Option('Todos los subgéneros',''),...values.map(value=>new Option(value,value)));if(values.includes(selected))$('musicSubgenre').value=selected;}
  function renderFamilies(){for(const item of $('musicFamilies').children)item.setAttribute('aria-pressed',String(browseAll?item.dataset.family==='all':item.dataset.family===browseFamily));renderSubgenres();renderTracks();syncAutoGenres();}

  function moveQueuedTrack(id,delta){const index=queue.indexOf(id),target=index+delta,locked=current?queue.indexOf(current):-1;if(index<=locked||target<=locked||target<0||target>=queue.length)return;generation++;prepareTask=null;if(mixer)mixer.cancel();[queue[index],queue[target]]=[queue[target],queue[index]];renderQueue();void prepareNext();}
  function renderQueue(){const list=$('musicQueue');list.replaceChildren();let seconds=0;queue.forEach((id,index)=>{const track=trackById(id);if(!track)return;seconds+=track.duration;const item=node('li',undefined,current===id?'is-playing':'');const number=node('span',String(index+1).padStart(2,'0'),'music-queue-number');const label=button(track.title,async()=>{await prime();await playAt(index);},`Reproducir ${track.title}`);label.className='music-queue-title';label.title=track.title+' · '+track.artist;label.append(node('small',`${track.bpm||'—'} BPM · ${time(track.duration)} · ${track.subgenre||track.style}`));const remove=button('×',()=>{if(current===id)stop();else{generation++;prepareTask=null;if(mixer)mixer.cancel();}queue=queue.filter(value=>value!==id);renderQueue();renderTracks();void prepareNext();},`Quitar ${track.title}`);remove.className='music-queue-remove';const actions=node('div',undefined,'music-queue-actions');const up=button('↑',()=>moveQueuedTrack(id,-1),'Subir '+track.title),down=button('↓',()=>moveQueuedTrack(id,1),'Bajar '+track.title);const locked=current?queue.indexOf(current):-1;up.disabled=index<=locked+1;down.disabled=index<=locked||index===queue.length-1;actions.append(up,down,remove);item.append(number,label,actions);list.append(item);});if(!queue.length)list.append(node('li','Tu set está vacío. Agrega una pista o activa qDJ.','music-empty'));$('musicTotal').textContent=`${queue.length} ${queue.length===1?'pista':'pistas'} · ${Math.ceil(seconds/60)} min`;renderPlayer();}

  async function prime(){
    if(!context){
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(!AudioContext||!window.QSessionDJ)throw new Error('El motor Auto DJ no está disponible. Recarga la biblioteca.');
      context=new AudioContext();gain=window.QSessionDJ.createOutput(context,Number($('musicVolume').value)/100);
      mixer=new window.QSessionDJ.Mixer(context,gain,{
        onActive:(element,track)=>{audio=element;current=track.id;commitPendingSet(track.id);rememberPlayback(track);targetBpm=Math.round((mixer.snapshot(mixer.deck).grid?.bpm||track.bpm||124)*audio.playbackRate);$('musicMixState').textContent=`Al aire · ${track.title}`;syncLiveControls();notifyTrack();renderQueue();renderTracks();renderPendingSet();},
        onMixStart:plan=>{if(plan.manual&&plan.effect!=='none')void playTransitionEffect(plan.effect).catch(error=>status(error.message));$('musicMixState').textContent=`Mezclando dos pistas · ${plan.outgoing.title} + ${plan.incoming.title} · ${plan.synced?Math.round(plan.tempo)+' BPM · ':''}${Math.round(plan.duration)} s`;},
        onAutoMix:()=>void mixNext().catch(error=>status(error.message)),
        onFailure:error=>status(`Auto DJ: ${error.message}. La pista actual continúa.`),
      });
      mixer.output=gain;
      mixer.auto=autopilot;mixer.bars=Number($('musicMixBars').value);
      for(const deck of mixer.decks)bindAudio(deck.audio);
      audio=mixer.audio;
    }
    await context.resume();
  }
  function notifyTrack(){window.dispatchEvent(new CustomEvent('qsession-music-track',{detail:{id:current||''}}));}
  function stop(){setEpoch++;pendingRevision++;pendingSet=null;renderPendingSet();liveRevision++;if(liveTimer)clearTimeout(liveTimer);liveTimer=null;liveAbort?.abort();liveTask=null;playbackRequested=false;generation++;prepareTask=null;loading=false;if(mixer)mixer.stop();else{audio.pause();audio.removeAttribute('src');audio.load();}current=null;notifyTrack();if(catalog){renderQueue();renderTracks();}renderPlayer();}

  function syncLiveControls(){
    if(!catalog)return;
    if(!liveSteering&&current)liveEnergy=Math.max(1,Math.min(5,Number(trackById(current)?.energy)||3));
    const energy=$('musicLiveEnergy');energy.value=liveEnergy;energy.setAttribute('aria-valuetext',liveEnergyNames[liveEnergy-1]);$('musicLiveEnergyValue').textContent=liveEnergyNames[liveEnergy-1]+' · '+liveEnergy+'/5';
    const moodIndex=Math.max(0,liveMoods.indexOf($('musicMood').value));$('musicLiveMood').value=moodIndex;$('musicLiveMood').setAttribute('aria-valuetext',liveMoodNames[moodIndex]);$('musicLiveMoodValue').textContent=liveMoodNames[moodIndex];
    const index=Math.max(0,catalog.families.findIndex(item=>item.id===family));$('musicLiveGenre').max=Math.max(0,catalog.families.length-1);$('musicLiveGenre').value=index;$('musicLiveGenre').setAttribute('aria-valuetext',catalog.families[index]?.name||'Sin géneros');$('musicLiveGenreValue').textContent=catalog.families[index]?.name||'Sin géneros';$('musicLiveGenre').disabled=!catalog.families.length;$('musicLiveRelease').disabled=!liveSteering;
  }
  function beginLiveSteering(){if(!liveSteering){liveCurve=$('musicEnergy').value;liveSteering=true;}}
  function scheduleLiveSteering(){
    liveRevision++;if(liveTimer)clearTimeout(liveTimer);liveAbort?.abort();
    $('musicLiveStatus').textContent='Preparando nuevas pistas según tu dirección…';
    const revision=liveRevision;liveTimer=setTimeout(()=>{liveTimer=null;liveTask=applyLiveSteering(revision);},350);
  }
  async function applyLiveSteering(revision){
    if(revision!==liveRevision)return false;
    if(loading||autopilotLoading||transitioning||mixer?.mixing){liveTimer=setTimeout(()=>{liveTimer=null;liveTask=applyLiveSteering(revision);},400);return false;}
    const active=current,token=generation,controller=new AbortController();liveAbort=controller;
    const index=queue.indexOf(active),prefix=active?(index>=0?queue.slice(0,index+1):[active]):[];
    try{
      const controls=qdjControls();
      const result=await request('/api/music/session',{method:'POST',signal:controller.signal,body:JSON.stringify({...controls,excludeIds:prefix.slice(-100),previousTrackId:active})});
      if(revision!==liveRevision||token!==generation||current!==active||transitioning||mixer?.mixing)return false;
      const ids=result.tracks.map(track=>track.id).filter(id=>!prefix.includes(id));
      if(!ids.length){generation++;prepareTask=null;mixer?.cancel();queue=prefix;renderQueue();renderTracks();$('musicLiveStatus').textContent='No hay pistas compatibles. La pista actual terminará y el set se detendrá; elige otro género o agrega canciones.';return false;}
      for(const track of result.tracks)rememberTrack(track);
      generation++;prepareTask=null;mixer?.cancel();queue=[...prefix,...ids];
      if(mixer)mixer.style=controls.rhythm==='smooth'?'smooth':'auto';renderQueue();renderTracks();
      const first=trackById(ids[0]);$('musicLiveStatus').textContent='Próxima: '+first.title+' · '+(first.energy||'—')+'/5 · '+(liveMoodNames[liveMoods.indexOf(first.mood)]||'Emoción por revisar')+(result.relaxedFilters?' · aproximación disponible en el catálogo.':'');
      if(current&&!audio.paused)void prepareNext({quick:manualPreparation});return true;
    }catch(error){if(error.name!=='AbortError'&&revision===liveRevision)$('musicLiveStatus').textContent='No se pudo actualizar la cola. '+error.message;return false;}
    finally{if(liveAbort===controller)liveAbort=null;}
  }
  function qdjControls(){const [bpmMin,bpmMax]=$('musicBpm').value.split('-').map(Number),history=[...playHistory,...selectionHistory].sort((a,b)=>(a.at||0)-(b.at||0)).slice(-100);return {family,minutes:Number($('musicDuration').value),energy:$('musicEnergy').value,bpmMin,bpmMax,mood:$('musicMood').value,rhythm:$('musicRhythm').value,subgenre:$('musicAutoSubgenre').value,history,...($('musicEnergyLevel').value?{energyTarget:Number($('musicEnergyLevel').value)}:liveSteering?{energyTarget:liveEnergy}:{})};}
  function selectOption(id,value){const control=$(id);if([...control.options].some(option=>option.value===value))control.value=value;}
  function interpretQdjCommand(command){
    const text=String(command||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(!text)throw new Error('Escribe una indicación para qDJ');
    const moment=/amigos|conversar|cena|comida|trabaj|estudi|concentr|descans|dormir|relajar|entren|ejercicio/.exec(text)?.[0];
    if(moment){const calm=/amigos|conversar|cena|comida|trabaj|estudi|concentr|descans|dormir|relajar/.test(moment);family=/descans|dormir|relajar/.test(moment)?'wellness':calm?'instrumental':'electronic';renderFamilies();selectOption('musicMood',/trabaj|estudi|concentr/.test(moment)?'focused':/descans|dormir|relajar/.test(moment)?'meditative':calm?'warm':'euphoric');selectOption('musicRhythm',calm?'smooth':'drive');selectOption('musicBpm',calm?'0-0':'124-130');selectOption('musicEnergy',calm?'steady':'wave');}
    const bpmRange=text.match(/\b(\d{2,3})\s*(?:-|a|hasta)\s*(\d{2,3})\s*bpm\b/)||text.match(/\b(\d{2,3})\s*bpm\b/);
    if(bpmRange){const target=Number(bpmRange[1]);const upper=Number(bpmRange[2]||target);const options=[...$('musicBpm').options].map(option=>({option,min:Number(option.value.split('-')[0]),max:Number(option.value.split('-')[1])})).filter(item=>item.max);const best=options.sort((a,b)=>Math.abs((a.min+a.max)/2-(target+upper)/2)-Math.abs((b.min+b.max)/2-(target+upper)/2))[0];if(best)$('musicBpm').value=best.option.value;}
    const moodMap=[['oscura','dark'],['oscuro','dark'],['profunda','deep'],['profundo','deep'],['calida','warm'],['euforica','euphoric'],['euforico','euphoric'],['sensual','sensual'],['meditativa','meditative'],['meditacion','meditative'],['enfocada','focused'],['celebracion','celebratory'],['festiva','celebratory']];for(const [word,value] of moodMap)if(text.includes(word)){selectOption('musicMood',value);break;}
    const rhythmMap=[['suave','smooth'],['fluido','smooth'],['groove','groove'],['ritmico','groove'],['impulso','drive'],['dinamico','drive'],['pico','peak'],['intenso','peak']];for(const [word,value] of rhythmMap)if(text.includes(word)){selectOption('musicRhythm',value);break;}
    if(/sube|ascenso|creciente/.test(text))selectOption('musicEnergy','rise');else if(/baja|descenso|relaja/.test(text))selectOption('musicEnergy','calm');else if(/oleada|olas/.test(text))selectOption('musicEnergy','wave');else if(/equilibr/.test(text))selectOption('musicEnergy','steady');
    const familyMap=[['techno','electronic'],['house','electronic'],['electronica','electronic'],['cumbia','cumbia'],['latina','latin'],['afro','afro'],['hip hop','urban'],['urbana','urban'],['pop','pop'],['ambient','ambient'],['chill','ambient'],['yoga','wellness'],['meditacion','wellness'],['instrumental','instrumental']];for(const [word,value] of familyMap)if(text.includes(word)&&catalog?.families.some(item=>item.id===value)){family=value;renderFamilies();break;}
  }
  async function createAutopilot({append=false}={}){if(current&&!append)return stageRequestedSet();if(autopilotLoading)return 0;autopilotLoading=true;$('musicGenerate').disabled=true;$('musicApplyCommand').disabled=true;try{const previousLength=queue.length;const result=await request('/api/music/session',{method:'POST',body:JSON.stringify({...qdjControls(),rotation:nextPlaylistRotation(),previousTrackId:current,excludeIds:append?queue.slice(-100):[]})});lastSelectionInfo=result;const ids=result.tracks.map(track=>{rememberTrack(track);return track.id;});if(append&&!ids.length){status('Última pista del set · no quedan canciones nuevas para este momento.');return 0;}if(ids.length)rememberSelection(result.tracks);if(append)queue.push(...ids.filter(id=>!queue.includes(id)));else{if(current)stop();queue=ids;}renderQueue();renderTracks();const added=queue.length-previousLength;const relaxed=result.relaxedFilters?' · ajusté emoción y BPM dentro del mismo género y subgénero':'';status(result.shortfallSeconds?`qDJ preparó ${Math.floor(result.durationSeconds/60)} minutos sin repetir${relaxed}.`:`qDJ listo · ${Math.ceil(result.durationSeconds/60)} minutos · ${result.tracks.length} pistas${relaxed}.`);return append?Math.max(0,added):ids.length;}finally{autopilotLoading=false;$('musicGenerate').disabled=false;$('musicApplyCommand').disabled=false;}}
  async function applyQdjCommand(){interpretQdjCommand($('musicQdjCommand').value);if(current){await stageRequestedSet();status('Nueva playlist en espera.');return;}generation++;prepareTask=null;if(mixer)mixer.cancel();const activeIndex=queue.indexOf(current);if(activeIndex>=0)queue=queue.slice(0,activeIndex+1);await createAutopilot({append:activeIndex>=0});status(`qDJ aplicó: ${$('musicQdjCommand').value.trim()}.`);if(activeIndex<0&&queue.length){await prime();await playAt(0);}else void prepareNext();}

  async function startSession(){
    await prime();
    autopilot=true;$('musicAutopilot').checked=true;mixer.auto=true;
    const moments={dance:['electronic','any','groove','rise','116-123'],friends:['instrumental','warm','smooth','steady','0-0'],focus:['instrumental','focused','smooth','steady','0-0'],relax:['wellness','meditative','smooth','calm','0-0'],exercise:['electronic','euphoric','drive','wave','124-130']};
    const [selected,mood,rhythm,energy,bpm]=moments[$('musicMoment').value]||moments.dance;
    family=selected;renderFamilies();selectOption('musicMood',mood);selectOption('musicRhythm',rhythm);selectOption('musicEnergy',energy);selectOption('musicBpm',bpm);
    const command=$('musicMomentCommand').value.trim();if(command)interpretQdjCommand(command);
    mixer.style=$('musicRhythm').value==='smooth'?'smooth':'auto';
    if(current){await prepareSetFromControls();return;}if(!await createAutopilot())throw new Error('No hay canciones disponibles para este momento. Elige otro género.');
    $('musicName').value=command||$('musicMoment').selectedOptions[0].textContent;
    await playAt(0);
  }

  function applyTargetBpm(value,{manual=true}={}){
    const track=trackById(current);const measured=mixer?.snapshot(mixer.deck).grid?.bpm||track?.beatGrid?.bpm||track?.bpm;
    targetBpm=Math.max(50,Math.min(220,Math.round(Number(value)||measured||124)));bpmManual=manual;
    if(mixer?.mixing)mixer.cancel();
    if(!manual)audio.playbackRate=1;
    else if(measured)audio.playbackRate=Math.max(.75,Math.min(1.25,targetBpm/measured));
    audio.preservesPitch=true;
    $('musicBpmValue').innerHTML=`${targetBpm} <small>BPM</small>`;
  }
  async function playAt(index){
    playbackRequested=true;
    const token=++generation;prepareTask=null;loading=true;if(mixer)mixer.pause();else audio.pause();renderPlayer();
    for(let position=index;position<queue.length;position++){
      const id=queue[position];
      try{
        status('Preparando pista…');const result=await request(`/api/music/tracks/${encodeURIComponent(id)}/play`);
        if(token!==generation)return;
        await prime();if(token!==generation)return;rememberTrack(result.track);const track=trackById(id);current=id;
        const started=await mixer.load(track,result.url);
        if(!started||token!==generation)return;
        if(!bpmManual)targetBpm=Number(track?.bpm)||124;
        if(bpmManual)applyTargetBpm(targetBpm,{manual:true});
        loading=false;notifyTrack();renderQueue();renderTracks();
        status('Auto DJ · preparando el segundo deck.');void prepareNext();return;
      }catch(error){
        if(token!==generation)return;
        if(error.name==='NotAllowedError'){loading=false;renderPlayer();status('Pulsa Reproducir para permitir el audio.');return;}
        status('Pista no disponible; buscando la siguiente…');
      }
    }
    if(token!==generation)return;loading=false;
    if(autopilot&&!pendingSet){const oldLength=queue.length;const added=await createAutopilot({append:true});if(added>0)return playAt(oldLength);}
    if(pendingSet){commitPendingSet(pendingSet.ids[0],{force:true});return playAt(0);}
    stop();status('La mezcla terminó.');
  }
  async function prepareNext({quick=false,pending=false}={}){
    if(pending&&pendingSet&&!mixer?.mixing){generation++;prepareTask=null;mixer?.cancel();}
    if(prepareTask){if(quick)mixer?.finishPreparation();return prepareTask.promise;}
    if(!mixer||!current||audio.paused||mixer.prepared||mixer.preparing||mixer.mixing)return;
    const token=generation;const task={};prepareTask=task;
    task.promise=(async()=>{
      let index=queue.indexOf(current)+1;
      const waiting=pendingSet&&(pending||index>=queue.length)?pendingSet:null;
      if(index>=queue.length&&autopilot&&!waiting)await createAutopilot({append:true});
      if(token!==generation||prepareTask!==task)return false;
      const id=waiting?waiting.ids[0]:queue[index];if(!id)return false;
      if(waiting)mixer.auto=autopilot||index>=queue.length;
      const result=await request(`/api/music/tracks/${encodeURIComponent(id)}/play`);
      if(token!==generation||prepareTask!==task||audio.paused)return false;
      rememberTrack(result.track);
      const direction=qdjControls();
      mixer.journey={curve:direction.energy,targetMood:direction.mood,targetRhythm:direction.rhythm,targetEnergy:direction.energyTarget,position:Math.max(0,queue.indexOf(current)),total:queue.length};
      const ready=await mixer.prepare(trackById(id),result.url,{quick:quick||manualPreparation});
      if(ready&&token===generation&&waiting&&pendingSet===waiting)pendingTarget=id;
      if(ready&&token===generation){const plan=mixer.plan();const profile=plan.profile||{};status(`qDJ listo · ${profile.label||'transición conservadora'}; ${profile.detail||'no fuerza datos musicales sin verificar'}${profile.confidence==='low'?' · análisis limitado':''}.`);}
      return ready;
    })().catch(error=>{if(token===generation)status(`No se pudo preparar el siguiente deck: ${error.message}`);return false;}).finally(()=>{if(prepareTask===task)prepareTask=null;});
    return task.promise;
  }
  async function mixNext({manual=false,effect='none'}={}){
    if(transitioning||mixer?.mixing)return false;
    if(!current)return next();
    transitioning=true;$('musicTransition').disabled=true;
    try{
      await prime();if(manual&&pendingSet){const ready=await prepareNext({quick:true,pending:true});if(!ready)return false;}else if(!mixer.prepared){const ready=await prepareNext({quick:manual});if(!ready)return false;}
      const direction=qdjControls();
      const journey={curve:direction.energy,targetMood:direction.mood,targetRhythm:direction.rhythm,targetEnergy:direction.energyTarget,position:Math.max(0,queue.indexOf(current)),total:queue.length};
      mixer.journey=journey;
      const options={manual,effect,bars:Number($('musicMixBars').value),fallbackSeconds:Number($('musicTransitionSeconds').value),journey};
      const plan=mixer.plan(options);status(`qDJ · ${plan.profile?.label||'transición conservadora'}${plan.synced?` a ${Math.round(plan.tempo)} BPM`:' sin forzar el tempo'}`);
      const result=await mixer.mix(options);
      if(result){status(`${result.profile?.label||'Transición'} completada.`);}
      return result;
    }finally{transitioning=false;$('musicTransition').disabled=false;if(mixer&&!mixer.audio.paused)void prepareNext();}
  }
  async function next(){const index=queue.indexOf(current)+1;if(index<queue.length)return playAt(index);if(pendingSet){const id=pendingSet.ids[0];commitPendingSet(id,{force:true});return playAt(0);}if(autopilot){const oldLength=queue.length;const added=await createAutopilot({append:true});if(added>0)return playAt(oldLength);}stop();}
  async function manualTransition(){
    if(manualTransitionPending||transitioning||mixer?.mixing||!current||audio.paused)return false;
    manualTransitionPending=true;manualPreparation=true;renderPlayer();
    try {
      if(liveTimer){clearTimeout(liveTimer);liveTimer=null;liveTask=applyLiveSteering(liveRevision);}
      if(liveTask&&await liveTask===false)return false;
      if(!current||audio.paused)return false;
      mixer?.finishPreparation();return await mixNext({manual:true,effect:$('musicLiveFx').value});
    }finally{manualPreparation=false;manualTransitionPending=false;renderPlayer();}
  }

  function noiseBuffer(seconds=.7){const frames=Math.max(1,Math.floor(context.sampleRate*seconds));const buffer=context.createBuffer(1,frames,context.sampleRate);const data=buffer.getChannelData(0);for(let index=0;index<frames;index++)data[index]=(Math.random()*2-1)*(1-index/frames);return buffer;}
  async function playSfx(kind){await prime();if(!mixer.reserveEffectHeadroom())return;const now=context.currentTime;const out=context.createGain();out.gain.setValueAtTime(.0001,now);const ceiling=context.createWaveShaper();ceiling.curve=Float32Array.from({length:257},(_,i)=>Math.max(-.45,Math.min(.45,i/128-1)));out.connect(ceiling);ceiling.connect(gain);if(kind==='chime'){[523.25,659.25,783.99].forEach((frequency,index)=>{const oscillator=context.createOscillator();const level=context.createGain();oscillator.type='sine';oscillator.frequency.value=frequency;level.gain.setValueAtTime(.0001,now+index*.07);level.gain.exponentialRampToValueAtTime(.16,now+index*.07+.025);level.gain.exponentialRampToValueAtTime(.0001,now+1.2+index*.07);oscillator.connect(level).connect(out);oscillator.start(now+index*.07);oscillator.stop(now+1.35+index*.07);});out.gain.exponentialRampToValueAtTime(.8,now+.02);out.gain.exponentialRampToValueAtTime(.0001,now+1.5);}else if(kind==='riser'){const noise=context.createBufferSource();const filter=context.createBiquadFilter();noise.buffer=noiseBuffer(1.4);filter.type='bandpass';filter.Q.value=1.1;filter.frequency.setValueAtTime(240,now);filter.frequency.exponentialRampToValueAtTime(6200,now+1.35);noise.connect(filter).connect(out);out.gain.exponentialRampToValueAtTime(.32,now+.08);out.gain.exponentialRampToValueAtTime(.0001,now+1.4);noise.start(now);}else{const oscillator=context.createOscillator();oscillator.type=kind==='airhorn'?'sawtooth':'sine';oscillator.frequency.setValueAtTime(kind==='airhorn'?185:92,now);oscillator.frequency.exponentialRampToValueAtTime(kind==='airhorn'?150:48,now+(kind==='airhorn' ? .55 : .7));oscillator.connect(out);out.gain.exponentialRampToValueAtTime(kind==='airhorn' ? .18 : .42,now+.025);out.gain.exponentialRampToValueAtTime(.0001,now+(kind==='airhorn' ? .62 : .78));oscillator.start(now);oscillator.stop(now+.85);}status(`FX · ${kind==='impact'?'Impacto':kind==='riser'?'Subida':kind==='chime'?'Destello':'Alerta'}`);}

  async function playTransitionEffect(kind){
    if(!['sweep','riser','impact'].includes(kind)||!mixer)return false;
    const seconds=kind==='riser'?1.2:.8;if(!mixer.reserveEffectHeadroom(seconds+.1,.9))return false;
    const now=context.currentTime,out=context.createGain(),ceiling=context.createWaveShaper();
    ceiling.curve=Float32Array.from({length:257},(_,i)=>Math.max(-.08,Math.min(.08,i/128-1)));out.connect(ceiling);ceiling.connect(gain);
    out.gain.setValueAtTime(.0001,now);out.gain.exponentialRampToValueAtTime(.07,now+.04);out.gain.exponentialRampToValueAtTime(.0001,now+seconds);
    const source=kind==='impact'?context.createOscillator():context.createBufferSource();let filter=null;
    if(kind==='impact'){source.type='sine';source.frequency.setValueAtTime(90,now);source.frequency.exponentialRampToValueAtTime(45,now+seconds);source.connect(out);}
    else{source.buffer=noiseBuffer(seconds);filter=context.createBiquadFilter();filter.type='bandpass';filter.Q.value=.8;filter.frequency.setValueAtTime(kind==='riser'?300:5200,now);filter.frequency.exponentialRampToValueAtTime(kind==='riser'?6200:300,now+seconds);source.connect(filter).connect(out);}
    source.onended=()=>{source.disconnect();filter?.disconnect();out.disconnect();ceiling.disconnect();};source.start(now);source.stop(now+seconds+.02);return true;
  }

  function fireReaction(emoji){const overlay=$('musicFxOverlay');for(let index=0;index<7;index++){const particle=node('span',emoji);particle.style.setProperty('--x',`${12+Math.random()*76}%`);particle.style.setProperty('--drift',`${-70+Math.random()*140}px`);particle.style.setProperty('--delay',`${index*.08}s`);overlay.append(particle);setTimeout(()=>particle.remove(),3300);}window.dispatchEvent(new CustomEvent('qsession-camera-reaction',{detail:{emoji}}));status(`Reacción ${emoji} enviada al video.`);}

  function bindAudio(element){
    element.addEventListener('ended',()=>{if(element===audio&&!mixer?.mixing)void next().catch(error=>status(error.message));});
    element.addEventListener('error',()=>{if(element!==audio&&(mixer?.preparing||mixer?.mixing)){mixer.cancel();status('El segundo deck falló; la pista actual continúa.');}else if(element===audio&&!loading&&current&&!mixer?.mixing)void next().catch(error=>status(error.message));});
    // Seeking the cue on the incoming media element emits `waiting` normally.
    // Cancelling here aborted every real-browser mix before its faders started.
    // The mixer's bounded play promise handles an unavailable incoming stream.
    element.addEventListener('waiting',()=>{if(element===audio&&!mixer?.mixing)status('Cargando audio · qDJ mantiene preparada la siguiente pista.');});
    for(const event of ['timeupdate','durationchange','play','pause','emptied'])element.addEventListener(event,()=>{if(element===audio)renderPlayer();});
  }
  function showMusicView(view){$('musicCatalogView').hidden=view!=='catalog';$('musicPlaylistsView').hidden=view!=='playlists';dialog.dataset.musicView=view;document.querySelectorAll('[data-music-view]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.musicView===view)));}
  async function usePlaylist(item,{play=false}={}){
    if(current){const ids=item.trackIds.filter(id=>trackById(id));if(!ids.length)throw Error('Esta playlist no tiene pistas disponibles.');if(transitioning||mixer?.mixing)throw Error('Espera a que termine la transición.');pendingRevision++;pendingSet={ids,name:item.name};renderPendingSet();if(queue.indexOf(current)===queue.length-1){generation++;prepareTask=null;mixer?.cancel();void prepareNext();}status('Playlist en espera · '+item.name);if(play)await manualTransition();return;}
    if(current)stop();queue=item.trackIds.filter(id=>trackById(id));$('musicName').value=item.name;$('musicSaved').value=item.id;renderQueue();renderTracks();
    if(!queue.length)throw new Error('Esta playlist no tiene pistas disponibles.');
    showMusicView('catalog');status('Playlist cargada · '+item.name);
    if(play){await prime();await playAt(0);}
  }
  function renderPlaylistCards(){
    const list=$('musicPlaylistCards');list.replaceChildren();
    for(const item of playlists){const tracks=item.trackIds.map(trackById).filter(Boolean);const card=node('article',undefined,'music-playlist-card');const cover=node('div',undefined,'music-playlist-cover');cover.append(node('span','♫'),node('small',String(tracks.length).padStart(2,'0')));const content=node('div',undefined,'music-playlist-card-copy');content.append(node('h4',item.name),node('p',tracks.length+' pistas · '+Math.ceil(tracks.reduce((sum,t)=>sum+t.duration,0)/60)+' min'));const actions=node('div',undefined,'music-playlist-card-actions');actions.append(button('Escuchar',()=>usePlaylist(item,{play:true}),'Escuchar '+item.name),button('Cargar al set',()=>usePlaylist(item),'Cargar '+item.name+' al set'));card.append(cover,content,actions);list.append(card);}
    if(!playlists.length){const empty=node('div',undefined,'music-playlist-empty');empty.append(node('span','♫'),node('h4','Tu próximo set empieza aquí'),node('p','Agrega canciones a la cola y guarda tu primera playlist.'),button('Explorar la biblioteca',()=>showMusicView('catalog')));list.append(empty);}
  }
  document.querySelectorAll('[data-music-view]').forEach(control=>control.addEventListener('click',()=>showMusicView(control.dataset.musicView)));
  $('musicSaveAsNew').onclick=()=>{$('musicSaved').value='';$('musicName').value='';$('musicName').focus();status('Escribe un nombre para guardar este set como una nueva playlist.');};
  $('musicClearUpcoming').onclick=()=>{generation++;prepareTask=null;if(mixer)mixer.cancel();queue=current?[current]:[];renderQueue();renderTracks();status('Próximas pistas retiradas.');};
  async function loadSaved(){playlists=[];$('musicSaved').replaceChildren(new Option('Seleccionar…',''));try{playlists=(await request('/api/music/playlists')).playlists;for(const item of playlists)$('musicSaved').add(new Option(item.name,item.id));}catch{$('musicSaved').replaceChildren(new Option('Inicia sesión para ver tus playlists',''));}renderPlaylistCards();}
async function loadCatalog(){catalog=await request('/api/music/catalog');if(!catalog.families.some(item=>item.id===family))family=catalog.families[0]?.id||'electronic';$('musicFamilies').replaceChildren(...catalog.families.map(item=>{const control=button(item.name,()=>{browseAll=false;browseFamily=item.id;browsePage=0;$('musicSearch').value='';$('musicSubgenre').value='';renderFamilies();});control.dataset.family=item.id;control.append(node('small',catalog.tracks.filter(t=>t.family===item.id).length+' pistas'));return control;}));const all=button('Todos los géneros',()=>{browseAll=true;browseFamily=null;browsePage=0;renderFamilies();});all.dataset.family='all';$('musicFamilies').prepend(all);queue=queue.filter(id=>trackById(id));$('musicEditFamily').replaceChildren(...catalog.families.filter(item=>!['cumbia','roots'].includes(item.id)).map(item=>new Option(item.name,item.id)));const aiReady=Boolean(catalog.qdj?.aiGeneration?.enabled);$('musicAiCreate').disabled=!aiReady;$('musicAiAvailability').hidden=aiReady;$('musicAiCreate').title=aiReady?'Crear una nueva pista con el proveedor conectado':'La creación musical con IA quedará disponible al conectar un proveedor autorizado';renderFamilies();renderQueue();syncLiveControls();}
  let workspaceLoad = null;
  function setWorkspaceExpanded(expanded) {
    dialog.classList.toggle('is-collapsed', !expanded);
    $('musicClose').setAttribute('aria-expanded', String(expanded));
    $('musicClose').setAttribute('aria-label', expanded ? 'Contraer biblioteca' : 'Expandir biblioteca');
    $('musicClose').textContent = expanded ? '⌃' : '⌄';
  }
  async function loadWorkspace() {
    if (workspaceLoad) return workspaceLoad;
    workspaceLoad = (async () => {
      try {
        await loadCatalog(); await loadSaved(); await refreshFeedback();
        try { await request('/api/admin/session'); adminMode=true; $('musicImportPanel').hidden=false; }
        catch { adminMode=false; $('musicImportPanel').hidden=true; }
        renderTracks();
        if(!catalog.enabled) status('La biblioteca está desactivada temporalmente.');
      } catch(error) { status('No fue posible cargar la biblioteca. '+error.message); }
      finally { workspaceLoad=null; }
    })();
    return workspaceLoad;
  }
  async function open() {
    browseAll=false;browseFamily=null;browsePage=0;
    showMusicView('catalog');
    $('musicSearch').value='';$('musicSubgenre').value='';
    $('musicLibrarySlot').hidden=false;
    setWorkspaceExpanded(true);
    if(appViewHost && typeof showView==='function')showView('music');
    await loadWorkspace();
    renderFamilies();
    if(appViewHost){
      window.scrollTo({top:0,behavior:'instant'});
      $('musicBackToSet')?.focus({preventScroll:true});
    }else{
      $('musicLibrarySlot').scrollIntoView({block:'start',behavior:'smooth'});
      $('musicImportButton').focus({preventScroll:true});
    }
  }

  function readDuration(file){return new Promise(resolve=>{const probe=new Audio();const url=URL.createObjectURL(file);let settled=false;const done=value=>{if(settled)return;settled=true;URL.revokeObjectURL(url);probe.removeAttribute('src');resolve(Number.isFinite(value)&&value>0?Math.round(value):0);};const timeout=setTimeout(()=>done(0),8000);probe.preload='metadata';probe.onloadedmetadata=()=>{clearTimeout(timeout);done(probe.duration);};probe.onerror=()=>{clearTimeout(timeout);done(0);};probe.src=url;});}
  async function uploadTrack(file){const duration=await readDuration(file);const params=new URLSearchParams({filename:file.name,relativePath:file.webkitRelativePath||file.name,title:file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' '),artist:'QSession Original'});if(duration)params.set('duration',String(duration));let lastError;for(let attempt=0;attempt<2;attempt++){try{const response=await fetch(`/api/admin/music/import?${params}`,{method:'POST',body:file,headers:{'Content-Type':file.type||'application/octet-stream'},credentials:'same-origin',signal:AbortSignal.timeout(240000)});const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{}if(response.status===401)throw Object.assign(new Error('La sesión de administración venció. Vuelve a iniciar sesión.'),{fatal:true});if(!response.ok)throw new Error(data.error||`El servidor respondió ${response.status}`);return data;}catch(error){lastError=error;if(error.fatal||attempt===1)throw error;}}throw lastError;}
  async function importFolder(files){const accepted=[...files].filter(file=>/\.(mp3|wav|m4a|aac|ogg|oga|flac)$/i.test(file.name));if(!accepted.length)throw new Error('La carpeta no contiene archivos de audio compatibles');const progress=$('musicImportProgress');progress.hidden=false;const bar=progress.querySelector('i');const copy=progress.querySelector('p');const errors=[];let cursor=0,completed=0,imported=0,duplicates=0;const worker=async()=>{while(cursor<accepted.length){const file=accepted[cursor++];copy.textContent=`${completed+1} de ${accepted.length} · ${file.name}`;try{const data=await uploadTrack(file);if(data.duplicate)duplicates++;else imported++;}catch(error){errors.push({name:file.name,message:error?.message||'No se pudo importar'});if(error.fatal)cursor=accepted.length;}completed++;bar.style.width=`${100*completed/accepted.length}%`;}};await Promise.all([worker(),worker()]);const failed=errors.length;copy.textContent=`${imported} nuevas · ${duplicates} repetidas${failed?` · ${failed} con error`:''}`;await loadCatalog();window.dispatchEvent(new CustomEvent('qsession:music-imported',{detail:{imported,duplicates,failed}}));if(failed){const first=errors[0];status(`No se pudieron importar ${failed} ${failed===1?'pista':'pistas'}. ${first.name}: ${first.message}`);}else status(`Biblioteca actualizada: ${imported} pistas incorporadas y ${duplicates} repetidas.`);$('musicFolderInput').value='';}

  $('musicLiveEnergy').oninput=()=>{beginLiveSteering();liveEnergy=Number($('musicLiveEnergy').value);selectOption('musicEnergy','steady');syncLiveControls();scheduleLiveSteering();};
  $('musicLiveMood').oninput=()=>{beginLiveSteering();selectOption('musicMood',liveMoods[Number($('musicLiveMood').value)]);syncLiveControls();scheduleLiveSteering();};
  $('musicLiveGenre').oninput=()=>{const selected=catalog?.families[Number($('musicLiveGenre').value)];if(!selected)return;beginLiveSteering();family=selected.id;selectOption('musicBpm','0-0');$('musicSubgenre').value='';renderFamilies();syncLiveControls();scheduleLiveSteering();};
  $('musicLiveRelease').onclick=()=>{liveSteering=false;selectOption('musicEnergy',liveCurve);syncLiveControls();scheduleLiveSteering();};
  $('musicLiveTransition').onclick=()=>void manualTransition().catch(error=>{$('musicLiveStatus').textContent=error.message;});
  $('musicFeedbackRefresh').onclick=()=>void renderFeedbackStats();
  $('musicFeedbackRefresh').closest('details').addEventListener('toggle',event=>{if(event.target.open)void renderFeedbackStats();});
  $('musicClose').onclick=()=>setWorkspaceExpanded(dialog.classList.contains('is-collapsed'));$('musicSearch').oninput=()=>{browsePage=0;renderTracks();};$('musicSubgenre').onchange=()=>{browsePage=0;renderTracks();};
  $('musicAutopilot').closest('.music-switch').onclick=event=>event.stopPropagation();
  $('musicAutopilot').onchange=event=>{autopilot=event.target.checked;if(mixer)mixer.auto=autopilot;event.target.closest('label').querySelector('b').textContent=autopilot?'Activo':'Pausado';renderPlayer();if(autopilot)void prepareNext();status(autopilot?'qDJ continuará la mezcla automáticamente.':'qDJ pausado: el set terminará con la cola actual.');};
  $('musicStartSession').onclick=async()=>{const control=$('musicStartSession');if(control.disabled)return;control.disabled=true;try{await startSession();}catch(error){status(error.message);}finally{control.disabled=false;}};
  $('musicShowAuto').onclick=()=>{const panel=$('musicAutopilot').closest('details');panel.open=true;panel.scrollIntoView({block:'start',behavior:'smooth'});};
  $('musicMomentCommand').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('musicStartSession').click();}};
  $('musicGenerate').onclick=async()=>{try{await prime();mixer.style=$('musicRhythm').value==='smooth'?'smooth':'auto';if(await createAutopilot({append:false}))await playAt(0);}catch(error){status(error.message);}};$('musicApplyCommand').onclick=()=>void applyQdjCommand().catch(error=>status(error.message));$('musicQdjCommand').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void applyQdjCommand().catch(error=>status(error.message));}};$('musicAiCreate').onclick=()=>status('La cabina de creación con IA está preparada. Falta conectar un proveedor musical autorizado.');$('musicImportButton').onclick=()=>$('musicFolderInput').click();$('musicFolderInput').onchange=event=>void importFolder(event.target.files).catch(error=>status(error.message));
  $('musicPlay').onclick=async()=>{try{if(loading)return;await prime();if(!queue.length){if(autopilot)await createAutopilot({append:false});else throw new Error('Agrega pistas o activa el Autopiloto DJ');}if(current&&audio.src){generation++;playbackRequested=true;await audio.play();void prepareNext();}else await playAt(Math.max(0,queue.indexOf(current)));}catch(error){status(error.message);}};
  $('musicPause').onclick=()=>{playbackRequested=false;generation++;prepareTask=null;loading=false;if(mixer)mixer.pause();else audio.pause();status('Reproducción pausada.');};$('musicNext').onclick=async()=>{try{await prime();await next();}catch(error){status(error.message);}};$('musicPrevious').onclick=async()=>{try{await prime();if(current&&audio.currentTime>3){generation++;prepareTask=null;mixer.seek(0);void prepareNext();}else await playAt(Math.max(0,queue.indexOf(current)-1));}catch(error){status(error.message);}};
  $('musicSeek').oninput=()=>{generation++;prepareTask=null;if(Number.isFinite(audio.duration))mixer.seek(Math.min(audio.duration,Number($('musicSeek').value)));};$('musicSeek').onchange=()=>void prepareNext();$('musicMixBars').onchange=()=>{if(mixer)mixer.bars=Number($('musicMixBars').value);};$('musicBpmDown').onclick=()=>{applyTargetBpm(targetBpm-1);status(`${targetBpm} BPM`);};$('musicBpmUp').onclick=()=>{applyTargetBpm(targetBpm+1);status(`${targetBpm} BPM`);};$('musicBpmReset').onclick=()=>{const original=Number(trackById(current)?.bpm)||124;applyTargetBpm(original,{manual:false});status(`BPM original · ${original}`);};$('musicTransition').onclick=()=>void manualTransition().catch(error=>status(error.message));$('musicVolume').oninput=()=>{const value=Number($('musicVolume').value);if(gain)gain.gain.setValueAtTime(value/100,context.currentTime);$('musicVolumeValue').textContent=`${value}%`;};
  document.querySelectorAll('[data-music-panel]').forEach(control=>control.addEventListener('click',()=>{const panel=control.dataset.musicPanel;document.querySelectorAll('[data-music-panel]').forEach(item=>item.setAttribute('aria-selected',String(item===control)));$('musicQueuePanel').hidden=panel!=='queue';$('musicEffectsPanel').hidden=panel!=='effects';$('musicQueuePanel').classList.toggle('is-active',panel==='queue');$('musicEffectsPanel').classList.toggle('is-active',panel==='effects');}));
  document.querySelectorAll('[data-music-sfx]').forEach(control=>control.addEventListener('click',()=>void playSfx(control.dataset.musicSfx).catch(error=>status(error.message))));
  document.querySelectorAll('[data-music-reaction]').forEach(control=>control.addEventListener('click',()=>fireReaction(control.dataset.musicReaction)));
  $('musicSave').onclick=async()=>{try{if(!queue.length)throw new Error('Agrega pistas antes de guardar');const name=$('musicName').value.trim();if(!name)throw new Error('Escribe un nombre para la playlist');const fresh=(await request('/api/music/playlists')).playlists;const selected=$('musicSaved').value;const id=fresh.some(item=>item.id===selected)?selected:crypto.randomUUID();await request('/api/music/playlists',{method:'PUT',body:JSON.stringify({playlists:[...fresh.filter(item=>item.id!==id),{id,name,trackIds:pendingSet?pendingSet.ids:queue}]})});await loadSaved();$('musicSaved').value=id;status('Playlist guardada en tu cuenta.');}catch(error){status(error.message);}};
  $('musicLoad').onclick=()=>{const selected=playlists.find(item=>item.id===$('musicSaved').value);if(!selected)return status('Selecciona una playlist guardada');void usePlaylist(selected).catch(error=>status(error.message));};
  $('musicDelete').onclick=async()=>{try{const id=$('musicSaved').value;if(!id)throw new Error('Selecciona una playlist');const fresh=(await request('/api/music/playlists')).playlists;await request('/api/music/playlists',{method:'PUT',body:JSON.stringify({playlists:fresh.filter(item=>item.id!==id)})});await loadSaved();status('Playlist eliminada.');}catch(error){status(error.message);}};
  $('musicEditSave').addEventListener('click',async event=>{event.preventDefault();try{const id=$('musicEditId').value;await request(`/api/admin/music/tracks/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({title:$('musicEditTitle').value,artist:$('musicEditArtist').value,family:$('musicEditFamily').value,subgenre:$('musicEditSubgenre').value,bpm:Number($('musicEditBpm').value),camelotKey:$('musicEditKey').value,beatGrid:$('musicEditBeatOffset').value.trim()===''?null:{bpm:Number($('musicEditBpm').value),offset:Number($('musicEditBeatOffset').value),phraseStart:$('musicEditPhraseStart').value.trim()===''?null:Number($('musicEditPhraseStart').value),verified:true},mood:$('musicEditMood').value,rhythm:$('musicEditRhythm').value,energy:Number($('musicEditEnergy').value)})});editor.close();await loadCatalog();status('Clasificación qDJ actualizada.');}catch(error){status(error.message);}});
  document.querySelectorAll('[data-open-music]').forEach(control=>control.addEventListener('click',()=>{
    const opening=open();
    if(standaloneAdmin&&control.hasAttribute('data-import-music'))$('musicFolderInput').click();
    void opening.catch(error=>status(error.message));
  }));

  async function capture(){if(!queue.length){if(autopilot)await createAutopilot({append:false});else throw new Error('Abre la biblioteca y agrega pistas antes de transmitir');}await prime();destination=context.createMediaStreamDestination();mixer.output.connect(destination);broadcasting=true;const track=destination.stream.getAudioTracks()[0];try{await playAt(Math.max(0,queue.indexOf(current)));if(audio.paused)throw new Error('No se pudo reproducir la playlist');return {stream:destination.stream,track};}catch(error){release();throw error;}}
  async function resumeBroadcast(){
    if(!broadcasting||!destination||!current||!playbackRequested||loading||transitioning)return;
    if(!destination.stream.getAudioTracks().some(track=>track.readyState==='live'))throw new Error('La salida de la biblioteca se cerró. Reinicia la transmisión.');
    if(context.state==='suspended'||context.state==='interrupted')await context.resume();
    if(audio.paused)await mixer.play(audio);
    mixer.tick();
  }
  function release(){if(destination){mixer.output.disconnect(destination);destination.stream.getTracks().forEach(track=>track.stop());destination=null;}if(broadcasting)stop();broadcasting=false;}
  let creditGeneration=0;async function showRoomTrack(id){const token=++creditGeneration,box=$('roomMusicCredit');if(!box)return;box.replaceChildren();box.hidden=true;roomTrackId=null;if(!id)return;try{if(!catalog)catalog=await request('/api/music/catalog');if(token!==creditGeneration)return;const track=trackById(id);if(track){roomTrackId=id;box.append(creditNode(track));box.hidden=false;await refreshFeedback(id);}}catch{}}
  setupSetDesk();
  window.QSessionMusic={open,prime,capture,release,stop,showRoomTrack,resumeBroadcast};
  const consoleElement = $('mediaConsole');
  const showHostWorkspace = () => {
    if (consoleElement?.dataset.mediaRole === 'dj') void loadWorkspace();
  };
  if(consoleElement)new MutationObserver(showHostWorkspace).observe(consoleElement,{attributes:true,attributeFilter:['data-media-role']});
  showHostWorkspace();
  window.addEventListener('DOMContentLoaded',()=>{if(location.hash==='#music')void loadWorkspace().catch(e=>status(e.message));},{once:true});
  setInterval(()=>{
    if(document.hidden)return;
    if(consoleElement?.dataset.mediaRole==='dj')void refreshFeedback().catch(()=>{});
    else if(roomTrackId)void refreshFeedback(roomTrackId).catch(()=>{});
  },30000);
})();
