import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAllTokens, matchesNormalizedGame, normalizeGameKey, searchTokens } from '../searchQuery.js';
import type { SearchField, Track } from '../types.js';
import { isAmigaFormatPlayable } from '../../src/utils/amigaPlayable.js';
import {
  estimateModDurationSeconds,
  getCachedAmigaDuration,
  rememberAmigaDuration,
} from './amigaDuration.js';
import { isUadeAvailable } from './uade.js';

const SEARCH_LIMIT = 80;
const EMPTY_SEARCH_LIMIT = 24;
const UNEXOTICA_URL = 'https://www.exotica.org.uk/wiki/UnExoticA';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const ARCHIVE_EXT = new Set(['.lha', '.lzh', '.lzx', '.zip', '.rar', '.gz', '.7z']);
const SKIP_EXT = new Set([
  '.asm',
  '.s',
  '.c',
  '.h',
  '.sh',
  '.txt',
  '.md',
  '.html',
  '.json',
  '.nfo',
  '.diz',
  '.png',
  '.jpg',
  '.gif',
  '.pdf',
  '.instr',
  '.ins',
  '.ss',
  '.iff',
  '.wav',
  '.aiff',
]);
const SAMPLE_PREFIX = new Set([
  'smp',
  'smpl',
  'sample',
  'samples',
  '8svx',
  'instr',
  'ins',
  'bassdrum',
  'snaredrum',
  'tomdrum',
  'hihat',
  'openhat',
  'crash',
  'ride',
  'organ',
  'horn',
]);
const MODULE_EXT = new Set([
  '.mod',
  '.xm',
  '.it',
  '.s3m',
  '.med',
  '.okt',
  '.dbm',
  '.mtm',
  '.stm',
  '.669',
  '.ptm',
  '.ult',
  '.far',
  '.amf',
  '.dsm',
  '.mo3',
  '.mptm',
  '.digi',
]);
const MODULE_PREFIX = new Set([
  'mod',
  'med',
  'mmd',
  'mmd0',
  'mmd1',
  'mmd2',
  'mmd3',
  'mmdc',
  'xm',
  'it',
  's3m',
  'okt',
  'dbm',
  'digi',
  'dtm',
  'mtm',
  'stm',
  'ptm',
  'ult',
  'far',
  'amf',
  'mo3',
  'p31',
  'p40',
  'p41',
  'p4x',
  'p5x',
  'p60',
  'p61',
  'p81',
  'np',
  'np1',
  'np2',
  'np3',
  'pp',
  'pp10',
  'pp20',
  'pp21',
  'pp30',
  'pm',
  'pm01',
  'pm10',
  'pm20',
  'fc',
  'fc13',
  'fc14',
  'fc3',
  'fc4',
  'sfx',
  'sfx13',
  'sfx20',
  'bp',
  'bp3',
  'gmc',
  'ntp',
  'pru',
  'pru1',
  'pru2',
  'hip',
  'hipc',
  'soc',
  'sog',
  'sa',
  'smus',
  'mdat',
  'rjp',
  'pha',
  'cust',
  'dw',
  'tiny',
  'osp',
  'alp',
  'sct',
  'ps',
  'dln',
  'dl',
  'bd',
  'bye',
  'rk',
  'jd',
  'mug',
  'sjs',
  'mok',
  'cm',
  'sid',
  'sid1',
  'sid2',
  'thm',
  'mw',
  'sb',
  'snx',
  'aam',
  'agi',
  'mxtx',
  'us',
  'wb',
]);
const GENERIC_TITLE = /^(ingame|title|intro|loader|music|song|tune|hiscore|gameover|welldone|credits|end|jingle|sfx)([_-]?\d+)?$/i;
const TRACKER_PREFIX = /^[a-z]{1,4}\d{0,2}$/;

