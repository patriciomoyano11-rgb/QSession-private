'use strict';

// Offline audit of operator-supplied evidence. This never provisions or activates anything.
const CHECKS = Object.freeze([
  'cdnCapacity', 'budget', 'originShieldAndCache', 'accessAndPrivacy',
  'distributedAdmissions', 'loadAndReconnect', 'encoderFailover',
  'windowsAudioVideo', 'androidAudioVideoAndLock', 'webAudioVideo',
  'costAndPlaybackAlerts', 'rollbackRehearsal',
  'privateChatAndGroups', 'privateMediaAccess', 'privateVoiceIsolation', 'privateChatLoad',
]);
const DAY = 86400000;
function plannedProfile(env = {}) {
  return {width:1280,height:720,framerate:30,
    videoBitrate:Number(env.QSESSION_HLS_VIDEO_BITRATE || 1800000),
    audioBitrate:Number(env.QSESSION_HLS_AUDIO_BITRATE || 128000),
    segmentSeconds:Number(env.QSESSION_HLS_SEGMENT_SECONDS || 4)};
}
function assessReadiness(env = {}, evidence = {}, now = Date.now()) {
  const blockers = [];
  const roomCode = String(env.QSESSION_CDN_ONLY_ROOM || '').trim().toUpperCase();
  const target = Number(env.QSESSION_BROADCAST_AUDIENCE_TARGET || 500000);
  const profile = plannedProfile(env);
  const mode=env.QSESSION_AUDIENCE_MODE||'interactive';
  if (!['interactive','cdn-only'].includes(mode)) blockers.push('El modo configurado no es válido.');
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) blockers.push('Selecciona una única sala de seis caracteres.');
  if (!Number.isInteger(target) || target < 1 || target > 500000) blockers.push('La audiencia objetivo debe estar entre 1 y 500000.');
  if (!(profile.videoBitrate>=500000&&profile.videoBitrate<=6000000&&profile.audioBitrate>=64000&&profile.audioBitrate<=320000&&Number.isInteger(profile.segmentSeconds)&&profile.segmentSeconds>=2&&profile.segmentSeconds<=10)) blockers.push('El perfil de audio/video no es válido.');
  if (evidence.schemaVersion!==1 || evidence.roomCode!==roomCode || evidence.targetViewers!==target) blockers.push('El expediente debe corresponder a esta sala y audiencia.');
  if (!evidence.approvedBy || !String(evidence.approvedBy).trim()) blockers.push('Falta la persona responsable de revisar las evidencias.');
  const approvedAt=Date.parse(evidence.approvedAt), expiresAt=Date.parse(evidence.expiresAt);
  if (!Number.isFinite(approvedAt)||approvedAt>now||now-approvedAt>30*DAY||!Number.isFinite(expiresAt)||expiresAt<=now||expiresAt<=approvedAt||expiresAt-approvedAt>30*DAY) blockers.push('La revisión debe ser reciente y caducar en un máximo de 30 días.');
  if (!(Number.isSafeInteger(evidence.providerConcurrentViewers)&&evidence.providerConcurrentViewers>=target)) blockers.push('Falta confirmar capacidad concurrente del proveedor.');
  if (!(Number.isSafeInteger(evidence.loadTestConcurrentViewers)&&evidence.loadTestConcurrentViewers>=target)) blockers.push('Falta una prueba de concurrencia para la audiencia objetivo.');
  const joinWindowSeconds=Number(evidence.joinWindowSeconds);
  if (!(joinWindowSeconds>=30&&joinWindowSeconds<=300&&Number(evidence.loadTestJoinsPerSecond)>=Math.ceil(target/joinWindowSeconds))) blockers.push('Falta validar la ráfaga de ingreso distribuida (ventana de 30 a 300 segundos).');
  for (const [key,value] of Object.entries(profile)) if(evidence.profile?.[key]!==value) {blockers.push('El perfil probado no coincide con la configuración propuesta.');break;}
  for(const key of CHECKS){
    const check=evidence.checks?.[key],date=Date.parse(check?.verifiedAt);
    if(check?.status!=='passed'||!String(check.reference||'').trim()||!Number.isFinite(date)||date>now||now-date>30*DAY) blockers.push(`Pendiente: ${key}.`);
  }
  const totalBitrate=profile.videoBitrate+profile.audioBitrate;
  return {schemaVersion:1,roomCode,targetViewers:target,configuredMode:['interactive','cdn-only'].includes(mode)?mode:'invalid',willActivate:false,
    evidenceComplete:blockers.length===0,capacityCertifiedByThisTool:false,blockers,profile,
    planning:{aggregateTbps:totalBitrate*target/1e12,terabytesPerHour:totalBitrate*target*3600/8/1e12,
      segmentRequestsPerSecond:target/profile.segmentSeconds,excludes:'Manifiestos, contenedor, TLS, reintentos y servicios de la app.'}};
}
function parseEnv(source) {
  const result={};
  for(const raw of source.replace(/^\uFEFF/,'').split(/\r?\n/)){
    const match=/^\s*(?:export\s+)?(QSESSION_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(raw);
    if(!match)continue;
    let value=match[2];
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    else value=value.replace(/\s+#.*$/,'').trim();
    result[match[1]]=value;
  }
  return result;
}
module.exports={CHECKS,plannedProfile,assessReadiness,parseEnv};
