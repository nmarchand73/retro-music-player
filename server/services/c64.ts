import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAllTokens, matchesNormalizedGame, normalizeGameKey, searchTokens } from '../searchQuery.js';
import type { SearchField, Track } from '../types.js';

const SEARCH_LIMIT = 80;
const EMPTY_SEARCH_LIMIT = 24;
const INDEX_BATCH = 64;
const HEADER_BYTES = 0x76;
const TITLE_OFFSET = 0x16;
const AUTHOR_OFFSET = 0x36;
const RELEASED_OFFSET = 0x56;
const FIELD_LEN = 32;
const HVSC_DETAIL = 'https://hvsc.c64.org/';
const SKIP_DIRS = new Set(['documents', 'disks', 'update']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export interface C64Record {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  artist: string;
  folderArtist: string;
  year?: string;
  game?: string;
  notes?: string;
  durationSeconds?: number;
  timestamp?: string;
  sizeBytes: number;
}

let indexPromise: Promise<C64Record[]> | null = null;

function archiveRoot(): string {
  const override = process.env.C64_ARCHIVE_DIR?.trim();
  if (override) {
    return path.resolve(PROJECT_ROOT, override);
  }
  return path.join(PROJECT_ROOT, 'data', 'c64', 'HVSC', 'C64Music');
}

function pathToId(relativePath: string): string {
  return Buffer.from(relativePath).toString('base64url');
}

function readNullTerminated(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, Math.min(buf.length, offset + length));
  let end = 0;
  while (end < slice.length && slice[end] !== 0) end += 1;
  return slice.subarray(0, end).toString('latin1').trim();
}

function parseDurationToken(token: string): number | undefined {
  const cleaned = token.trim();
  if (!cleaned) return undefined;
  const match = cleaned.match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const frac = match[3] ? Number(`0.${match[3]}`) : 0;
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return undefined;
  return minutes * 60 + seconds + frac;
}

function normalizeSonglengthPath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^\//, '');
}

async function loadSonglengths(root: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const filePath = path.join(root, 'DOCUMENTS', 'Songlengths.md5');
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return map;
  }

  let currentPath: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(';')) {
      const pathPart = trimmed.slice(1).trim();
      currentPath = pathPart ? normalizeSonglengthPath(pathPart) : null;
      continue;
    }
    if (!currentPath) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const durations = trimmed.slice(eq + 1).trim().split(/\s+/);
    const first = parseDurationToken(durations[0] ?? '');
    if (first != null && first > 0) {
      map.set(currentPath, first);
    }
  }

  return map;
}

function artistFromMusiciansPath(relativePath: string): string | undefined {
  const parts = relativePath.split('/');
  if (parts[0]?.toUpperCase() !== 'MUSICIANS' || parts.length < 3) return undefined;
  return parts[2]?.replaceAll('_', ' ').trim() || undefined;
}

function gameFromGamesPath(relativePath: string): string | undefined {
  const parts = relativePath.split('/');
  if (parts[0]?.toUpperCase() !== 'GAMES' || parts.length < 2) return undefined;
  if (parts.length >= 3) {
    const folder = parts[parts.length - 2] ?? '';
    if (/^[0-9A-Za-z]-[0-9A-Za-z]$/.test(folder) || folder.length <= 2) {
      return path.parse(parts[parts.length - 1] ?? '').name.replaceAll('_', ' ');
    }
    return folder.replaceAll('_', ' ');
  }
  return path.parse(parts[parts.length - 1] ?? '').name.replaceAll('_', ' ');
}

function yearFromReleased(released: string): string | undefined {
  const match = released.match(/\b(19\d{2}|20\d{2})\b/);
  return match?.[1];
}

/** HVSC uses `<?>`, `?`, etc. when the SID header has no real author. */
function isPlaceholderAuthor(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === '<?>' || /^\?+$/.test(trimmed) || /^\.+$/.test(trimmed);
}

function toTrack(record: C64Record): Track {
  return {
    id: record.id,
    source: 'c64',
    platform: 'c64',
    title: record.title,
    artist: record.artist,
    format: 'SID',
    sizeBytes: record.sizeBytes,
    game: record.game,
    notes: record.notes,
    year: record.year,
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
    streamUrl: `/api/stream/c64/${record.id}`,
    detailUrl: HVSC_DETAIL,
  };
}

async function listSidFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sid')) {
        files.push(full);
      }
    }
  }

  await walk(root);
  return files;
}

