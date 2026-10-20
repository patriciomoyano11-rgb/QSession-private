'use strict';
// Read-only discovery; never imports search results into the published collection.
const fs = require('node:fs');
const path = require('node:path');
const queries = process.argv.slice(2);
async function main() {
  const results = [];
  for (const query of queries) {
    const url = new URL('https://api.audius.co/v1/tracks/search');
    url.search = new URLSearchParams({query, limit: '60', app_name: 'QSession'});
    const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`Audius: ${response.status}`);
    const {data} = await response.json();
    results.push({query, tracks: data.map(t => ({id:t.id,title:t.title,artist:t.user?.name,handle:t.user?.handle,verified:t.user?.is_verified,description:t.description,tags:t.tags,genre:t.genre,mood:t.mood,duration:t.duration,bpm:t.bpm,license:t.license,permalink:t.permalink,artwork:t.artwork?.['150x150'],date:t.release_date,plays:t.play_count,favorites:t.favorite_count,copyright:t.copyright_line,blocked:!!(t.is_unlisted || t.is_delete || t.is_available === false || t.is_streamable === false || t.is_stream_gated || t.access?.stream === false || t.ai_attribution_user_id || t.remix_of?.tracks?.length || t.cover_original_artist || t.cover_original_song_title),explicit:t.parental_warning_type}))});
  }
  const out = path.join(__dirname, '../tmp/audius-discovery.json');
  fs.mkdirSync(path.dirname(out), {recursive:true});
  fs.writeFileSync(out, JSON.stringify(results,null,2));
  for (const group of results) {
    console.log('\n'+group.query);
    for (const t of group.tracks) console.log(JSON.stringify({id:t.id,title:t.title,artist:t.artist,genre:t.genre,tags:t.tags,seconds:t.duration,blocked:t.blocked,license:t.license,plays:t.plays}));
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
