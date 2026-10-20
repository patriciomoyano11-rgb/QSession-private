import {FaceLandmarker, FilesetResolver} from '/vendor/mediapipe/vision_bundle.mjs';

const effects = [
  {id:'none', category:'looks', name:'Natural', icon:'N', note:'Imagen original'},
  {id:'nocturne', category:'looks', name:'Obsidian Pulse', icon:'OP', note:'Negro mineral, cian eléctrico y pulsos orbitales'},
  {id:'solar', category:'looks', name:'Acid Solarization', icon:'AS', note:'Color invertido, calor líquido y alto contraste'},
  {id:'spectral', category:'looks', name:'Chromatic Rift', icon:'CR', note:'Canales RGB separados y fracturas móviles'},
  {id:'monolith', category:'looks', name:'Monolith Ink', icon:'MI', note:'Silueta gráfica, bandas negras y destellos blancos'},
  {id:'kaleido', category:'looks', name:'Quantum Kaleido', icon:'QK', note:'Rostro multiplicado en prismas rotatorios'},
  {id:'qfauna', category:'entities', name:'Q‑Fauna Jaguar', icon:'QF', note:'Felino de cristal bioluminiscente', asset:'/camera-effects/q-fauna-jaguar.png'},
  {id:'raccoon', category:'entities', name:'Mapache Q‑Bandit', icon:'MB', note:'Antifaz animal con orejas y circuitos cian', asset:'/camera-effects/raccoon-mask.png'},
  {id:'trump', category:'entities', name:'Trump Caricature', icon:'TC', note:'Máscara teatral satírica y deliberadamente artificial', asset:'/camera-effects/trump-caricature-mask.png'},
  {id:'alien', category:'entities', name:'Alien Iridescente', icon:'AI', note:'Cráneo mineral y ojos cósmicos', asset:'/camera-effects/alien-mask.png'},
  {id:'moth', category:'entities', name:'Moth Signal', icon:'MS', note:'Alas de frecuencia alrededor del rostro'},
  {id:'abyss', category:'entities', name:'Abyss Bloom', icon:'AB', note:'Organismo oceánico de luz'},
  {id:'halo', category:'couture', name:'Resonance Halo', icon:'RH', note:'Corona construida con ondas sonoras', asset:'/camera-effects/resonance-halo.png'},
  {id:'glass', category:'couture', name:'Liquid Glass', icon:'LG', note:'Visor de vidrio fluido'},
  {id:'orbit', category:'couture', name:'Orbital Veil', icon:'OV', note:'Joyería cinética suspendida'},
  {id:'veil', category:'reactive', name:'Quantum Veil', icon:'QV', note:'Ribbons de luz que enmarcan el cuerpo', asset:'/camera-effects/quantum-veil.png'},
  {id:'aura', category:'reactive', name:'Resonance Field', icon:'RF', note:'Campo energético en expansión'},
  {id:'particles', category:'reactive', name:'Photon Garden', icon:'PG', note:'Partículas con gravedad inversa'},
  {id:'prism', category:'reactive', name:'Temporal Prism', icon:'TP', note:'Ecos cromáticos del movimiento'},
  {id:'glitch', category:'reactive', name:'Signal Rupture', icon:'SR', note:'Ruptura digital controlada'},
];

const $ = id => document.getElementById(id);
const state = {stream:null, facingMode:'user', mirrored:true, effect:'none', category:'looks', intensity:.7, maskScale:1, maskOffset:0, animation:0, particles:[], faceLandmarker:null, facePose:null, lastVideoTime:-1, trackerPromise:null, missedFaces:0};
const video = $('camera');
const canvas = $('effectCanvas');
const context = canvas.getContext('2d', {alpha:false});
const assets = Object.fromEntries(effects.filter(effect=>effect.asset).map(effect=>{const image=new Image();image.src=effect.asset;return [effect.id,image]}));
const faceMaskCalibration = {
  raccoon:{eyeGap:.36,eyeY:.49,scale:1.02,offsetY:-.01,alpha:1},
  trump:{eyeGap:.275,eyeY:.425,scale:.97,offsetY:.01,alpha:.96},
  alien:{eyeGap:.35,eyeY:.49,scale:1.02,offsetY:-.015,alpha:.97,blend:'screen'},
};
const CUSTOM_MASK_DB='qsession-private-mask-studio';

function openMaskDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(CUSTOM_MASK_DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('masks',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function persistCustomMask(record) {
  const database=await openMaskDatabase();
  await new Promise((resolve,reject)=>{
    const transaction=database.transaction('masks','readwrite');
    transaction.objectStore('masks').put(record);
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error);
  });
  database.close();
}

function registerCustomEffect(record) {
  if(effects.some(effect=>effect.id===record.id))return;
  const kind=record.kind||'mask',category=kind==='mask'?'entities':kind==='filter'?'looks':'reactive';
  effects.push({id:record.id,category,name:record.name,icon:kind==='mask'?'MÍ':kind==='filter'?'FÍ':'VJ',note:`${kind==='mask'?'Máscara':kind==='filter'?'Filtro':'Efecto VJ'} privado creado por ti`,asset:record.dataUrl,custom:true,customKind:kind});
  const image=new Image(); image.src=record.dataUrl; assets[record.id]=image;
  if(kind==='mask')faceMaskCalibration[record.id]={eyeGap:record.eyeGap??.35,eyeY:record.eyeY??.45,scale:1,offsetY:0,alpha:1,custom:true};
}

async function restoreCustomMasks() {
  try {
    const database=await openMaskDatabase();
    const records=await new Promise((resolve,reject)=>{const request=database.transaction('masks').objectStore('masks').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    records.forEach(registerCustomEffect); database.close(); renderEffects();
  } catch (error) { console.warn('No se pudieron restaurar las máscaras privadas.',error); }
}

function fileAsDataUrl(file) {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});
}

async function apiRequest(url,payload) {
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'No pudimos completar la creación');
  return result;
}

async function initializeFaceTracker() {
  if (state.faceLandmarker) return state.faceLandmarker;
  if (!state.trackerPromise) {
    state.trackerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe');
      state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {modelAssetPath:'/vendor/mediapipe/face_landmarker.task', delegate:'GPU'},
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: .55,
        minFacePresenceConfidence: .55,
        minTrackingConfidence: .5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      return state.faceLandmarker;
    })().catch(error => {
      state.trackerPromise = null;
      throw error;
    });
  }
  return state.trackerPromise;
}

function point(landmarks, index) {
  const landmark = landmarks[index];
  return {x:landmark.x*canvas.width, y:landmark.y*canvas.height, z:landmark.z || 0};
}

function updateFacePose(time) {
  if (!state.faceLandmarker || video.readyState < 2 || video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;
  const result = state.faceLandmarker.detectForVideo(video, time);
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks) {
    state.missedFaces += 1;
    if (state.missedFaces > 8) state.facePose = null;
    $('fpsLabel').textContent='BUSCANDO ROSTRO';
    return;
  }
  state.missedFaces = 0;
  const leftCheek=point(landmarks,234), rightCheek=point(landmarks,454);
  const leftEye=point(landmarks,33), rightEye=point(landmarks,263);
  const top=point(landmarks,10), chin=point(landmarks,152), nose=point(landmarks,1);
  const measured = {
    x:nose.x,
    y:(top.y+chin.y)*.5,
    eyeX:(leftEye.x+rightEye.x)*.5,
    eyeY:(leftEye.y+rightEye.y)*.5,
    eyeDistance:Math.hypot(rightEye.x-leftEye.x,rightEye.y-leftEye.y),
    topY:top.y,
    chinY:chin.y,
    width:Math.hypot(rightCheek.x-leftCheek.x,rightCheek.y-leftCheek.y),
    height:Math.hypot(chin.x-top.x,chin.y-top.y),
    angle:Math.atan2(rightEye.y-leftEye.y,rightEye.x-leftEye.x),
  };
  const previous=state.facePose, smoothing=.38;
  state.facePose = previous ? Object.fromEntries(Object.keys(measured).map(key=>[key,previous[key]+(measured[key]-previous[key])*smoothing])) : measured;
  $('fpsLabel').textContent='ROSTRO ✓';
}

