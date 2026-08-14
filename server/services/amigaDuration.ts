import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CACHE_PATH = path.join(PROJECT_ROOT, 'data', 'cache', 'amiga-durations.json');

const MOD_TAGS = new Set([
  'M.K.',
  'M!K!',
  'FLT4',
  'FLT8',
  '4CHN',
  '6CHN',
  '8CHN',
  'CD81',
  'OKTA',
  '2CHN',
  'TDZ4',
  'TDZ3',
  'TDZ2',
]);

type DurationCache = Record<string, number>;

let cache: DurationCache | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function loadCache(): Promise<DurationCache> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as DurationCache;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(next: DurationCache): void {
  cache = next;
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    const tmp = `${CACHE_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next));
    await fs.rename(tmp, CACHE_PATH);
  });
}

export async function getCachedAmigaDuration(id: string): Promise<number | undefined> {
  const data = await loadCache();
  const value = data[id];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function rememberAmigaDuration(id: string, seconds: number): Promise<number | undefined> {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const rounded = Math.round(seconds * 10) / 10;
  const data = await loadCache();
  const previous = data[id];
  if (previous != null && Math.abs(previous - rounded) < 0.15) return previous;
  persist({ ...data, [id]: rounded });
  return rounded;
}

/** Read PCM WAV duration from a UADE (or other) render. */
export async function wavDurationSeconds(filePath: string): Promise<number | undefined> {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    await handle.read(header, 0, 12, 0);
    if (header.subarray(0, 4).toString('ascii') !== 'RIFF' || header.subarray(8, 12).toString('ascii') !== 'WAVE') {
      return undefined;
    }

    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataBytes = 0;
    const chunkHeader = Buffer.alloc(8);

    for (let guard = 0; guard < 32; guard += 1) {
      const { bytesRead } = await handle.read(chunkHeader, 0, 8, offset);
      if (bytesRead < 8) break;
      const id = chunkHeader.subarray(0, 4).toString('ascii');
      const size = chunkHeader.readUInt32LE(4);
      const payload = offset + 8;

      if (id === 'fmt ' && size >= 16) {
        const fmt = Buffer.alloc(16);
        await handle.read(fmt, 0, 16, payload);
        channels = fmt.readUInt16LE(2);
        sampleRate = fmt.readUInt32LE(4);
        bitsPerSample = fmt.readUInt16LE(14);
      } else if (id === 'data') {
        dataBytes = size;
        break;
      }

      offset = payload + size + (size & 1);
    }

    if (!channels || !sampleRate || !bitsPerSample || !dataBytes) return undefined;
    const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
    if (bytesPerSecond <= 0) return undefined;
    return dataBytes / bytesPerSecond;
  } finally {
    await handle.close();
  }
}

/**
 * Rough ProTracker-family song length (ignores mid-song speed/tempo changes).
 * Good enough for library list labels.
 */
export function estimateModDurationSeconds(buf: Uint8Array): number | undefined {
  if (buf.length < 1084) return undefined;
  const tag = String.fromCharCode(buf[1080]!, buf[1081]!, buf[1082]!, buf[1083]!);
  if (!MOD_TAGS.has(tag)) return undefined;

  const songLen = buf[950] ?? 0;
  if (songLen < 1 || songLen > 128) return undefined;

  // Defaults used when a module never sets Fxx.
  const speed = 6;
  const tempo = 125;
  const rows = songLen * 64;
  const seconds = (rows * speed * 2.5) / tempo;
  return seconds > 0.5 ? Math.round(seconds * 10) / 10 : undefined;
}