export interface AmigaRecord {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  artist: string;
  folderArtist: string;
  format: string;
  game?: string;
  notes?: string;
  sizeBytes: number;
  durationSeconds?: number;
  timestamp?: string;
  coverPath?: string;
}

let records: AmigaRecord[] | null = null;
let building: Promise<AmigaRecord[]> | null = null;
let stale = true;
let watching = false;

function archiveRoot(): string {
  const override = process.env.AMIGA_ARCHIVE_DIR?.trim();
  if (override) {
    return path.resolve(PROJECT_ROOT, override);
  }
  return path.join(PROJECT_ROOT, 'data', 'amiga');
}

function pathToId(relativePath: string): string {
  return Buffer.from(relativePath).toString('base64url');
}

function prettyName(value: string): string {
  return expandUnexoticaName(value.replaceAll('_', ' ').replaceAll(/\s+/g, ' ').trim());
}

/** Expand UnExoticA path abbreviations so Top Games titles match indexed `game`. */
function expandUnexoticaName(value: string): string {
  return value
    .replace(/\bo t\b/gi, 'of the')
    .replace(/\bf t\b/gi, 'from the')
    .replace(/\bw t\b/gi, 'with the')
    .replace(/\ba t\b/gi, 'and the')
    .replace(/\bi t\b/gi, 'in the')
    .replace(/\bb t\b/gi, 'by the')
    .replace(/\bMiss\b/g, 'Mission')
    .replace(/\bHot-Shot\b/gi, 'Hot Shot')
    .replace(/\s+/g, ' ')
    .trim();
}

function watchArchive(): void {
  if (watching) return;
  watching = true;
  const root = archiveRoot();
  try {
    const watcher = watch(root, { recursive: true }, () => {
      stale = true;
    });
    watcher.on('error', () => {
      stale = true;
    });
  } catch {
    watching = false;
  }
}

function classifyFile(filename: string): { format: string; title: string } | null {
  if (filename.startsWith('.')) return null;
  const ext = path.extname(filename).toLowerCase();
  if (ARCHIVE_EXT.has(ext) || SKIP_EXT.has(ext)) return null;

  const dot = filename.indexOf('.');
  const prefix = (dot > 0 ? filename.slice(0, dot) : '').toLowerCase();
  const rest = dot > 0 ? filename.slice(dot + 1) : filename;

  if (SAMPLE_PREFIX.has(prefix)) return null;

  if (MODULE_EXT.has(ext)) {
    const stem = path.parse(filename).name;
    const format = ext.slice(1).toUpperCase();
    return { format, title: prettyName(stem) || filename };
  }

  if (prefix && (MODULE_PREFIX.has(prefix) || TRACKER_PREFIX.test(prefix))) {
    return { format: prefix.toUpperCase(), title: prettyName(rest) || prettyName(filename) };
  }

  return null;
}

function metadataFromPath(relativePath: string, parsed: { format: string; title: string }): {
  artist: string;
  folderArtist: string;
  game?: string;
  title: string;
  notes?: string;
} {
  const parts = relativePath.split('/').filter(Boolean);
  const fileIndex = parts.length - 1;
  let artist = 'Unknown';
  let game: string | undefined;
  const notesParts: string[] = [];

  if (parts[0] === 'unexotica') {
    notesParts.push('UnExoticA');
    const category = parts[1];
    if (category) notesParts.push(prettyName(category));
    if (parts[2]) artist = prettyName(parts[2]);
    if (parts[3]) game = prettyName(parts[3]);
  } else if (fileIndex >= 1) {
    artist = prettyName(parts[fileIndex - 1] ?? 'Unknown');
    if (fileIndex >= 2) game = prettyName(parts[fileIndex - 2]);
  }

  let title = parsed.title;
  if (game && GENERIC_TITLE.test(title)) {
    title = `${game} (${title})`;
  }

  return {
    artist,
    folderArtist: artist,
    game,
    title,
    notes: notesParts.join(' · ') || undefined,
  };
}