async function indexFile(
  root: string,
  absolutePath: string,
  songlengths: Map<string, number>,
): Promise<C64Record | null> {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    if (bytesRead < RELEASED_OFFSET + 4) return null;

    const magic = buf.subarray(0, 4).toString('ascii');
    if (magic !== 'PSID' && magic !== 'RSID') return null;

    const headerTitle = readNullTerminated(buf, TITLE_OFFSET, FIELD_LEN);
    const headerAuthor = readNullTerminated(buf, AUTHOR_OFFSET, FIELD_LEN);
    const released = readNullTerminated(buf, RELEASED_OFFSET, FIELD_LEN);
    const folderArtist = artistFromMusiciansPath(relativePath) ?? 'Unknown';
    const title = headerTitle || path.parse(absolutePath).name.replaceAll('_', ' ');
    const artist = !isPlaceholderAuthor(headerAuthor) ? headerAuthor : folderArtist;
    const game = gameFromGamesPath(relativePath);
    const year = yearFromReleased(released);
    const notes = ['HVSC', released].filter(Boolean).join(' · ') || undefined;
    const durationSeconds = songlengths.get(relativePath);
    const stat = await handle.stat();

    return {
      id: pathToId(relativePath),
      relativePath,
      absolutePath,
      title,
      artist,
      folderArtist,
      year,
      game,
      notes,
      durationSeconds,
      timestamp: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  } finally {
    await handle.close();
  }
}

async function buildIndex(): Promise<C64Record[]> {
  const root = archiveRoot();
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const [files, songlengths] = await Promise.all([listSidFiles(root), loadSonglengths(root)]);
  const records: C64Record[] = [];

  for (let i = 0; i < files.length; i += INDEX_BATCH) {
    const batch = files.slice(i, i + INDEX_BATCH);
    const indexed = await Promise.all(batch.map((file) => indexFile(root, file, songlengths)));
    for (const record of indexed) {
      if (record) records.push(record);
    }
  }

  records.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  console.log(`[c64] indexed ${records.length.toLocaleString('en-US')} SID files`);
  return records;
}

export function loadC64Index(): Promise<C64Record[]> {
  if (!indexPromise) {
    indexPromise = buildIndex();
  }
  return indexPromise;
}

export async function localC64Stats(): Promise<{ connected: boolean; count: number }> {
  const index = await loadC64Index();
  return { connected: index.length > 0, count: index.length };
}

function resolveIndexedPath(index: C64Record[], id: string): string | null {
  const record = index.find((entry) => entry.id === id);
  if (!record) return null;

  const root = archiveRoot();
  const resolved = path.resolve(record.absolutePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export async function resolveC64FilePath(id: string): Promise<string | null> {
  const index = await loadC64Index();
  return resolveIndexedPath(index, id);
}

function recordHaystack(record: C64Record, field: SearchField): string {
  const pathText = record.relativePath.replaceAll(/[_\-/.]+/g, ' ');

  switch (field) {
    case 'author':
      return `${record.artist} ${record.folderArtist}`;
    case 'title':
      return record.title;
    case 'game':
      return `${record.game ?? ''} ${record.title} ${record.notes ?? ''} ${pathText}`;
    case 'any':
      return [
        record.title,
        record.artist,
        record.folderArtist,
        record.game,
        record.notes,
        record.year,
        pathText,
      ]
        .filter(Boolean)
        .join(' ');
    default: {
      const _exhaustive: never = field;
      throw new Error(`Unhandled search field: ${_exhaustive}`);
    }
  }
}

function scoreRecord(record: C64Record, query: string, field: SearchField): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 1;

  const phrase = normalizeGameKey(query);
  const title = normalizeGameKey(record.title);
  const artist = normalizeGameKey(record.artist);
  const folderArtist = normalizeGameKey(record.folderArtist);
  const game = normalizeGameKey(record.game ?? '');
  const haystack = recordHaystack(record, field);

  if (field === 'game' || field === 'any') {
    if (matchesNormalizedGame(query, record.game, record.title, record.notes)) {
      if (game === phrase || title === phrase) return 100;
      if (game.startsWith(phrase) || title.startsWith(phrase)) return 92;
      return 88;
    }
  }

  if (!matchesAllTokens(haystack, tokens)) return 0;

  if (title === phrase || artist === phrase || folderArtist === phrase || game === phrase) return 100;
  if (
    title.startsWith(phrase) ||
    artist.startsWith(phrase) ||
    folderArtist.startsWith(phrase) ||
    game.startsWith(phrase)
  ) {
    return 85;
  }
  if (title.includes(phrase) || artist.includes(phrase) || game.includes(phrase)) return 70;
  if (tokens.every((token) => title.includes(token) || game.includes(token))) return 60;
  return 40;
}

function searchLocalIndex(index: C64Record[], query: string, field: SearchField): Track[] {
  const q = query.trim();
  const limit = q ? SEARCH_LIMIT : EMPTY_SEARCH_LIMIT;

  const ranked = index
    .map((record) => ({ record, score: scoreRecord(record, q, field) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title));

  return ranked.slice(0, limit).map((entry) => toTrack(entry.record));
}

export async function searchC64(query: string, field: SearchField = 'any'): Promise<Track[]> {
  const index = await loadC64Index();
  if (index.length === 0) return [];
  return searchLocalIndex(index, query, field);
}

export async function getC64Track(id: string): Promise<Track | null> {
  const index = await loadC64Index();
  const local = index.find((record) => record.id === id);
  return local ? toTrack(local) : null;
}
