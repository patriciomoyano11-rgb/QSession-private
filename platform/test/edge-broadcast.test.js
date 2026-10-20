'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {EgressStatus,TrackSource,TrackType} = require('livekit-server-sdk');
const {createEdgeBroadcastProvider} = require('../edge-broadcast');

function providerWith(client, options = {}) {
  return createEdgeBroadcastProvider({
    apiUrl: 'http://127.0.0.1:7880',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    endpoint: 'https://example.r2.cloudflarestorage.com',
    bucket: 'qsession-live',
    accessKey: 'r2-access',
    secretKey: 'r2-secret',
    pathSecret: 'private-playback-path-secret',
    playbackBaseUrl: 'https://live.qsession.example',
    segmentDuration: 4,
    provider: 'vultr-cdn-hls',
    client,
    roomClient: {async listParticipants() { return []; }},
    ...options,
  });
}

test('a 10000-listener recovery burst shares one status RPC and never caches a failed lookup', async () => {
  let calls = 0, fail = false;
  const provider = providerWith({async listEgress() {
    calls++;
    await new Promise(resolve => setImmediate(resolve));
    if (fail) throw new Error('temporary failure');
    return [{egressId: 'EG_STATUS', status: EgressStatus.EGRESS_ACTIVE}];
  }});
  const results = await Promise.all(Array.from({length: 10000}, () => provider.status('ABC123')));
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.state === 'active'));
  fail = true;
  await assert.rejects(provider.status('DEF456'));
  fail = false;
  assert.equal((await provider.status('DEF456')).state, 'active');
  assert.equal(calls, 3);
});

test('extrae solamente al DJ principal hacia HLS y nunca expone credenciales S3', async () => {
  const requests = [];
  const provider = providerWith({
    async listEgress() { return []; },
    async startParticipantEgress(roomName, identity, output, options) {
      requests.push({roomName, identity, output: output.toJson(), options: options.encodingOptions.toJson()});
      return {egressId: 'EG_1', status: EgressStatus.EGRESS_STARTING};
    },
  });
  const state = await provider.start('abc123', {participantIdentity: 'dj-primary-abc123'});
  assert.match(state.playbackUrl, /^https:\/\/live\.qsession\.example\/live\/ABC123-[A-Za-z0-9_-]{18}\/index\.m3u8$/);
  assert.equal(state.state, 'starting');
  assert.equal(requests[0].roomName, 'qsession-ABC123');
  assert.equal(requests[0].identity, 'dj-primary-abc123');
  assert.equal(requests[0].output.segmentDuration, 4);
  assert.match(requests[0].output.livePlaylistName, /^live\/ABC123-[A-Za-z0-9_-]{18}\/index\.m3u8$/);
  assert.notEqual(requests[0].output.s3.forcePathStyle, true);
  assert.equal(requests[0].options.width, 1280);
  assert.equal(requests[0].options.height, 720);
  assert.equal(requests[0].options.framerate, 30);
  assert.equal(requests[0].options.audioBitrate, 128);
  assert.equal(requests[0].options.videoBitrate, 1800);
  assert.doesNotMatch(JSON.stringify(state), /r2-secret|r2-access/);
});

test('un reinicio conserva el manifiesto pero nunca reutiliza segmentos inmutables en CDN', async () => {
  const prefixes = [];
  const provider = providerWith({
    async listEgress() { return []; },
    async startParticipantEgress(room, identity, output) {
      prefixes.push(output.filenamePrefix);
      return {egressId:'EG_' + prefixes.length,status:EgressStatus.EGRESS_STARTING};
    },
  });
  const first = await provider.start('ABC123',{participantIdentity:'dj-primary-abc123'});
  const second = await provider.start('ABC123',{participantIdentity:'dj-primary-abc123'});
  assert.equal(first.playbackUrl,second.playbackUrl);
  assert.notEqual(prefixes[0],prefixes[1]);
  for (const prefix of prefixes) assert.match(prefix,/\/segment_[a-f0-9]{16}$/);
});

test('exporta música compartida y cámara del DJ sin capturar pantalla ni oyentes', async () => {
  const requests=[];
  const tracks=[{sid:'AU_MUSIC',type:TrackType.AUDIO,source:TrackSource.SCREEN_SHARE_AUDIO},
    {sid:'VI_CAMERA',type:TrackType.VIDEO,source:TrackSource.CAMERA},
    {sid:'VI_DESKTOP',type:TrackType.VIDEO,source:TrackSource.SCREEN_SHARE}];
  const provider=providerWith({
    async listEgress(){return [];},
    async startParticipantEgress(){throw Error('Would omit the shared audio');},
    async startTrackCompositeEgress(room,output,options){requests.push({room,options});return {egressId:'EG_SHARED',status:EgressStatus.EGRESS_STARTING};},
  },{roomClient:{async listParticipants(){return [
    {identity:'listener-abc123',tracks:[{sid:'VI_LISTENER',type:TrackType.VIDEO,source:TrackSource.CAMERA}]},
    {identity:'dj-primary-abc123',tracks},
  ];}}});
  await provider.start('ABC123',{participantIdentity:'dj-primary-abc123'});
  assert.equal(requests[0].options.audioTrackId,'AU_MUSIC');
  assert.equal(requests[0].options.videoTrackId,'VI_CAMERA');
  assert.equal(requests[0].options.encodingOptions.audioBitrate,128);
  tracks[0].muted=true;
  await provider.start('ABC123',{participantIdentity:'dj-primary-abc123'});
  assert.equal(requests[1].options.audioTrackId,'AU_MUSIC','La música silenciada conserva su publicación para poder reanudarse; no se cambia al micrófono.');
});

