#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = __dirname;
const partNames = fs.readdirSync(root)
  .filter((name) => /^tg-bundle-\\d{3}\\.b64$/.test(name))
  .sort();

if (partNames.length === 0) {
  console.error('Tom&Grace source bundle is missing (tg-bundle-001.b64, etc.).');
  process.exit(1);
}

const encoded = partNames.map((name) =>
  fs.readFileSync(path.join(root, name), 'utf8').trim()
).join('');

const zipPath = path.join(root, '.tg-source.zip');
const extractPath = path.join(root, '.tg-source');
fs.writeFileSync(zipPath, Buffer.from(encoded, 'base64'));
fs.rmSync(extractPath, { recursive: true, force: true });
fs.mkdirSync(extractPath, { recursive: true });

try {
  execFileSync('unzip', ['-oq', zipPath, '-d', extractPath], { stdio: 'inherit' });
  const appPath = path.join(extractPath, 'tom-and-grace');
  if (!fs.existsSync(path.join(appPath, 'server.js'))) {
    throw new Error('The source archive did not contain tom-and-grace/server.js');
  }

  for (const entry of fs.readdirSync(appPath)) {
    fs.cpSync(path.join(appPath, entry), path.join(root, entry), {
      recursive: true,
      force: true
    });
  }
  console.log('Tom&Grace source files prepared successfully.');
} catch (error) {
  console.error('Could not unpack the Tom&Grace source bundle:', error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(extractPath, { recursive: true, force: true });
}