function renderEffects() {
  $('effectGrid').replaceChildren(...effects.filter(effect => effect.category === state.category).map(effect => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'effect-option';
    button.dataset.effect = effect.id;
    button.setAttribute('aria-pressed', String(effect.id === state.effect));
    button.innerHTML = `<i aria-hidden="true"${effect.asset ? ` style="background-image:url('${effect.asset}')"` : ''}>${effect.asset ? '' : effect.icon}</i><span><b>${effect.name}</b><small>${effect.note}</small></span>`;
    return button;
  }));
}

function setEffect(id) {
  const effect = effects.find(item => item.id === id) || effects[0];
  state.effect = effect.id;
  $('effectName').textContent = effect.name;
  $('maskCalibrationControls').hidden = !(faceMaskCalibration[effect.id] || effect.id === 'qfauna');
  $('customMaskAdvanced').hidden = !effect.custom;
  if(effect.custom){const calibration=faceMaskCalibration[effect.id];$('maskEyeGap').value=String(Math.round(calibration.eyeGap*100));$('maskEyeY').value=String(Math.round(calibration.eyeY*100));$('maskEyeGapValue').textContent=`${Math.round(calibration.eyeGap*100)}%`;$('maskEyeYValue').textContent=`${Math.round(calibration.eyeY*100)}%`}
  renderEffects();
}

function videoFilter() {
  const amount = state.intensity;
  if (state.effect === 'nocturne') return `grayscale(${amount*.52}) contrast(${1.35+amount*.75}) saturate(${.45+amount*.35}) hue-rotate(${amount*145}deg) brightness(${.92-amount*.24})`;
  if (state.effect === 'solar') return `invert(${amount*.52}) sepia(${amount*.42}) contrast(${1.3+amount}) saturate(${1.8+amount*2.2}) hue-rotate(${amount*210}deg)`;
  if (state.effect === 'spectral') return `contrast(${1.35+amount*.75}) saturate(${1.8+amount*2.4}) hue-rotate(${-amount*28}deg)`;
  if (state.effect === 'monolith') return `grayscale(1) contrast(${2.2+amount*2.8}) brightness(${.88+amount*.12})`;
  if (state.effect === 'kaleido') return `contrast(${1.15+amount*.45}) saturate(${1.5+amount*1.4}) hue-rotate(${Math.round(amount*45)}deg)`;
  return 'none';
}

