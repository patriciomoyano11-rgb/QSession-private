'use strict';
const fs=require('node:fs');
const path=require('node:path');
function createMusicPlaylists({databaseUrl='',pool=null,filePath,hasTrack}={}) {
  const ownPool=!pool&&!!databaseUrl;
  const db=pool||(databaseUrl?new (require('pg').Pool)({connectionString:databaseUrl,max:3}):null);
  let saved={};
  if (!db && filePath && fs.existsSync(filePath)) saved=JSON.parse(fs.readFileSync(filePath,'utf8'));
  return {
    async get(accountId) {
      if (db) return (await db.query('SELECT playlists FROM qsession_music_playlists WHERE account_id=$1',[accountId])).rows[0]?.playlists||[];
      return structuredClone(saved[accountId]||[]);
    },
    async put(accountId,playlists) {
      if (!Array.isArray(playlists)||playlists.length>20) throw new Error('Puedes guardar hasta 20 playlists');
      const ids=new Set();
      const clean=playlists.map(p=>{
        if (!p || typeof p.id!=='string'|| !/^[a-zA-Z0-9-]{1,80}$/.test(p.id)||ids.has(p.id)) throw new Error('Playlist no válida');
        ids.add(p.id);
        if (typeof p.name!=='string'||!p.name.trim()||p.name.length>80) throw new Error('Escribe un nombre de hasta 80 caracteres');
        if (!Array.isArray(p.trackIds)||p.trackIds.length>100||p.trackIds.some(id=>typeof id!=='string'||!hasTrack(id))) throw new Error('La playlist contiene canciones fuera de la selección');
        return {id:p.id,name:p.name.trim(),trackIds:[...new Set(p.trackIds)]};
      });
      if (db) await db.query('INSERT INTO qsession_music_playlists(account_id,playlists) VALUES($1,$2::jsonb) ON CONFLICT(account_id) DO UPDATE SET playlists=EXCLUDED.playlists,updated_at=NOW()',[accountId,JSON.stringify(clean)]);
      else {
        const next={...saved,[accountId]:clean};
        if (filePath) {fs.mkdirSync(path.dirname(filePath),{recursive:true});fs.writeFileSync(filePath+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(filePath+'.tmp',filePath);}
        saved=next;
      }
      return clean;
    },
    async remove(accountId) {
      if (db) {
        await db.query('DELETE FROM qsession_music_playlists WHERE account_id=$1',[accountId]);
        return true;
      }
      if (!Object.prototype.hasOwnProperty.call(saved,accountId)) return false;
      const next={...saved};
      delete next[accountId];
      if (filePath) {fs.mkdirSync(path.dirname(filePath),{recursive:true});fs.writeFileSync(filePath+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(filePath+'.tmp',filePath);}
      saved=next;
      return true;
    },
    async close(){if(ownPool)await db.end();},
  };
}
module.exports={createMusicPlaylists};
