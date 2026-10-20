'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {audioProfile} = require('./music-audio-profile');

const MAX_TRACK_BYTES = 180 * 1024 * 1024;
const MAX_TRACK_SECONDS = 4 * 60 * 60;
const AUDIO_TYPES = new Map([
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.flac', 'audio/flac'],
]);

const taxonomy = [
  {family:'rock', genre:'Rock y metal', subgenre:'Death Metal', energy:5, bpm:124, mood:'dark', rhythm:'peak', words:['death metal','death-metal']},
  {family:'rock', genre:'Rock y metal', subgenre:'Metal', energy:5, bpm:124, mood:'dark', rhythm:'peak', words:['heavy metal','brutal metal']},
  {family:'electronic', genre:'Electrónica', subgenre:'Afro House', energy:4, bpm:122, mood:'warm', rhythm:'groove', words:['afro house','afrohouse']},
  {family:'electronic', genre:'Electrónica', subgenre:'Organic House', energy:3, bpm:120, mood:'warm', rhythm:'smooth', words:['organic house','organic']},
  {family:'electronic', genre:'Electrónica', subgenre:'Deep House', energy:3, bpm:122, mood:'deep', rhythm:'smooth', words:['deep house','deep-house']},
  {family:'electronic', genre:'Electrónica', subgenre:'Tech House', energy:4, bpm:126, mood:'focused', rhythm:'groove', words:['tech house','tech-house']},
  {family:'electronic', genre:'Electrónica', subgenre:'Melodic Techno', energy:4, bpm:126, mood:'euphoric', rhythm:'drive', words:['melodic techno','melodic-techno']},
  {family:'electronic', genre:'Electrónica', subgenre:'Progressive House', energy:4, bpm:124, mood:'euphoric', rhythm:'drive', words:['progressive house','progressive']},
  {family:'electronic', genre:'Electrónica', subgenre:'Techno', energy:5, bpm:132, mood:'dark', rhythm:'peak', words:['techno','acid','warehouse']},
  {family:'electronic', genre:'Electrónica', subgenre:'House', energy:4, bpm:124, mood:'celebratory', rhythm:'groove', words:['house','club','dancefloor']},
  {family:'electronic', genre:'Electrónica', subgenre:'Trance', energy:5, bpm:138, mood:'euphoric', rhythm:'peak', words:['trance','psytrance']},
  {family:'electronic', genre:'Electrónica', subgenre:'Drum & Bass', energy:5, bpm:174, mood:'euphoric', rhythm:'peak', words:['drum and bass','drum & bass','dnb','jungle']},
  {family:'electronic', genre:'Electrónica', subgenre:'Breaks', energy:4, bpm:132, mood:'focused', rhythm:'drive', words:['breakbeat','breaks','uk garage','garage']},
  {family:'latin', genre:'Latina', subgenre:'Reggaetón', energy:4, bpm:96, mood:'sensual', rhythm:'groove', words:['reggaeton','reggaetón','perreo']},
  {family:'latin', genre:'Latina', subgenre:'Salsa', energy:4, bpm:102, mood:'celebratory', rhythm:'drive', words:['salsa','son cubano']},
  {family:'latin', genre:'Latina', subgenre:'Cumbia', energy:4, bpm:98, mood:'celebratory', rhythm:'groove', words:['cumbia','villera','sonidera']},
  {family:'latin', genre:'Latina', subgenre:'Merengue', energy:5, bpm:132, mood:'celebratory', rhythm:'peak', words:['merengue']},
  {family:'latin', genre:'Latina', subgenre:'Bachata', energy:3, bpm:128, mood:'sensual', rhythm:'smooth', words:['bachata']},
  {family:'afro', genre:'Afro y global', subgenre:'Afrobeats', energy:4, bpm:112, mood:'warm', rhythm:'groove', words:['afrobeats','afrobeat','amapiano']},
  {family:'urban', genre:'Urbana', subgenre:'Hip Hop', energy:3, bpm:92, mood:'focused', rhythm:'groove', words:['hip hop','hip-hop','rap','boom bap']},
  {family:'urban', genre:'Urbana', subgenre:'R&B', energy:2, bpm:88, mood:'sensual', rhythm:'smooth', words:['r&b','rnb','soul']},
  {family:'pop', genre:'Pop y celebración', subgenre:'Pop', energy:3, bpm:116, mood:'celebratory', rhythm:'drive', words:['pop','celebration','birthday','cumpleaños','wedding','boda']},
  {family:'ambient', genre:'Chill y ambiental', subgenre:'Downtempo', energy:2, bpm:88, mood:'deep', rhythm:'smooth', words:['downtempo','chillout','chill out','lofi','lo-fi']},
  {family:'ambient', genre:'Chill y ambiental', subgenre:'Ambient', energy:1, bpm:72, mood:'meditative', rhythm:'smooth', words:['ambient','atmosphere','soundscape']},
  {family:'wellness', genre:'Bienestar', subgenre:'Meditación', energy:1, bpm:64, mood:'meditative', rhythm:'smooth', words:['meditation','meditación','mindfulness','healing']},
  {family:'wellness', genre:'Bienestar', subgenre:'Yoga', energy:1, bpm:72, mood:'meditative', rhythm:'smooth', words:['yoga','breathwork','relax']},
  {family:'instrumental', genre:'Instrumental', subgenre:'Cinemática', energy:3, bpm:90, mood:'deep', rhythm:'smooth', words:['cinematic','cinemática','soundtrack','score']},
  {family:'instrumental', genre:'Instrumental', subgenre:'Jazz', energy:3, bpm:110, mood:'warm', rhythm:'groove', words:['jazz','swing']},
  {family:'instrumental', genre:'Instrumental', subgenre:'Piano', energy:2, bpm:76, mood:'meditative', rhythm:'smooth', words:['piano','acoustic','acústica']},
];