function drawLookTreatment(time) {
  const w=canvas.width,h=canvas.height,a=state.intensity;
  if (state.effect === 'nocturne') {
    context.save(); context.globalCompositeOperation='multiply';
    const shade=context.createRadialGradient(w*.5,h*.42,w*.08,w*.5,h*.48,w*.72); shade.addColorStop(0,`rgba(30,235,230,${.08+a*.12})`); shade.addColorStop(.48,'rgba(10,35,72,.48)'); shade.addColorStop(1,'rgba(0,3,16,.94)'); context.fillStyle=shade; context.fillRect(0,0,w,h);
    context.globalCompositeOperation='screen'; context.strokeStyle=`rgba(58,245,234,${.18+a*.45})`; context.lineWidth=2+a*8;
    for(let i=0;i<3;i++){const pulse=(Math.sin(time/380+i*1.7)+1)*.5;context.beginPath();context.ellipse(w*.5,h*.46,w*(.2+i*.14+pulse*.025),h*(.28+i*.13+pulse*.03),time/5200,0,Math.PI*2);context.stroke()}; context.restore();
  }
  if (state.effect === 'solar') {
    context.save(); context.globalCompositeOperation='difference'; context.globalAlpha=.34+a*.46;
    const acid=context.createLinearGradient(0,0,w,h); acid.addColorStop(0,'#ff1744'); acid.addColorStop(.32,'#ffe600'); acid.addColorStop(.63,'#00ffd5'); acid.addColorStop(1,'#6a00ff'); context.fillStyle=acid; context.fillRect(0,0,w,h);
    context.globalCompositeOperation='screen'; context.globalAlpha=.14+a*.18; context.translate(Math.sin(time/260)*w*.018,0); context.filter=`hue-rotate(${time/18}deg) contrast(1.8)`; context.drawImage(video,0,0,w,h); context.restore();
  }
  if (state.effect === 'spectral') {
    const shift=w*(.012+a*.035)*(Math.sin(time/240)*.35+1);
    context.save(); context.globalCompositeOperation='screen'; context.globalAlpha=.32+a*.38;
    context.filter='sepia(1) saturate(8) hue-rotate(300deg)'; context.drawImage(video,-shift,0,w,h);
    context.filter='sepia(1) saturate(8) hue-rotate(125deg)'; context.drawImage(video,shift,0,w,h); context.filter='none';
    for(let i=0;i<7;i++){const x=((i*193+time*.08)% (w+w*.15))-w*.08;context.fillStyle=`hsla(${(i*67+time/20)%360},100%,60%,${.06+a*.12})`;context.fillRect(x,0,w*.045,h)} context.restore();
  }
  if (state.effect === 'monolith') {
    context.save(); context.globalCompositeOperation='multiply';
    for(let i=0;i<8;i++){const y=(i*h/8+Math.sin(time/310+i)*h*.018);context.fillStyle=`rgba(0,0,0,${.2+a*.34})`;context.fillRect(0,y,w,h*(.025+a*.035))}
    context.globalCompositeOperation='screen'; context.strokeStyle=`rgba(115,255,244,${.3+a*.55})`; context.lineWidth=1+a*5; context.strokeRect(w*.035,h*.045,w*.93,h*.91); context.restore();
  }
  if (state.effect === 'kaleido') {
    const cx=state.facePose?.x ?? w/2,cy=state.facePose?.y ?? h*.44,r=Math.max(w,h)*(.38+a*.18);
    context.save(); context.globalAlpha=.38+a*.42; context.globalCompositeOperation='screen';
    for(let i=0;i<8;i++){context.save();context.translate(cx,cy);context.rotate(i*Math.PI/4+time/6500);context.beginPath();context.moveTo(0,0);context.lineTo(r,-r*.42);context.lineTo(r,r*.42);context.closePath();context.clip();if(i%2)context.scale(1,-1);context.rotate(Math.sin(time/900+i)*.16);context.drawImage(video,-cx,-cy,w,h);context.restore()}
    context.restore();
  }
}

function drawCenteredEmoji(emoji, y=.32, scale=.34) {
  const size = Math.min(canvas.width, canvas.height) * scale * (.7 + state.intensity * .55);
  context.save();
  context.font = `${size}px "Segoe UI Emoji"`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.globalAlpha = .55 + state.intensity * .45;
  context.fillText(emoji, canvas.width / 2, canvas.height * y);
  context.restore();
}

