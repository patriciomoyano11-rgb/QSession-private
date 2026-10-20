import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {geoEquirectangular, geoPath} from 'd3-geo';
import {feature} from 'topojson-client';

const require = createRequire(import.meta.url);
const topology = require('world-atlas/countries-110m.json');
const countryCatalog = require('world-countries');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputFile = path.join(__dirname, '..', 'public', 'data', 'world-countries.js');
const mobileOutputFile = path.join(__dirname, '..', '..', 'mobile', 'src', 'generated', 'world-countries.json');

const specialCodes = new Map([
  ['Kosovo', 'XK'],
  ['N. Cyprus', 'XC'],
  ['Somaliland', 'XS'],
]);
const catalogByNumericCode = new Map(countryCatalog.map(country => [country.ccn3, country]));
const projection = geoEquirectangular()
  .scale(1000 / (2 * Math.PI))
  .translate([500, 250]);
const renderPath = geoPath(projection).digits(0);
const countryFeatures = feature(topology, topology.objects.countries).features;

function localizedNames(country, fallback) {
  return {
    es: country?.translations?.spa?.common || country?.name?.common || fallback,
    en: country?.name?.common || fallback,
    de: country?.translations?.deu?.common || country?.name?.common || fallback,
  };
}

const countries = [...new Map(countryFeatures.map(country => {
  const numericCode = country.id ? String(country.id).padStart(3, '0') : '';
  const specialCode = specialCodes.get(country.properties?.name);
  const catalogEntry = specialCode ? countryCatalog.find(item => item.cca2 === specialCode) : catalogByNumericCode.get(numericCode);
  const code = specialCode || catalogEntry?.cca2 || '';
  const renderedPath = renderPath(country);
  const [x, y] = renderPath.centroid(country);
  const [[minimumX, minimumY], [maximumX, maximumY]] = renderPath.bounds(country);
  return {
    code,
    names: localizedNames(catalogEntry, country.properties?.name || code),
    path: renderedPath,
    x: Number(x.toFixed(1)),
    y: Number(y.toFixed(1)),
    bounds: [
      Number(minimumX.toFixed(1)),
      Number(minimumY.toFixed(1)),
      Number(maximumX.toFixed(1)),
      Number(maximumY.toFixed(1)),
    ],
  };
}).filter(country => country.code && country.path).map(country => [country.code, country])).values()];

const polygonCodes = new Set(countries.map(country => country.code));
const microstates = countryCatalog
  .filter(country => country.cca2 && !polygonCodes.has(country.cca2) && Array.isArray(country.latlng) && country.latlng.length === 2)
  .map(country => ({
    code: country.cca2,
    names: localizedNames(country, country.cca2),
    x: Number((((country.latlng[1] + 180) / 360) * 1000).toFixed(1)),
    y: Number((((90 - country.latlng[0]) / 180) * 500).toFixed(1)),
  }))
  .sort((left, right) => left.code.localeCompare(right.code));

const payload = {countries, microstates};
const output = `/* Q Session political world map. Country geometry: Natural Earth via world-atlas (public domain). */\nwindow.QSESSION_WORLD_COUNTRIES=${JSON.stringify(payload)};\n`;
fs.mkdirSync(path.dirname(outputFile), {recursive: true});
fs.writeFileSync(outputFile, output);
fs.mkdirSync(path.dirname(mobileOutputFile), {recursive: true});
fs.writeFileSync(mobileOutputFile, `${JSON.stringify(payload)}\n`);
console.log(`Generated ${countries.length} country shapes and ${microstates.length} microstate markers.`);