test('captura el audio separado de Windows y no sustituye la cámara por la del oyente', async () => {
  let selected;
  const provider=providerWith({
    async listEgress(){return [];},
    async startTrackCompositeEgress(room,output,options){selected=options;return {egressId:'EG_DESKTOP',status:EgressStatus.EGRESS_STARTING};},
  },{roomClient:{async listParticipants(){return [
    {identity:'dj-primary-abc123',tracks:[{sid:'MIC',type:TrackType.AUDIO,source:TrackSource.MICROPHONE}]},
    {identity:'desktop-tab-audio-abc123-owner',tracks:[{sid:'DESKTOP_AUDIO',type:TrackType.AUDIO,source:TrackSource.SCREEN_SHARE_AUDIO}]},
    {identity:'listener-abc123',tracks:[{sid:'LISTENER_CAMERA',type:TrackType.VIDEO,source:TrackSource.CAMERA}]},
  ];}}});
  await provider.start('ABC123',{participantIdentity:'dj-primary-abc123'});
  assert.equal(selected.audioTrackId,'DESKTOP_AUDIO');
  assert.equal(selected.videoTrackId,undefined);
});

test('reutiliza el egress activo en lugar de cobrar una segunda mezcla', async () => {
  let starts = 0;
  const provider = providerWith({
    async listEgress() {
      return [{egressId: 'EG_ACTIVE', status: EgressStatus.EGRESS_ACTIVE}];
    },
    async startParticipantEgress() { starts += 1; },
  });
  const state = await provider.start('ABC123', {participantIdentity: 'dj-primary-abc123'});
  assert.equal(starts, 0);
  assert.equal(state.ready, true);
  assert.equal(state.egressId, 'EG_ACTIVE');
});

test('detiene todos los egress activos al cerrar la sala', async () => {
  const stopped = [];
  const provider = providerWith({
    async listEgress() {
      return [
        {egressId: 'EG_1', status: EgressStatus.EGRESS_ACTIVE},
        {egressId: 'EG_2', status: EgressStatus.EGRESS_STARTING},
      ];
    },
    async stopEgress(id) {
      stopped.push(id);
      return {egressId: id, status: EgressStatus.EGRESS_ENDING};
    },
  });
  const state = await provider.stop('ABC123');
  assert.deepEqual(stopped, ['EG_1', 'EG_2']);
  assert.equal(state.stopped, 2);
});

test('puede usar un volumen local efímero como origen económico del CDN', async () => {
  const requests = [];
  const provider = createEdgeBroadcastProvider({
    roomClient: {async listParticipants() { return []; }},
    apiUrl: 'http://127.0.0.1:7880', apiKey: 'key', apiSecret: 'secret',
    pathSecret: 'path-secret', playbackBaseUrl: 'https://cdn.example',
    playbackPathPrefix: 'edge-live', outputDirectory: '/out/edge-live',
    playbackManifestSuffix: '.txt',
    cleanupDirectory: '/data/edge-live', provider: 'vultr-cdn-local-hls',
    client: {
      async listEgress() { return []; },
      async startParticipantEgress(roomName, identity, output) {
        requests.push({roomName, identity, output: output.toJson()});
        return {egressId: 'EG_LOCAL', status: EgressStatus.EGRESS_STARTING};
      },
    },
  });
  const state = await provider.start('ABC123', {participantIdentity: 'dj-primary-abc123'});
  assert.equal(state.provider, 'vultr-cdn-local-hls');
  assert.match(state.playbackUrl, /^https:\/\/cdn\.example\/edge-live\/live\/ABC123-/);
  assert.match(state.playbackUrl, /\/index\.m3u8\.txt$/);
  assert.match(requests[0].output.filenamePrefix, /^\/out\/edge-live\/live\/ABC123-/);
  assert.equal(requests[0].output.s3, undefined);
});