function drawAbstract(time) {
  const w = canvas.width, h = canvas.height, amount = state.intensity;
  if (state.effect === 'aura') {
    const pose=state.facePose, cx=pose?.x ?? w/2, cy=pose?.y ?? h*.5, fw=pose?.width ?? w*.46, fh=pose?.height ?? h*.5;
    context.save(); context.globalCompositeOperation = 'screen';
    for (let i=0;i<5;i++) { const pulse=(Math.sin(time/420+i)+1)/2; context.strokeStyle=`hsla(${165+i*38},90%,65%,${.12+amount*.22})`; context.lineWidth=3+i*2; context.beginPath(); context.ellipse(cx,cy,fw*(.58+i*.11+pulse*.04),fh*(.68+i*.08+pulse*.04),pose?.angle ?? 0,0,Math.PI*2); context.stroke(); }
    context.restore();
  }
  if (state.effect === 'particles') {
    if (!state.particles.length) state.particles = Array.from({length:36},(_,i)=>({x:Math.random(),y:Math.random(),r:1+Math.random()*4,s:.0002+Math.random()*.0007,h:i*19}));
    context.save(); context.globalCompositeOperation='screen';
    state.particles.forEach(p=>{p.y-=p.s*(10+amount*25);if(p.y<-.03){p.y=1.03;p.x=Math.random()} context.fillStyle=`hsla(${p.h+time/35},90%,70%,${.25+amount*.55})`;context.beginPath();context.arc(p.x*w,p.y*h,p.r*(.5+amount),0,Math.PI*2);context.fill()}); context.restore();
  }
  if (state.effect === 'prism') {
    context.save(); context.globalCompositeOperation='screen'; context.globalAlpha=.08+amount*.12; context.drawImage(video,-w*.015,0,w,h); context.fillStyle='rgba(255,0,100,.16)';context.fillRect(0,0,w,h);context.drawImage(video,w*.015,0,w,h);context.fillStyle='rgba(0,180,255,.12)';context.fillRect(0,0,w,h); context.restore();
  }
  if (state.effect === 'glitch' && Math.random()<.25+amount*.4) {
    context.save(); for(let i=0;i<5;i++){const y=Math.random()*h,hh=3+Math.random()*22,shift=(Math.random()-.5)*w*.08*amount;context.drawImage(canvas,0,y,w,hh,shift,y,w,hh)} context.restore();
  }
  if (state.effect === 'moth' || state.effect === 'abyss' || state.effect === 'glass' || state.effect === 'orbit') {
    const pose=state.facePose, scale=(pose?.width ?? w*.42)/(w*.42);
    context.save(); context.globalCompositeOperation='screen'; context.translate(pose?.x ?? w/2,pose?.y ?? h*.39); context.rotate(pose?.angle ?? 0); context.scale(scale,scale);
    const pulse=1+Math.sin(time/480)*.035*amount; context.scale(pulse,pulse); context.lineWidth=2+amount*4;
    const hue=state.effect==='abyss'?185:state.effect==='moth'?278:state.effect==='glass'?165:42;
    for(let side of [-1,1]) { context.strokeStyle=`hsla(${hue+side*24},90%,68%,${.35+amount*.45})`; context.beginPath(); context.moveTo(side*w*.08,-h*.05); context.bezierCurveTo(side*w*.25,-h*.22,side*w*.31,h*.08,side*w*.12,h*.22); context.bezierCurveTo(side*w*.28,h*.12,side*w*.34,h*.28,side*w*.18,h*.34); context.stroke(); }
    context.restore();
  }
}

