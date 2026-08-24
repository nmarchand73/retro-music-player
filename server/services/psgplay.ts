import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath, PROJECT_ROOT } from '../paths.js';

const CACHE_DIR = dataPath('cache', 'psgplay');
const MIN_USEFUL_WAV_BYTES = 48_000;
/** Soft cap so digi SNDH renders stay interactive (matches UADE). */
const MAX_LENGTH_SEC = 180;
/**
 * ym2149-wasm often fails digi/sample SNDH (e.g. Goldrunner: ~3s of speech then silence).
 * Large post-header banks are a practical proxy for sample-heavy rips (chip-only game
 * tunes like Turrican stay on the fast wasm path).
 */
const DIGI_PAYLOAD_BYTES = 48_000;

let resolvedBinary: string | null | undefined;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function bundledPsgplayCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(PROJECT_ROOT, 'vendor', 'bin', 'psgplay'),
    path.join(PROJECT_ROOT, 'tools', 'psgplay', 'psgplay'),
    // When running from dist-mac bundle Resources/app
    path.join(here, '..', '..', 'vendor', 'bin', 'psgplay'),
  ];
}

export async function resolvePsgplayBinary(): Promise<string | null> {
  if (resolvedBinary !== undefined) return resolvedBinary;

  const override = process.env.PSGPLAY_BIN?.trim();
  if (override) {
    resolvedBinary = (await pathExists(override)) ? override : null;
    return resolvedBinary;
  }

  const candidates = [
    ...bundledPsgplayCandidates(),
    'psgplay',
    '/opt/homebrew/bin/psgplay',
    '/usr/local/bin/psgplay',
  ];

  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (await pathExists(candidate)) {
        resolvedBinary = candidate;
        return resolvedBinary;
      }
      continue;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(candidate, ['--help'], { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 || code === 1 ? resolve() : reject(new Error('fail'))));
      });
      resolvedBinary = candidate;
      return resolvedBinary;
    } catch {
      // try next
    }
  }

  resolvedBinary = null;
  return null;
}

export async function isPsgplayAvailable(): Promise<boolean> {
  return (await resolvePsgplayBinary()) != null;
}

function indexOfTag(buf: Buffer, tag: string, from = 0): number {
  return buf.indexOf(tag, from);
}

/** True when the SNDH likely embeds digi/sample data that ym2149-wasm mishandles. */
export function sndhNeedsPsgplay(fileSize: number, headerBuf: Buffer): boolean {
  const sndhAt = indexOfTag(headerBuf, 'SNDH');
  if (sndhAt < 0) return fileSize >= 32_000;
  const hdnsAt = indexOfTag(headerBuf, 'HDNS', sndhAt);
  if (hdnsAt < 0) return fileSize >= 32_000;
  const payload = Math.max(0, fileSize - (hdnsAt + 4));
  return payload >= DIGI_PAYLOAD_BYTES;
}

export async function shouldUsePsgplayForSndh(absolutePath: string): Promise<boolean> {
  if (!(await isPsgplayAvailable())) return false;
  const stat = await fs.stat(absolutePath);
  const fh = await fs.open(absolutePath, 'r');
  try {
    const headerBuf = Buffer.alloc(Math.min(stat.size, 16_384));
    const { bytesRead } = await fh.read(headerBuf, 0, headerBuf.length, 0);
    return sndhNeedsPsgplay(stat.size, headerBuf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

function cacheKey(absolutePath: string, mtimeMs: number, size: number, subsong: number): string {
  return createHash('sha1')
    .update(`${absolutePath}\0${mtimeMs}\0${size}\0${subsong}\0${MAX_LENGTH_SEC}`)
    .digest('hex');
}

async function runPsgplay(
  bin: string,
  inputPath: string,
  outputPath: string,
  subsong: number,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const args = [
    '-o',
    outputPath,
    '--stop=auto',
    `--length=${MAX_LENGTH_SEC}`,
    '-t',
    String(subsong),
    '-f',
    '44100',
    '-m',
    'command',
    inputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8_000) stderr = stderr.slice(-4_000);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psgplay exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

/**
 * Render a digi/sample SNDH to a cached WAV via psgplay (same engine family as sndh.atari.org).
 */
export async function renderSndhWithPsgplay(
  absolutePath: string,
  subsong = 1,
): Promise<string> {
  const bin = await resolvePsgplayBinary();
  if (!bin) throw new Error('psgplay is not available (vendor/bin/psgplay)');

  const track = Math.max(1, Math.round(subsong));
  const resolved = path.resolve(absolutePath);
  const stat = await fs.stat(resolved);
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const key = cacheKey(resolved, stat.mtimeMs, stat.size, track);
  const outPath = path.join(CACHE_DIR, `${key}.wav`);
  if (await pathExists(outPath)) {
    const cached = await fs.stat(outPath);
    if (cached.size >= MIN_USEFUL_WAV_BYTES) return outPath;
  }

  const tmpPath = `${outPath}.partial`;
  await fs.rm(tmpPath, { force: true });
  await runPsgplay(bin, resolved, tmpPath, track);
  const rendered = await fs.stat(tmpPath);
  if (rendered.size < MIN_USEFUL_WAV_BYTES) {
    await fs.rm(tmpPath, { force: true });
    throw new Error(`psgplay produced a near-empty WAV for subsong ${track}`);
  }
  await fs.rename(tmpPath, outPath);
  return outPath;
}