test('R2 tiene prioridad sobre el volumen local y nunca recibe una ruta absoluta del servidor', async () => {
  const requests = [];
  const provider = providerWith({
    async listEgress() { return []; },
    async startParticipantEgress(roomName, identity, output) {
      requests.push({roomName, identity, output: output.toJson()});
      return {egressId: 'EG_R2', status: EgressStatus.EGRESS_STARTING};
    },
  }, {
    outputDirectory: '/out/edge-live',
    cleanupDirectory: '/data/edge-live',
    storagePlaybackBaseUrl: 'https://live.qsession.example',
    localPlaybackBaseUrl: 'https://qsession.example',
    localPlaybackPathPrefix: 'edge-live',
    provider: 'cloudflare-r2-hls',
  });
  const state = await provider.start('ABC123', {participantIdentity: 'dj-primary-abc123'});
  assert.equal(state.deliveryMode, 'object-storage');
  assert.equal(state.provider, 'cloudflare-r2-hls');
  assert.match(state.playbackUrl, /^https:\/\/live\.qsession\.example\/live\/ABC123-/);
  assert.match(requests[0].output.filenamePrefix, /^live\/ABC123-/);
  assert.ok(requests[0].output.s3);
});

test('usa el origen local de emergencia cuando R2 está incompleto', async () => {
  const requests = [];
  const provider = createEdgeBroadcastProvider({
    roomClient: {async listParticipants() { return []; }},
    apiUrl: 'http://127.0.0.1:7880', apiKey: 'key', apiSecret: 'secret',
    endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'qsession-live',
    accessKey: '', secretKey: '', pathSecret: 'path-secret',
    storagePlaybackBaseUrl: 'https://live.qsession.example',
    localPlaybackBaseUrl: 'https://qsession.example',
    localPlaybackPathPrefix: 'edge-live', outputDirectory: '/out/edge-live',
    cleanupDirectory: '/data/edge-live', provider: 'cloudflare-r2-hls',
    client: {
      async listEgress() { return []; },
      async startParticipantEgress(roomName, identity, output) {
        requests.push({roomName, identity, output: output.toJson()});
        return {egressId: 'EG_LOCAL', status: EgressStatus.EGRESS_STARTING};
      },
    },
  });
  const state = await provider.start('ABC123', {participantIdentity: 'dj-primary-abc123'});
  assert.equal(state.deliveryMode, 'local-origin');
  assert.equal(state.provider, 'local-origin-hls-fallback');
  assert.match(state.playbackUrl, /^https:\/\/qsession\.example\/edge-live\/live\/ABC123-/);
  assert.equal(requests[0].output.s3, undefined);
});

function compositeFixture() {
  const tracks=[{sid:'AUDIO',type:TrackType.AUDIO,source:TrackSource.SCREEN_SHARE_AUDIO},{sid:'CAMERA_OLD',type:TrackType.VIDEO,source:TrackSource.CAMERA}];
  let current={egressId:'EG_OLD',status:EgressStatus.EGRESS_ACTIVE,request:{case:'trackComposite',value:{audioTrackId:'AUDIO',videoTrackId:'CAMERA_OLD'}}};
  const calls=[];
  const provider=providerWith({async listEgress(){return current?[current]:[];},async stopEgress(id){calls.push({stop:id});current=null;},async startTrackCompositeEgress(room,output,options){calls.push({start:options,output});current={egressId:'EG_NEW',status:EgressStatus.EGRESS_STARTING};return current;}}, {roomClient:{async listParticipants(){return [{identity:'dj-primary-abc123',tracks}];}}});
  return {tracks,calls,provider};
}

test('a replacement camera reconnects one composite job to the new SID',async()=>{
 const h=compositeFixture();h.tracks[1].sid='CAMERA_NEW';
 const values=await Promise.all([h.provider.start('ABC123',{participantIdentity:'dj-primary-abc123'}),h.provider.start('ABC123',{participantIdentity:'dj-primary-abc123'})]);
 assert.equal(h.calls.filter(c=>c.stop).length,1);assert.equal(h.calls.filter(c=>c.start).length,1);assert.equal(h.calls[1].start.videoTrackId,'CAMERA_NEW');assert.equal(h.calls[1].start.audioTrackId,'AUDIO');assert.equal(values[0].egressId,'EG_NEW');assert.equal(values[1].egressId,'EG_NEW');
});

test('unchanged or muted camera retains the active composite without interrupting music',async()=>{
 const h=compositeFixture();await h.provider.start('ABC123',{participantIdentity:'dj-primary-abc123'});h.tracks[1].muted=true;await h.provider.start('ABC123',{participantIdentity:'dj-primary-abc123'});assert.equal(h.calls.length,0);
});

test('missing audio during a source handoff preserves the current output',async()=>{
 const h=compositeFixture();h.tracks.splice(0,1);assert.equal((await h.provider.start('ABC123',{participantIdentity:'dj-primary-abc123'})).egressId,'EG_OLD');assert.equal(h.calls.length,0);
});