function drawAssetOverlay(time=0) {
  const image=assets[state.effect]; if(!image?.complete || !image.naturalWidth)return;
  const w=canvas.width,h=canvas.height,pose=state.facePose,effect=effects.find(item=>item.id===state.effect); context.save(); context.globalAlpha=.45+state.intensity*.55;
  if(effect?.customKind==='filter') {
    context.globalCompositeOperation='screen'; context.globalAlpha=.18+state.intensity*.62;
    const cover=Math.max(w/image.naturalWidth,h/image.naturalHeight),iw=image.naturalWidth*cover,ih=image.naturalHeight*cover;
    context.drawImage(image,(w-iw)/2,(h-ih)/2,iw,ih); context.restore(); return;
  }
  if(effect?.customKind==='vj') {
    const pulse=1+Math.sin(time/430)*(.025+state.intensity*.055),size=Math.max(w,h)*1.18;
    context.globalCompositeOperation='screen';context.globalAlpha=.28+state.intensity*.7;context.translate(w/2,h/2);context.rotate(Math.sin(time/1900)*.09);context.scale(pulse,pulse);context.drawImage(image,-size/2,-size/2,size,size);context.restore();return;
  }
  if(state.effect==='qfauna') {
    const width=(pose?.width ?? w*.38)*(1.42+state.intensity*.18)*state.maskScale,height=width*image.naturalHeight/image.naturalWidth;
    context.translate(pose?.x ?? w/2,(pose?.y ?? h*.36)+height*state.maskOffset); context.rotate(pose?.angle ?? 0); context.drawImage(image,-width/2,-height*.48,width,height);
  }
  const maskCalibration=faceMaskCalibration[state.effect];
  if(maskCalibration && pose) {
    const width=pose.eyeDistance/maskCalibration.eyeGap*maskCalibration.scale*state.maskScale;
    const height=width*image.naturalHeight/image.naturalWidth;
    context.globalAlpha=maskCalibration.alpha*(.72+state.intensity*.28);
    if(maskCalibration.blend) context.globalCompositeOperation=maskCalibration.blend;
    context.translate(pose.eyeX,pose.eyeY+height*(maskCalibration.offsetY+state.maskOffset));
    context.rotate(pose.angle);
    context.drawImage(image,-width/2,-height*maskCalibration.eyeY,width,height);
  }
  if(state.effect==='halo') {
    context.globalCompositeOperation='screen'; const width=(pose?.width ?? w*.36)*2.05,height=width*image.naturalHeight/image.naturalWidth;
    context.translate(pose?.x ?? w/2,(pose?.topY ?? h*.22)-(pose?.height ?? h*.35)*.12); context.rotate(pose?.angle ?? 0); context.drawImage(image,-width/2,-height*.54,width,height);
  }
  if(state.effect==='veil') {
    context.globalCompositeOperation='screen'; const width=(pose?.width ?? w*.4)*3.25,height=width*image.naturalHeight/image.naturalWidth;
    context.translate(pose?.x ?? w/2,(pose?.y ?? h*.42)+(pose?.height ?? h*.4)*.44); context.rotate((pose?.angle ?? 0)*.35); context.drawImage(image,-width/2,-height*.42,width,height);
  }
  context.restore();
}

function drawFrame(time=0) {
  if (!state.stream || video.readyState < 2) { state.animation=requestAnimationFrame(drawFrame); return; }
  const targetWidth = Math.max(640, Math.min(1280, video.videoWidth || 1280));
  const ratio = (video.videoHeight || 720) / (video.videoWidth || 1280);
  if (canvas.width !== targetWidth) { canvas.width=targetWidth; canvas.height=Math.round(targetWidth*ratio); }
  updateFacePose(time);
  context.filter = videoFilter(); context.drawImage(video,0,0,canvas.width,canvas.height); context.filter='none';
  drawLookTreatment(time);
  drawAssetOverlay(time);
  drawAbstract(time);
  state.animation=requestAnimationFrame(drawFrame);
}

async function startCamera() {
  state.stream?.getTracks().forEach(track=>track.stop());
  try {
    $('status').classList.remove('is-error'); $('status').textContent='Preparando seguimiento facial local…';
    await initializeFaceTracker();
    state.stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:state.facingMode,width:{ideal:1280},height:{ideal:720}},audio:false});
    video.srcObject=state.stream; await video.play();
    $('cameraPlaceholder').hidden=true; $('startCamera').textContent='Apagar cámara';
    ['flipCamera','mirrorCamera','takePhoto'].forEach(id=>$(id).disabled=false);
    $('status').classList.remove('is-error');
    $('status').textContent='Cámara activa con seguimiento facial real. Mueve y gira la cabeza para probarlo.'; $('fpsLabel').textContent='BUSCANDO ROSTRO';
  } catch (error) {
    const cameraBusy = error?.name === 'NotReadableError' || /device in use|could not start video source/i.test(error?.message || '');
    $('startCamera').textContent='Reintentar cámara';
    $('status').classList.add('is-error');
    $('status').textContent = cameraBusy
      ? 'La cámara está siendo usada por QSession u otra aplicación. Apágala allí, vuelve a esta pestaña y pulsa “Reintentar cámara”.'
      : error?.name === 'NotAllowedError'
        ? 'Windows o el navegador bloquearon la cámara. Autoriza el permiso para este laboratorio local y vuelve a intentarlo.'
        : `No pudimos abrir la cámara: ${error?.message || 'error desconocido'}`;
  }
}

