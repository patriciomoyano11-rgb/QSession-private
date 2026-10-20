'use strict';

const path = require('node:path');
const {spawnSync} = require('node:child_process');

const script = path.join(__dirname, 'generate-brand-assets.ps1');
const result = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', script,
], {stdio: 'inherit'});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
