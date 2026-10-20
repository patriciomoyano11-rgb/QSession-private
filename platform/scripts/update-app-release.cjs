'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const platformRoot = path.resolve(__dirname, '..');
const downloadsRoot = path.join(platformRoot, 'public', 'downloads');
const catalogPath = path.join(platformRoot, 'public', 'app-releases.json');
const dockerignorePath = path.join(platformRoot, '.dockerignore');
const [target, version, sourceArgument] = process.argv.slice(2);

function compareVersions(left, right) {
  const parts = value => String(value).split(/[+-]/, 1)[0].split('.').map(part => Number(part) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

if (!['android', 'windows'].includes(target)) throw new Error('Plataforma inválida: usa android o windows.');
if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version || '')) throw new Error('La versión debe usar formato semántico, por ejemplo 0.1.43.');
if (!sourceArgument) throw new Error('Indica el instalador que debe publicarse.');

const sourcePath = path.resolve(sourceArgument);
if (!fs.statSync(sourcePath).isFile()) throw new Error(`No existe el instalador: ${sourcePath}`);
const expectedExtension = target === 'android' ? '.apk' : '.exe';
if (path.extname(sourcePath).toLowerCase() !== expectedExtension) throw new Error(`El instalador de ${target} debe terminar en ${expectedExtension}.`);

const artifact = target === 'android'
  ? `QSession-Android-${version}.apk`
  : 'Instalar-QSession-Windows.exe';
const filename = artifact;
const url = target === 'android'
  ? '/downloads/QSession-Android-latest.apk'
  : '/downloads/QSession-Windows-latest.exe';
const destinationPath = path.join(downloadsRoot, artifact);

let catalog = {};
try { catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); } catch {}
if (catalog[target]?.version && compareVersions(version, catalog[target].version) < 0) {
  throw new Error(`No se puede reemplazar ${catalog[target].version} por la versión anterior ${version}.`);
}
const otherPlatform = target === 'android' ? 'windows' : 'android';
if (!catalog[otherPlatform]) throw new Error(`El catálogo necesita primero una versión válida de ${otherPlatform}.`);
const sourceBytes = fs.readFileSync(sourcePath);
const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
if (catalog[target]?.version === version && catalog[target]?.sha256 && catalog[target].sha256 !== sourceSha256) {
  throw new Error(`El binario cambió, pero la versión continúa en ${version}. Incrementa la versión antes de publicarlo.`);
}

fs.mkdirSync(downloadsRoot, {recursive: true});
if (path.normalize(sourcePath).toLowerCase() !== path.normalize(destinationPath).toLowerCase()) {
  const temporaryPath = `${destinationPath}.tmp`;
  fs.copyFileSync(sourcePath, temporaryPath);
  fs.renameSync(temporaryPath, destinationPath);
}

const release = {
  version,
  url,
  filename,
  artifact,
  byteLength: sourceBytes.length,
  sha256: sourceSha256,
};

catalog[target] = release;

const temporaryCatalog = `${catalogPath}.tmp`;
fs.writeFileSync(temporaryCatalog, `${JSON.stringify(catalog, null, 2)}\n`);
fs.renameSync(temporaryCatalog, catalogPath);

if (target === 'android') {
  const source = fs.readFileSync(dockerignorePath, 'utf8');
  const lines = source.split(/\r?\n/).filter(line => !/^!public\/downloads\/QSession-Android-[^/]+\.apk$/.test(line));
  const insertion = lines.indexOf('!public/downloads/.gitkeep') + 1;
  lines.splice(insertion > 0 ? insertion : lines.length, 0, `!public/downloads/${artifact}`);
  fs.writeFileSync(dockerignorePath, `${lines.filter((line, index, all) => index < all.length - 1 || line).join('\n')}\n`);
}

process.stdout.write(`${target} ${version} listo: ${artifact}\n`);
