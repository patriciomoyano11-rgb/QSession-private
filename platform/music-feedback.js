'use strict';
const fs=require('node:fs'),path=require('node:path');
function createMusicFeedback({databaseUrl='',pool=null,filePath,hasTrack=()=>false}={}) {
  const ownPool=!pool&&!!databaseUrl;
  const db=pool||(databaseUrl?new (require('pg').Pool)({connectionString:databaseUrl,max:3}):null);
  let saved=(!db&&filePath&&fs.existsSync(filePath))?JSON.parse(fs.readFileSync(filePath,'utf8')):{};
  function persist(){if(filePath){fs.mkdirSync(path.dirname(filePath),{recursive:true});fs.writeFileSync(filePath+'.tmp',JSON.stringify(saved),{mode:0o600});fs.renameSync(filePath+'.tmp',filePath);}}
  async function get(actor='',trackId=null) {
    let totals,personal;
    if(db){
      totals=(await db.query('SELECT track_id, COUNT(*) FILTER (WHERE vote=1)::int AS likes, COUNT(*) FILTER (WHERE vote=-1)::int AS dislikes FROM qsession_music_feedback WHERE ($1::text IS NULL OR track_id=$1) GROUP BY track_id',[trackId])).rows;
      personal=(await db.query('SELECT track_id,vote FROM qsession_music_feedback WHERE actor=$1 AND ($2::text IS NULL OR track_id=$2)',[actor,trackId])).rows;
    }else{
      const grouped={};personal=[];
      for(const entry of Object.values(saved)){
        if(trackId&&entry.trackId!==trackId)continue;
        const sum=grouped[entry.trackId]||{track_id:entry.trackId,likes:0,dislikes:0};
        sum[entry.vote===1?'likes':'dislikes']++;grouped[entry.trackId]=sum;
        if(entry.actor===actor)personal.push({track_id:entry.trackId,vote:entry.vote});
      }
      totals=Object.values(grouped);
    }
    const mine=new Map(personal.map(row=>[row.track_id,Number(row.vote)]));
    const tracks={};
    for(const row of totals){
      if(!hasTrack(row.track_id))continue;
      const likes=Number(row.likes),dislikes=Number(row.dislikes),votes=likes+dislikes;
      tracks[row.track_id]={likes,dislikes,votes,myVote:mine.get(row.track_id)||0,approval:votes?Math.round(100*likes/votes):null,score:(likes-dislikes)/(votes+10)};
    }
    if(trackId&&!tracks[trackId])tracks[trackId]={likes:0,dislikes:0,votes:0,myVote:0,approval:null,score:0};
    return tracks;
  }
  return {
    get,
    async put(actor,trackId,vote){
      if(!actor||actor.length>160)throw new Error('Identidad de voto no válida');
      if(!hasTrack(trackId))throw new Error('Esta canción no pertenece a la biblioteca');
      if(![1,-1,0].includes(vote))throw new Error('Voto no válido');
      if(db){
        if(vote===0)await db.query('DELETE FROM qsession_music_feedback WHERE actor=$1 AND track_id=$2',[actor,trackId]);
        else await db.query('INSERT INTO qsession_music_feedback(actor,track_id,vote) VALUES($1,$2,$3) ON CONFLICT(actor,track_id) DO UPDATE SET vote=EXCLUDED.vote,updated_at=NOW()',[actor,trackId,vote]);
      }else{
        const key=actor+'\n'+trackId;
        if(vote===0)delete saved[key];else saved[key]={actor,trackId,vote,updatedAt:new Date().toISOString()};
        persist();
      }
      return (await get(actor,trackId))[trackId];
    },
    async remove(actor){if(db)await db.query('DELETE FROM qsession_music_feedback WHERE actor=$1',[actor]);else{for(const [key,value] of Object.entries(saved))if(value.actor===actor)delete saved[key];persist();}},
    async export(actor){if(db)return (await db.query('SELECT track_id AS "trackId",vote,updated_at AS "updatedAt" FROM qsession_music_feedback WHERE actor=$1',[actor])).rows;return Object.values(saved).filter(row=>row.actor===actor).map(({actor,...entry})=>entry);},
    async close(){if(ownPool)await db.end();},
  };
}
module.exports={createMusicFeedback};