function toTrack(record: AmigaRecord): Track {
  return {
    id: record.id,
    source: 'amiga',
    platform: 'amiga',
    title: record.title,
    artist: record.artist,
    format: record.format,
    sizeBytes: record.sizeBytes,
    durationSeconds: record.durationSeconds,
    game: record.game,
    notes: record.notes,
    timestamp: record.timestamp,
    streamUrl: `/api/stream/amiga/${record.id}`,
    coverUrl: record.coverPath ? `/api/cover/amiga/${record.id}` : undefined,
    detailUrl: UNEXOTICA_URL,
  };
}

async function listCandidateFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/source$/i.test(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }

  await walk(root);
  return files;
}

async function fileIfPresent(candidate: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile() && stat.size > 32) return candidate;
  } catch {
    return undefined;
  }
  return undefined;
}

async function findCoverPath(root: string, relativePath: string, absolutePath: string): Promise<string | undefined> {
  const moduleDir = path.dirname(absolutePath);
  const parts = relativePath.split('/').filter(Boolean);
  const gameFolder = parts[0] === 'unexotica' && parts[1] === 'Game' ? parts[3] : undefined;
  const composerDir =
    parts[0] === 'unexotica' && parts[1] === 'Game' && parts[2]
      ? path.join(root, parts[0], parts[1], parts[2])
      : undefined;

  const candidates = [path.join(moduleDir, 'cover.jpg'), path.join(moduleDir, 'cover.png')];
  if (gameFolder && composerDir) {
    candidates.push(
      path.join(composerDir, gameFolder, 'cover.jpg'),
      path.join(composerDir, gameFolder, 'cover.png'),
      path.join(composerDir, `${gameFolder}.jpg`),
      path.join(composerDir, `${gameFolder}.png`),
    );
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const found = await fileIfPresent(candidate);
    if (found) return found;
  }
  return undefined;
}

