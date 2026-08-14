/**
 * Offline check: chip/sample clocks advance at real-time for each engine path.
 * Run: node scripts/verify-playback-speed.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import init, { Ym2149Player } from 'ym2149-wasm';
import { SidAudioEngine } from 'libsidplayfp-wasm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const YM_SR = 44100;
const TOLERANCE = 0.08;

const wasmBytes = fs.readFileSync(path.join(root, 'node_modules/ym2149-wasm/ym2149_wasm_bg.wasm'));
await init({ module_or_path: wasmBytes });

function findFile(dir, exts, maxDepth = 6) {
  if (!fs.existsSync(dir)) return null;
  const stack = [[dir, 0]];
  while (stack.length) {
    const [d, depth] = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < maxDepth && !e.name.startsWith('.')) stack.push([p, depth + 1]);
      else if (e.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x))) return p;
    }
  }
  return null;
}

function measureYm(filePath, seconds = 2) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const player = new Ym2149Player(data);
  player.play();
  const rate = player.metadata.frame_rate || 50;
  const wantSamples = Math.round(seconds * YM_SR);
  const framesExpected = Math.round(seconds * rate);
  let generated = 0;
  const regSnaps = new Set();
  while (generated < wantSamples) {
    const n = Math.min(882, wantSamples - generated);
    player.generateSamples(n);
    generated += n;
    if (generated % (882 * 10) < 882) {
      regSnaps.add([...player.get_registers()].slice(0, 6).join(','));
    }
  }
  const frames = player.frame_position();
  const format = String(player.metadata.format || '');
  const isSndh = /sndh/i.test(format);
  const chipSeconds = frames / rate;
  const result = {
    file: path.relative(root, filePath),
    format,
    frameRateHz: rate,
    requestedSec: seconds,
    chipSeconds,
    sampleSeconds: generated / YM_SR,
    chipRatio: isSndh ? null : chipSeconds / seconds,
    sampleRatio: generated / YM_SR / seconds,
    regsChanged: regSnaps.size > 1,
    framesReported: frames,
    framesExpected,
  };
  player.free();
  return result;
}

function simulateResample(ctxRate, bufferFrames = 2048, seconds = 2) {
  let wallFrames = 0;
  let ymSamples = 0;
  const targetWall = Math.round(seconds * ctxRate);
  while (wallFrames < targetWall) {
    const leftLen = Math.min(bufferFrames, targetWall - wallFrames);
    const want = Math.max(1, Math.round((leftLen * YM_SR) / ctxRate));
    ymSamples += want;
    wallFrames += leftLen;
  }
  const wallSec = wallFrames / ctxRate;
  const ymSec = ymSamples / YM_SR;
  return { ctxRate, wallSec, ymSec, ratio: ymSec / wallSec };
}

async function measureSid(sampleRate, seconds = 1) {
  const sidPath = path.join(root, 'node_modules/libsidplayfp-wasm/fixtures/test-tone-c4.sid');
  const engine = new SidAudioEngine({
    sampleRate,
    engine: 'sidlite',
    stereo: true,
    locateFile: (file) =>
      path.join(root, 'node_modules/libsidplayfp-wasm/dist/sidlite', path.basename(file)),
  });
  await engine.loadSidBuffer(new Uint8Array(fs.readFileSync(sidPath)));
  let frames = 0;
  const target = sampleRate * seconds;
  while (frames < target) {
    const chunk = engine.renderCycles(100_000);
    if (!chunk || chunk.length === 0) break;
    frames += chunk.length / 2;
  }
  const timeSec = engine.getTimeMs() / 1000;
  engine.dispose();
  return {
    sampleRate,
    frames,
    timeSec,
    ratio: timeSec / seconds,
  };
}

const results = [];
const jaws = path.join(root, 'data/sndh/sndh_lf/Whittaker_David/Jaws.sndh');
const ym = findFile(path.join(root, 'data/cpc'), ['.ym']);
if (fs.existsSync(jaws)) results.push({ engine: 'ym2149/SNDH', ...measureYm(jaws) });
if (ym) results.push({ engine: 'ym2149/YM', ...measureYm(ym) });

const resample = [44100, 48000, 96000].map((r) => simulateResample(r));
const sidResults = [];
for (const rate of [44100, 48000]) {
  sidResults.push(await measureSid(rate));
}

console.log('=== YM/SNDH ===');
console.log(JSON.stringify(results, null, 2));
console.log('\n=== Resample mapping ===');
console.log(JSON.stringify(resample, null, 2));
console.log('\n=== SID ===');
console.log(JSON.stringify(sidResults, null, 2));

let failed = 0;
for (const r of results) {
  const sampleOk = Math.abs(r.sampleRatio - 1) < 0.001;
  const chipOk = r.chipRatio == null ? r.regsChanged : Math.abs(r.chipRatio - 1) < TOLERANCE;
  const ok = sampleOk && chipOk;
  console.log(
    `${ok ? 'OK' : 'FAIL'} ${r.engine}: sampleRatio=${r.sampleRatio.toFixed(4)} chipRatio=${r.chipRatio ?? 'n/a(SNDH regs)'} regsChanged=${r.regsChanged}`,
  );
  if (!ok) failed += 1;
}
for (const r of resample) {
  const ok = Math.abs(r.ratio - 1) < 0.002;
  console.log(`${ok ? 'OK' : 'FAIL'} resample@${r.ctxRate}: ym/wall=${r.ratio.toFixed(6)}`);
  if (!ok) failed += 1;
}
for (const r of sidResults) {
  const ok = Math.abs(r.ratio - 1) < TOLERANCE;
  console.log(`${ok ? 'OK' : 'FAIL'} sid@${r.sampleRate}: time/wall=${r.ratio.toFixed(4)}`);
  if (!ok) failed += 1;
}

const worklet = fs.readFileSync(path.join(root, 'public/chiptune3.worklet.js'), 'utf8');
const openmptOk = /_openmpt_module_read_float_stereo\(\s*this\.modulePtr,\s*sampleRate/.test(worklet);
console.log(`${openmptOk ? 'OK' : 'FAIL'} openmpt worklet uses AudioWorklet sampleRate`);
if (!openmptOk) failed += 1;

const uade = fs.readFileSync(path.join(root, 'server/services/uade.ts'), 'utf8');
const uadeOk = uade.includes("'--frequency=44100'");
console.log(`${uadeOk ? 'OK' : 'FAIL'} uade renders at 44100 Hz`);
if (!uadeOk) failed += 1;

const sidSrc = fs.readFileSync(path.join(root, 'src/lib/sidPlayer.ts'), 'utf8');
const sidOk = /sampleRate:\s*ctx\.sampleRate/.test(sidSrc);
console.log(`${sidOk ? 'OK' : 'FAIL'} sid engine sampleRate = AudioContext.sampleRate`);
if (!sidOk) failed += 1;

const player = fs.readFileSync(path.join(root, 'src/hooks/useMusicPlayer.ts'), 'utf8');
const ymResampleOk =
  /left\.length \* YM_SAMPLE_RATE\) \/ outputRate/.test(player) ||
  /\(left\.length \* YM_SAMPLE_RATE\) \/ outputRate/.test(player);
const wavOk = !/playbackRate\s*=/.test(player);
console.log(`${ymResampleOk ? 'OK' : 'FAIL'} YM path resamples 44100 → AudioContext rate`);
console.log(`${wavOk ? 'OK' : 'FAIL'} no playbackRate override`);
if (!ymResampleOk) failed += 1;
if (!wavOk) failed += 1;

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll playback-speed checks passed');
