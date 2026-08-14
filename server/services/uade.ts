import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOpenmptFormat } from '../../src/utils/amigaPlayable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'cache', 'uade');

/** Soft cap so renders finish in reasonable time for interactive play. */
const SUBSONG_TIMEOUT_SEC = 180;
const SILENCE_TIMEOUT_SEC = 8;
const MIN_USEFUL_WAV_BYTES = 48_000;

let resolvedBinary: string | null | undefined;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveUadeBinary(): Promise<string | null> {
  if (resolvedBinary !== undefined) return resolvedBinary;

  const override = process.env.UADE_BIN?.trim();
  if (override) {
    resolvedBinary = (await pathExists(override)) ? override : null;
    return resolvedBinary;
  }

  const candidates = [
    'uade123',
    '/opt/homebrew/bin/uade123',
    '/usr/local/bin/uade123',
    '/usr/bin/uade123',
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

export async function isUadeAvailable(): Promise<boolean> {
  return (await resolveUadeBinary()) != null;
}

export function shouldUseUade(format: string): boolean {
  return !isOpenmptFormat(format);
}

function cacheKey(absolutePath: string, mtimeMs: number, size: number, subsong: number): string {
  return createHash('sha1')
    .update(`${absolutePath}\0${mtimeMs}\0${size}\0${subsong}\0${SUBSONG_TIMEOUT_SEC}`)
    .digest('hex');
}

async function runUade(bin: string, inputPath: string, outputPath: string, subsong: number): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const args = [
    '-f',
    outputPath,
    '-e',
    'wav',
    '--one',
    '--frequency=44100',
    '--filter=A500',
    `-w${SUBSONG_TIMEOUT_SEC}`,
    `-y${SILENCE_TIMEOUT_SEC}`,
    `-s${subsong}`,
    inputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: path.dirname(inputPath),
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
      else reject(new Error(`uade123 exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

/**
 * Render an exotic Amiga module to a cached WAV via UADE.
 * Tries the default/first useful subsong when subsong 0 is empty.
 */
export async function renderAmigaWithUade(absolutePath: string): Promise<string> {
  const bin = await resolveUadeBinary();
  if (!bin) throw new Error('UADE is not installed (brew install uade)');

  const stat = await fs.stat(absolutePath);
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const trySubsongs = [0, 1, 2];
  let lastError: Error | null = null;

  for (const subsong of trySubsongs) {
    const key = cacheKey(absolutePath, stat.mtimeMs, stat.size, subsong);
    const outPath = path.join(CACHE_DIR, `${key}.wav`);
    if (await pathExists(outPath)) {
      const cached = await fs.stat(outPath);
      if (cached.size >= MIN_USEFUL_WAV_BYTES) return outPath;
    }

    try {
      const tmpPath = `${outPath}.partial`;
      await fs.rm(tmpPath, { force: true });
      await runUade(bin, absolutePath, tmpPath, subsong);
      const rendered = await fs.stat(tmpPath);
      if (rendered.size < MIN_USEFUL_WAV_BYTES) {
        await fs.rm(tmpPath, { force: true });
        lastError = new Error(`UADE produced a near-empty WAV for subsong ${subsong}`);
        continue;
      }
      await fs.rename(tmpPath, outPath);
      return outPath;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('UADE render failed');
}
