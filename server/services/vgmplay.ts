import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath, PROJECT_ROOT } from '../paths.js';
import { decompressVgmIfNeeded } from '../utils/vgmTags.js';

const CACHE_DIR = dataPath('cache', 'vgmplay');
const MIN_USEFUL_WAV_BYTES = 32_000;
const MAX_LENGTH_SEC = 600;

let resolvedBinary: string | null | undefined;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function bundledVgmplayCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(PROJECT_ROOT, 'vendor', 'bin', 'vgmplay'),
    path.join(here, '..', '..', 'vendor', 'bin', 'vgmplay'),
  ];
}

export async function resolveVgmplayBinary(): Promise<string | null> {
  if (resolvedBinary !== undefined) return resolvedBinary;

  const override = process.env.VGMPLAY_BIN?.trim();
  if (override) {
    resolvedBinary = (await pathExists(override)) ? override : null;
    return resolvedBinary;
  }

  const candidates = [
    ...bundledVgmplayCandidates(),
    'vgmplay',
    '/opt/homebrew/bin/vgmplay',
    '/usr/local/bin/vgmplay',
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
        const child = spawn(candidate, ['-h'], { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', () => resolve());
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

export async function isVgmplayAvailable(): Promise<boolean> {
  return (await resolveVgmplayBinary()) != null;
}

function cacheKey(inputPath: string): string {
  return createHash('sha256').update(inputPath).digest('hex').slice(0, 24);
}

async function ensureDecompressedVgm(inputPath: string): Promise<string> {
  if (!inputPath.toLowerCase().endsWith('.vgz')) return inputPath;
  const data = await fs.readFile(inputPath);
  const { body } = decompressVgmIfNeeded(data);
  const dest = path.join(CACHE_DIR, `${cacheKey(inputPath)}.vgm`);
  if (!(await pathExists(dest))) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(dest, body);
  }
  return dest;
}

export async function renderVgmWithVgmplay(inputPath: string): Promise<string> {
  const binary = await resolveVgmplayBinary();
  if (!binary) {
    throw new Error('vgmplay not found — set VGMPLAY_BIN or install libvgm VGMPlay');
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  const source = await ensureDecompressedVgm(inputPath);
  const outPath = path.join(CACHE_DIR, `${cacheKey(source)}.wav`);

  if (await pathExists(outPath)) {
    const stat = await fs.stat(outPath);
    if (stat.size >= MIN_USEFUL_WAV_BYTES) return outPath;
  }

  await new Promise<void>((resolve, reject) => {
    const args = ['-o', outPath, '-l', String(MAX_LENGTH_SEC), source];
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `vgmplay exited ${code ?? '?'}`));
    });
  });

  const stat = await fs.stat(outPath);
  if (stat.size < MIN_USEFUL_WAV_BYTES) {
    throw new Error('vgmplay produced an empty WAV');
  }
  return outPath;
}