function stopCamera() {
  state.stream?.getTracks().forEach(track=>track.stop()); state.stream=null; video.srcObject=null;
  state.facePose=null; state.lastVideoTime=-1; state.missedFaces=0;
  $('cameraPlaceholder').hidden=false; $('startCamera').textContent='Encender cámara'; $('fpsLabel').textContent='LISTO';
  $('status').classList.remove('is-error'); $('status').textContent='Nada se transmite ni se guarda en QSession.';
  ['flipCamera','mirrorCamera','takePhoto'].forEach(id=>$(id).disabled=true); context.clearRect(0,0,canvas.width,canvas.height);
}

$('startCamera').addEventListener('click',()=>state.stream?stopCamera():startCamera());
$('flipCamera').addEventListener('click',async()=>{state.facingMode=state.facingMode==='user'?'environment':'user';await startCamera()});
$('mirrorCamera').addEventListener('click',()=>{state.mirrored=!state.mirrored;$('stage').classList.toggle('is-mirrored',state.mirrored);$('mirrorCamera').setAttribute('aria-pressed',String(state.mirrored))});
$('takePhoto').addEventListener('click',()=>{const link=document.createElement('a');link.download=`qsession-${state.effect}-${Date.now()}.png`;link.href=canvas.toDataURL('image/png');link.click();$('status').textContent='Muestra guardada en tus descargas.'});
$('clearEffect').addEventListener('click',()=>setEffect('none'));
$('effectGrid').addEventListener('click',event=>{const button=event.target.closest('[data-effect]');if(button)setEffect(button.dataset.effect)});
document.querySelector('.category-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(!button)return;state.category=button.dataset.category;document.querySelectorAll('[data-category]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderEffects()});
$('effectIntensity').addEventListener('input',event=>{state.intensity=Number(event.target.value)/100;$('intensityValue').textContent=`${event.target.value}%`});
$('maskScale').addEventListener('input',event=>{state.maskScale=Number(event.target.value)/100;$('maskScaleValue').textContent=`${event.target.value}%`});
$('maskOffset').addEventListener('input',event=>{state.maskOffset=Number(event.target.value)/100;$('maskOffsetValue').textContent=event.target.value});
$('resetMaskCalibration').addEventListener('click',()=>{state.maskScale=1;state.maskOffset=0;$('maskScale').value='100';$('maskOffset').value='0';$('maskScaleValue').textContent='100%';$('maskOffsetValue').textContent='0'});
$('maskEyeGap').addEventListener('input',event=>{const calibration=faceMaskCalibration[state.effect];if(!calibration?.custom)return;calibration.eyeGap=Number(event.target.value)/100;$('maskEyeGapValue').textContent=`${event.target.value}%`});
$('maskEyeY').addEventListener('input',event=>{const calibration=faceMaskCalibration[state.effect];if(!calibration?.custom)return;calibration.eyeY=Number(event.target.value)/100;$('maskEyeYValue').textContent=`${event.target.value}%`});
function updateCustomMaskButton(){const prompt=$('customEffectPrompt').value.trim();$('addCustomMask').disabled=!(prompt.length>=5&&$('customMaskRights').checked)}
$('customMaskFile').addEventListener('change',updateCustomMaskButton);
$('customMaskRights').addEventListener('change',updateCustomMaskButton);
$('customEffectPrompt').addEventListener('input',updateCustomMaskButton);
$('addCustomMask').addEventListener('click',async()=>{
  const file=$('customMaskFile').files?.[0],prompt=$('customEffectPrompt').value.trim(),kind=$('customEffectKind').value; if(prompt.length<5||!$('customMaskRights').checked)return;
  if(file&&(!['image/png','image/webp','image/jpeg'].includes(file.type)||file.size>8*1024*1024)){$('status').classList.add('is-error');$('status').textContent='Usa una imagen PNG, WebP o JPG de hasta 8 MB.';return}
  try{
    $('addCustomMask').disabled=true;$('addCustomMask').textContent='Creando · puede tardar un minuto…';$('status').classList.remove('is-error');$('status').textContent='La IA está recortando y construyendo tu efecto privado…';
    const result=await apiRequest('/api/effects/generate',{kind,prompt,imageDataUrl:file?await fileAsDataUrl(file):null});
    const record={id:`custom-${Date.now()}`,kind,prompt,name:$('customMaskName').value.trim()||`${kind==='mask'?'Máscara':kind==='filter'?'Filtro':'VJ'} personal`,dataUrl:result.imageDataUrl,eyeGap:.35,eyeY:.45,createdAt:Date.now()};
    await persistCustomMask(record); registerCustomEffect(record); state.category=kind==='mask'?'entities':kind==='filter'?'looks':'reactive'; document.querySelectorAll('[data-category]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.category===state.category))); setEffect(record.id); $('status').classList.remove('is-error'); $('status').textContent=`${kind==='mask'?'Máscara recortada':kind==='filter'?'Filtro':'Efecto VJ'} creado y guardado sólo en este dispositivo. Ya puedes probarlo con tu cámara.`;
  }catch(error){$('status').classList.add('is-error');$('status').textContent=`No pudimos crear el efecto: ${error.message}`}finally{$('addCustomMask').textContent='✦ Crear con IA y probar';updateCustomMaskButton()}
});

let voiceRecorder=null,voiceChunks=[],voiceStream=null,voiceTimer=null;
$('recordEffectPrompt').addEventListener('click',async()=>{
  if(voiceRecorder?.state==='recording'){voiceRecorder.stop();return}
  try{
    voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});voiceChunks=[];
    voiceRecorder=new MediaRecorder(voiceStream);voiceRecorder.ondataavailable=event=>{if(event.data.size)voiceChunks.push(event.data)};
    voiceRecorder.onstop=async()=>{clearTimeout(voiceTimer);voiceStream?.getTracks().forEach(track=>track.stop());$('recordEffectPrompt').classList.remove('is-recording');$('recordEffectPrompt').textContent='● Dictar indicación';$('voiceStatus').textContent='Transcribiendo…';try{const blob=new Blob(voiceChunks,{type:(voiceRecorder.mimeType||'audio/webm').split(';')[0]});const audioDataUrl=await fileAsDataUrl(blob);const result=await apiRequest('/api/effects/transcribe',{audioDataUrl});$('customEffectPrompt').value=[ $('customEffectPrompt').value.trim(),result.text ].filter(Boolean).join(' ');$('voiceStatus').textContent='Indicación añadida';updateCustomMaskButton()}catch(error){$('voiceStatus').textContent='No se pudo transcribir';$('status').classList.add('is-error');$('status').textContent=error.message}};
    voiceRecorder.start();$('recordEffectPrompt').classList.add('is-recording');$('recordEffectPrompt').textContent='■ Terminar dictado';$('voiceStatus').textContent='Escuchando…';voiceTimer=setTimeout(()=>{if(voiceRecorder?.state==='recording')voiceRecorder.stop()},30000);
  }catch(error){$('status').classList.add('is-error');$('status').textContent='Autoriza el micrófono para dictar tu idea.'}
});
window.addEventListener('pagehide',stopCamera);
$('stage').classList.add('is-mirrored'); renderEffects(); restoreCustomMasks(); drawFrame();
