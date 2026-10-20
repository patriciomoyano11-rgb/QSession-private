'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {RoomServiceClient,EgressClient,AccessToken,SegmentedFileOutput,SegmentedFileProtocol,EncodingOptions,AudioCodec,VideoCodec}=require('/app/node_modules/livekit-server-sdk');
const p=JSON.parse(fs.readFileSync('/lab/control.json','utf8'));
if(p.apiUrl!=='http://livekit:7885'||p.room!=='qsession-LAB10A'||p.identity!=='dj-synthetic-rehearsal')throw Error('Scope');
const [action,argument]=process.argv.slice(2);
const rooms=new RoomServiceClient(p.apiUrl,p.key,p.secret),egress=new EgressClient(p.apiUrl,p.key,p.secret);
(async()=>{
 if(action==='prepare'){
  await rooms.createRoom({name:p.room,emptyTimeout:300,departureTimeout:15,maxParticipants:2});
  const token=new AccessToken(p.key,p.secret,{identity:p.identity,ttl:600});token.addGrant({room:p.room,roomJoin:true,canPublish:true,canSubscribe:false,canPublishData:false});
  console.log(JSON.stringify({token:await token.toJwt()})); // private pipe inside isolated VM only
 }else if(action==='start'){
  if(!['a','b'].includes(argument))throw Error('Encoder scope');
  const dj=(await rooms.listParticipants(p.room)).find(x=>x.identity===p.identity);
  const audio=dj?.tracks.find(t=>t.type===0&&!t.muted),video=dj?.tracks.find(t=>t.type===1&&!t.muted);
  if(!audio||!video)throw Error('Synthetic tracks missing');
  const output=new SegmentedFileOutput({protocol:SegmentedFileProtocol.HLS_PROTOCOL,filenamePrefix:'/out/rehearsal/segment_'+argument+'_'+crypto.randomBytes(8).toString('hex'),
   playlistName:'/out/rehearsal/archive.m3u8',livePlaylistName:'/out/rehearsal/index.m3u8',segmentDuration:6});
  const encodingOptions=new EncodingOptions({width:1280,height:720,framerate:30,audioCodec:AudioCodec.AAC,audioBitrate:128,audioFrequency:48000,videoCodec:VideoCodec.H264_MAIN,videoBitrate:1600,keyFrameInterval:6});
  const job=await egress.startTrackCompositeEgress(p.room,output,{audioTrackId:audio.sid,videoTrackId:video.sid,encodingOptions});
  console.log(JSON.stringify({egressId:job.egressId,status:job.status,encoder:argument}));
 }else if(action==='status'){
  console.log(JSON.stringify({jobs:(await egress.listEgress({roomName:p.room})).map(j=>({id:j.egressId,status:j.status}))}));
 }else if(action==='stop'){
  const jobs=await egress.listEgress({roomName:p.room});if(!jobs.some(j=>j.egressId===argument))throw Error('Job not in isolated room');
  await egress.stopEgress(argument);console.log(JSON.stringify({stopped:true}));
 }else throw Error('Unknown action');
})().catch(error=>{console.error(JSON.stringify({controlFailed:true,errorClass:error.name,errorCode:error.code||null}));process.exitCode=1;});