async function readModDurationHint(absolutePath: string): Promise<number | undefined> {
  try {
    const handle = await fs.open(absolutePath, 'r');
    try {
      const buf = Buffer.alloc(1084);
      const { bytesRead } = await handle.read(buf, 0, 1084, 0);
      return estimateModDurationSeconds(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function indexFile(root: string, absolutePath: string): Promise<AmigaRecord | null> {
  const parsed = classifyFile(path.basename(absolutePath));
  if (!parsed) return null;

  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  const id = pathToId(relativePath);
  const meta = metadataFromPath(relativePath, parsed);
  const stat = await fs.stat(absolutePath);
  const coverPath = await findCoverPath(root, relativePath, absolutePath);
  const cachedDuration = await getCachedAmigaDuration(id);
  const estimated =
    cachedDuration ??
    (parsed.format === 'MOD' || parsed.format === 'NST' || parsed.format === 'WOW'
      ? await readModDurationHint(absolutePath)
      : undefined);

  return {
    id,
    relativePath,
    absolutePath,
    title: meta.title,
    artist: meta.artist,
    folderArtist: meta.folderArtist,
    format: parsed.format,
    game: meta.game,
    notes: meta.notes,
    sizeBytes: stat.size,
    durationSeconds: estimated,
    timestamp: stat.mtime.toISOString(),
    coverPath,
  };
}

async function buildIndex(): Promise<AmigaRecord[]> {
  const root = archiveRoot();
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  watchArchive();
  const files = await listCandidateFiles(root);
  const indexed = await Promise.all(files.map((file) => indexFile(root, file)));
  const records = indexed.filter((record): record is AmigaRecord => record !== null);
  records.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  return records;
}

export function loadAmigaIndex(): Promise<AmigaRecord[]> {
  if (!stale && records) return Promise.resolve(records);
  if (!building) {
    building = buildIndex()
      .then((next) => {
        records = next;
        stale = false;
        return next;
      })
      .finally(() => {
        building = null;
      });
  }
  return building;
}

export async function localAmigaStats(): Promise<{ connected: boolean; count: number }> {
  const index = await loadAmigaIndex();
  return { connected: index.length > 0, count: index.length };
}

function resolveIndexedPath(index: AmigaRecord[], id: string): string | null {
  const record = index.find((entry) => entry.id === id);
  if (!record) return null;

  const root = archiveRoot();
  const resolved = path.resolve(record.absolutePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export async function resolveAmigaFilePath(id: string): Promise<string | null> {
  const index = await loadAmigaIndex();
  return resolveIndexedPath(index, id);
}

export async function resolveAmigaCoverPath(id: string): Promise<string | null> {
  const index = await loadAmigaIndex();
  const record = index.find((entry) => entry.id === id);
  if (!record?.coverPath) return null;

  const root = archiveRoot();
  const resolved = path.resolve(record.coverPath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export async function getAmigaTrack(id: string): Promise<Track | null> {
  const index = await loadAmigaIndex();
  const local = index.find((record) => record.id === id);
  return local ? toTrack(local) : null;
}

/** Persist a measured duration (UADE WAV / client playback) onto the live index + disk cache. */
export async function setAmigaTrackDuration(id: string, seconds: number): Promise<Track | null> {
  const stored = await rememberAmigaDuration(id, seconds);
  if (stored == null) return null;

  const index = await loadAmigaIndex();
  const local = index.find((record) => record.id === id);
  if (!local) return null;
  local.durationSeconds = stored;
  return toTrack(local);
}

function recordHaystack(record: AmigaRecord, field: SearchField): string {
  const pathText = record.relativePath.replaceAll(/[_\-/.]+/g, ' ');

  switch (field) {
    case 'author':
      return `${record.artist} ${record.folderArtist}`;
    case 'title':
      return record.title;
    case 'game':
      return `${record.game ?? ''} ${record.title} ${record.notes ?? ''} ${pathText}`;
    case 'any':
      return [record.title, record.artist, record.folderArtist, record.game, record.notes, record.format, pathText]
        .filter(Boolean)
        .join(' ');
    default: {
      const _exhaustive: never = field;
      throw new Error(`Unhandled search field: ${_exhaustive}`);
    }
  }
}

function scoreRecord(record: AmigaRecord, query: string, field: SearchField): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 1;

  const phrase = normalizeGameKey(query);
  const title = normalizeGameKey(record.title);
  const artist = normalizeGameKey(record.artist);
  const game = normalizeGameKey(record.game ?? '');
  const haystack = recordHaystack(record, field);

  if (field === 'game' || field === 'any') {
    if (matchesNormalizedGame(query, record.game)) {
      if (game === phrase) return 100;
      if (game.startsWith(phrase) || phrase.startsWith(game)) return 92;
      return 88;
    }
  }

  if (!matchesAllTokens(haystack, tokens)) return 0;

  if (title === phrase || artist === phrase || game === phrase) return 100;
  if (title.startsWith(phrase) || artist.startsWith(phrase) || game.startsWith(phrase)) return 85;
  if (title.includes(phrase) || artist.includes(phrase) || game.includes(phrase)) return 70;
  if (tokens.every((token) => title.includes(token) || game.includes(token))) return 60;
  return 40;
}

export async function searchAmiga(
  query: string,
  field: SearchField = 'any',
  playableOnly = true,
): Promise<Track[]> {
  const index = await loadAmigaIndex();
  const q = query.trim();
  const limit = q ? SEARCH_LIMIT : EMPTY_SEARCH_LIMIT;
  const uadeAvailable = playableOnly ? await isUadeAvailable() : false;

  const ranked = index
    .map((record) => ({ record, score: scoreRecord(record, q, field) }))
    .filter((entry) => entry.score > 0)
    .filter((entry) => !playableOnly || isAmigaFormatPlayable(entry.record.format, uadeAvailable))
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title));

  return ranked.slice(0, limit).map((entry) => toTrack(entry.record));
}
