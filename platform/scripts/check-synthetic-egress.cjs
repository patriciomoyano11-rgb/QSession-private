'use strict';
// Execute in the production app container. Only the isolated synthetic room is controlled.
const {createEdgeBroadcastProvider} = require('./edge-broadcast');
const {RoomServiceClient} = require('livekit-server-sdk');
const e = process.env;
const api = (e.LIVEKIT_URL || e.LIVEKIT_PUBLIC_URL).replace(/^ws/, 'http');
const provider = createEdgeBroadcastProvider({
  apiUrl: api, apiKey: e.LIVEKIT_API_KEY, apiSecret: e.LIVEKIT_API_SECRET,
  endpoint: e.QSESSION_BROADCAST_STORAGE_ENDPOINT || e.QSESSION_R2_ENDPOINT,
  bucket: e.QSESSION_BROADCAST_STORAGE_BUCKET || e.QSESSION_R2_BUCKET,
  accessKey: e.QSESSION_BROADCAST_STORAGE_ACCESS_KEY || e.QSESSION_R2_ACCESS_KEY,
  secretKey: e.QSESSION_BROADCAST_STORAGE_SECRET_KEY || e.QSESSION_R2_SECRET_KEY,
  pathSecret: e.QSESSION_ROOM_SECRET || e.QSESSION_AUTH_PEPPER,
  region: e.QSESSION_BROADCAST_STORAGE_REGION || e.QSESSION_R2_REGION || 'auto',
  forcePathStyle: String(e.QSESSION_BROADCAST_FORCE_PATH_STYLE).toLowerCase() === 'true' || (!e.QSESSION_BROADCAST_STORAGE_ENDPOINT && Boolean(e.QSESSION_R2_ENDPOINT)),
  storagePlaybackBaseUrl: e.QSESSION_BROADCAST_STORAGE_PLAYBACK_BASE_URL || e.QSESSION_EDGE_PLAYBACK_BASE_URL,
  storagePlaybackPathPrefix: e.QSESSION_BROADCAST_STORAGE_PLAYBACK_PATH_PREFIX,
  storagePlaybackManifestSuffix: e.QSESSION_BROADCAST_STORAGE_PLAYBACK_MANIFEST_SUFFIX,
  segmentDuration: e.QSESSION_HLS_SEGMENT_SECONDS || 6,
  audioBitrate: e.QSESSION_HLS_AUDIO_BITRATE || 128000,
  videoBitrate: e.QSESSION_HLS_VIDEO_BITRATE || 1800000,
});
(async () => {
  const action = e.QSESSION_PROBE_ACTION || 'status';
  let result;
  if (action === 'start') result = await provider.start('PRB10A', {participantIdentity:'dj-primary-prb10a'});
  else if (action === 'stop') {
    result = await provider.stop('PRB10A');
    await new RoomServiceClient(api,e.LIVEKIT_API_KEY,e.LIVEKIT_API_SECRET).deleteRoom('qsession-PRB10A');
  } else result = await provider.status('PRB10A');
  console.log(JSON.stringify(result));
})().catch(error => { console.error(JSON.stringify({probeFailed:true,name:error.name,code:error.code,message:String(error.message).replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,240)})); process.exitCode=1; });