const familyNames = {
  electronic:'Electrónica', latin:'Latina', afro:'Afro y global', urban:'Urbana', pop:'Pop y celebración',
  ambient:'Chill y ambiental', wellness:'Bienestar', instrumental:'Instrumental', rock:'Rock y metal',
};

function cleanText(value, maximum = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function titleFromFilename(filename) {
  return cleanText(path.basename(String(filename || ''), path.extname(String(filename || '')))
    .replace(/[_-]+/g, ' ').replace(/^\d+[ ._-]*/, ''), 120) || 'Pista sin título';
}

function classifyMusic({filename = '', relativePath = '', title = ''} = {}) {
  const haystack = `${filename} ${relativePath} ${title}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = taxonomy.find(item => item.words.some(word => haystack.includes(word.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))));
  return match
    ? {family:match.family, genre:match.genre, subgenre:match.subgenre, energy:match.energy, bpm:match.bpm, mood:match.mood, rhythm:match.rhythm, confidence:'filename'}
    : {family:'electronic', genre:'Electrónica', subgenre:'Electrónica contemporánea', energy:3, bpm:124, mood:'focused', rhythm:'drive', confidence:'review'};
}

function m4aDuration(buffer) {
  let offset = 0;
  const marker = Buffer.from('mvhd');
  while ((offset = buffer.indexOf(marker, offset)) >= 0) {
    const version = buffer[offset + 4];
    try {
      if (version === 0 && offset + 24 <= buffer.length) {
        const timescale = buffer.readUInt32BE(offset + 16);
        const duration = buffer.readUInt32BE(offset + 20);
        if (timescale && duration) return duration / timescale;
      }
      if (version === 1 && offset + 36 <= buffer.length) {
        const timescale = buffer.readUInt32BE(offset + 24);
        const duration = Number(buffer.readBigUInt64BE(offset + 28));
        if (timescale && duration) return duration / timescale;
      }
    } catch {}
    offset += marker.length;
  }
  return 0;
}

function mp3Duration(buffer) {
  let offset = 0;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' && buffer.length >= 10) {
    const tagSize = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + tagSize;
  }
  while (offset + 4 < buffer.length && !(buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0)) offset += 1;
  if (offset + 4 >= buffer.length) return 0;
  const versionBits = (buffer[offset + 1] >> 3) & 0x03;
  const layerBits = (buffer[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
  if (layerBits !== 1 || !bitrateIndex || bitrateIndex === 15) return 0;
  const mpeg1 = versionBits === 3;
  const rates = mpeg1
    ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]
    : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const bitrate = rates[bitrateIndex] * 1000;
  return bitrate ? ((buffer.length - offset) * 8) / bitrate : 0;
}

function wavDuration(buffer) {
  if (buffer.length < 44 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') return 0;
  let offset = 12;
  let bytesPerSecond = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    if (type === 'fmt ' && size >= 16 && offset + 16 <= buffer.length) bytesPerSecond = buffer.readUInt32LE(offset + 12);
    if (type === 'data') { dataBytes = size; break; }
    offset += 8 + size + (size % 2);
  }
  return bytesPerSecond && dataBytes ? dataBytes / bytesPerSecond : 0;
}

async function probeAudioDuration(filePath, extension) {
  if (!['.m4a', '.mp3', '.wav'].includes(extension)) return 0;
  const buffer = await fs.promises.readFile(filePath);
  const duration = extension === '.m4a' ? m4aDuration(buffer) : extension === '.mp3' ? mp3Duration(buffer) : wavDuration(buffer);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
}

function createOwnedMusicLibrary({directory, metadataFile} = {}) {
  const root = path.resolve(directory || path.join(__dirname, 'data', 'original-music'));
  const indexFile = path.resolve(metadataFile || path.join(root, 'catalog.json'));
  fs.mkdirSync(root, {recursive:true});
  let state = {version:1, tracks:[]};
  try {
    const loaded = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (loaded?.version === 1 && Array.isArray(loaded.tracks)) state = loaded;
  } catch {}

  function persist() {
    const temporary = `${indexFile}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {mode:0o600});
    fs.renameSync(temporary, indexFile);
  }

  function list() {
    return state.tracks.filter(track => track.status !== 'archived').map(track => ({...audioProfile(track,root), fileName:undefined, checksum:undefined}));
  }

  function get(id) {
    const track=state.tracks.find(track => track.id === id && track.status !== 'archived');
    return track ? audioProfile(track,root) : null;
  }

  function file(id) {
    const track = get(id);
    if (!track) return null;
    const candidate = path.resolve(root, track.fileName);
    if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate)) return null;
    return {track:{...track, fileName:undefined, checksum:undefined}, path:candidate, contentType:AUDIO_TYPES.get(path.extname(candidate).toLowerCase()) || 'application/octet-stream'};
  }

  async function importTrack(req, input = {}) {
    const filename = cleanText(input.filename, 240);
    const extension = path.extname(filename).toLowerCase();
    const expectedType = AUDIO_TYPES.get(extension);
    if (!expectedType) throw new Error('Formato no compatible. Usa MP3, WAV, M4A, AAC, OGG o FLAC.');
    const declaredLengthHeader = req.headers['content-length'];
    const declaredLength = declaredLengthHeader === undefined ? null : Number(declaredLengthHeader);
    if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength <= 0 || declaredLength > MAX_TRACK_BYTES)) {
      throw new Error('Cada pista debe pesar más de 0 bytes y menos de 180 MB');
    }
    const requestedDuration = Math.round(Number(input.duration || 0));
    if (Number.isFinite(requestedDuration) && requestedDuration > MAX_TRACK_SECONDS) throw new Error('La pista supera las cuatro horas permitidas');
    const detected = classifyMusic({filename, relativePath:input.relativePath, title:input.title});
    const family = familyNames[input.family] ? input.family : detected.family;
    const genre = cleanText(input.genre, 60) || familyNames[family] || detected.genre;
    const subgenre = cleanText(input.subgenre, 80) || detected.subgenre;
    const energy = Math.max(1, Math.min(5, Number(input.energy) || detected.energy));
    const id = `original_${crypto.randomUUID().replaceAll('-', '')}`;
    const temporary = path.join(root, `${id}.uploading`);
    const finalName = `${id}${extension}`;
    const finalPath = path.join(root, finalName);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_TRACK_BYTES) throw new Error('La pista supera el límite de 180 MB');
        hash.update(chunk);
        await handle.write(chunk);
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.promises.rm(temporary, {force:true}).catch(() => undefined);
      throw error;
    }
    await handle.close();
    if (bytes <= 0) {
      await fs.promises.rm(temporary, {force:true});
      throw new Error('El archivo de audio llegó vacío');
    }
    if (declaredLength !== null && bytes !== declaredLength) {
      await fs.promises.rm(temporary, {force:true});
      throw new Error('La carga quedó incompleta');
    }
    const duration = requestedDuration > 0 ? requestedDuration : await probeAudioDuration(temporary, extension);
    if (!duration || duration > MAX_TRACK_SECONDS) {
      await fs.promises.rm(temporary, {force:true});
      throw new Error('No se pudo leer la duración del audio. Convierte la pista a MP3, WAV o M4A estándar e inténtalo de nuevo.');
    }
    const checksum = hash.digest('hex');
    const duplicate = state.tracks.find(track => track.checksum === checksum && track.status !== 'archived');
    if (duplicate) {
      await fs.promises.rm(temporary, {force:true});
      return {track:{...duplicate, fileName:undefined, checksum:undefined}, duplicate:true};
    }
    await fs.promises.rename(temporary, finalPath);
    const createdAt = new Date().toISOString();
    const track = {
      id, title:cleanText(input.title, 120) || titleFromFilename(filename), artist:cleanText(input.artist, 100) || 'QSession Original',
      family, genre, subgenre, style:subgenre, energy,
      bpm:Math.max(40, Math.min(220, Number(input.bpm) || detected.bpm)),
      mood:cleanText(input.mood, 24) || detected.mood,
      rhythm:cleanText(input.rhythm, 24) || detected.rhythm,
      duration, order:state.tracks.length + 1,
      sourceType:'qsession-original', sourceLabel:'Original QSession', sourceUrl:'', licenseUrl:'',
      copyright:'Contenido original o autorizado por su titular', rightsSource:'administrator-authorized-upload', aiAssisted:true,
      relativePath:cleanText(input.relativePath, 260), originalFilename:filename, contentType:expectedType,
      byteLength:bytes, checksum, fileName:finalName, status:'active', createdAt,
      classification:{method:detected.confidence, reviewed:false},
    };
    state = {...state, tracks:[...state.tracks, track]};
    persist();
    return {track:{...track, fileName:undefined, checksum:undefined}, duplicate:false};
  }

  function update(id, changes = {}) {
    const index = state.tracks.findIndex(track => track.id === id && track.status !== 'archived');
    if (index < 0) throw new Error('La pista no existe');
    const current = state.tracks[index];
    const family = familyNames[changes.family] ? changes.family : current.family;
    let camelotKey=current.camelotKey||'',beatGrid=current.beatGrid||null;
    if(Object.hasOwn(changes,'camelotKey')){
      camelotKey=String(changes.camelotKey||'').trim().toUpperCase();
      if(camelotKey&&!/^(1[0-2]|[1-9])[AB]$/.test(camelotKey))throw new Error('Tonalidad Camelot no válida');
    }
    if(Object.hasOwn(changes,'beatGrid')){
      const grid=changes.beatGrid;
      if(grid===null)beatGrid=null;
      else{
        if(!grid||grid.verified!==true||!Number.isFinite(grid.bpm)||grid.bpm<40||grid.bpm>220||!Number.isFinite(grid.offset)||grid.offset<0||grid.offset>=current.duration)throw new Error('Rejilla de pulsos no válida');
        if(grid.phraseStart!=null&&(!Number.isFinite(grid.phraseStart)||grid.phraseStart<grid.offset||grid.phraseStart>=current.duration))throw new Error('Inicio de frase no válido');
        beatGrid={bpm:grid.bpm,offset:grid.offset,phraseStart:grid.phraseStart??null,verified:true};
      }
    }else if(changes.bpm&&Number(changes.bpm)!==Number(current.bpm))beatGrid=null;
    const next = {...current,
      title:cleanText(changes.title, 120) || current.title,
      artist:cleanText(changes.artist, 100) || current.artist,
      family,
      genre:cleanText(changes.genre, 60) || familyNames[family] || current.genre,
      subgenre:cleanText(changes.subgenre, 80) || current.subgenre,
      style:cleanText(changes.subgenre, 80) || current.subgenre,
      energy:Math.max(1, Math.min(5, Number(changes.energy) || current.energy)),
      bpm:Math.max(40, Math.min(220, Number(changes.bpm) || current.bpm || 124)),
      camelotKey,beatGrid,
      mood:cleanText(changes.mood, 24) || current.mood || 'focused',
      rhythm:cleanText(changes.rhythm, 24) || current.rhythm || 'drive',
      classification:{method:'manual', reviewed:true}, updatedAt:new Date().toISOString(),
    };
    const tracks = state.tracks.slice(); tracks[index] = next; state = {...state, tracks}; persist();
    return {...next, fileName:undefined, checksum:undefined};
  }

  function remove(id) {
    const index = state.tracks.findIndex(track => track.id === id && track.status !== 'archived');
    if (index < 0) throw new Error('La pista no existe');
    const current = state.tracks[index];
    const source = path.resolve(root, current.fileName);
    if (!source.startsWith(`${root}${path.sep}`)) throw new Error('La ubicación del audio no es válida');
    const trashDirectory = path.join(root, '.trash');
    fs.mkdirSync(trashDirectory, {recursive:true, mode:0o700});
    const extension = path.extname(current.fileName);
    const trashName = `${Date.now()}-${current.id}${extension}`;
    const destination = path.join(trashDirectory, trashName);
    let moved = false;
    if (fs.existsSync(source)) { fs.renameSync(source, destination); moved = true; }
    const archivedAt = new Date().toISOString();
    const archived = {...current, status:'archived', archivedAt, trashName};
    const previousState = state;
    const tracks = state.tracks.slice(); tracks[index] = archived; state = {...state, tracks};
    try { persist(); }
    catch (error) {
      state = previousState;
      if (moved && fs.existsSync(destination)) fs.renameSync(destination, source);
      throw error;
    }
    return {id:current.id, title:current.title, archivedAt, recoverable:true};
  }

  return {list, get, file, has:id=>Boolean(get(id)), importTrack, update, remove, classifyMusic};
}

module.exports = {createOwnedMusicLibrary, classifyMusic, probeAudioDuration, AUDIO_TYPES, MAX_TRACK_BYTES, MAX_TRACK_SECONDS};
