#!/usr/bin/env node
/** Download libvgm-js WASM playback assets into public/vgmplay/ */

import { mkdirSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'public', 'vgmplay');
const BASE = 'https://niekvlessert.github.io/libvgm-js';

const FILES = [
  'vgmplay-js.js',
  'vgmplay-js.wasm',
  'vgmplay-js.data',
  'vgmplay-audio-processor.js',
  'minizip-asm.min.js',
];

const GLUE_URL =
  'https://raw.githubusercontent.com/niekvlessert/libvgm-js/main/vgmplay-js-glue-library.js';

async function download(url, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(destPath));
}

async function main() {
  mkdirSync(DEST, { recursive: true });
  for (const file of FILES) {
    const dest = join(DEST, file);
    console.log(`fetch ${file}`);
    await download(`${BASE}/${file}`, dest);
  }
  console.log('Note: keep public/vgmplay/vgmplay-bridge.js (patched glue) in the repo.');
  console.log(`Done — assets in ${DEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
