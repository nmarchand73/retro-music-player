import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAllTokens, matchesNormalizedGame, normalizeGameKey, searchTokens } from '../searchQuery.js';
import type { SearchField, Track } from '../types.js';
import { parseSndhTiming } from '../../src/utils/sndhTiming.js';

const HEADER_BYTES = 4096;
const SEARCH_LIMIT = 80;
const EMPTY_SEARCH_LIMIT = 24;
const INDEX_BATCH = 48;
const CPC_DETAIL = 'https://sndh.atari.org/';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export type CpcFormat = 'SNDH' | 'AY' | 'YM';

export interface CpcRecord {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  artist: string;
  folderArtist: string;
  format: CpcFormat;
  year?: string;
  game?: string;
  notes?: string;
  durationSeconds?: number;
  timestamp?: string;
  sizeBytes: number;
}

let indexPromise: Promise<CpcRecord[]> | null = null;

function archiveRoot(): string {
  const override = process.env.CPC_ARCHIVE_DIR?.trim();
  if (override) {
    return path.resolve(PROJECT_ROOT, override);
  }
  return path.join(PROJECT_ROOT, 'data', 'cpc');
}

function pathToId(relativePath: string): string {
  return Buffer.from(relativePath).toString('base64url');
}

function readTag(header: Buffer, name: string): string | undefined {
  const needle = Buffer.from(name);
  const start = header.indexOf(needle);
  if (start < 0) return undefined;
  const valueStart = start + needle.length;
  let end = valueStart;
  while (end < header.length && header[end] !== 0) end += 1;
  const value = header.subarray(valueStart, end).toString('latin1').trim();
  return isUsableMeta(value) ? value : undefined;
}

/** Reject ICE-packed / binary false-positive tag payloads. */
function isUsableMeta(value: string | undefined): value is string {
  if (!value) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  const alnum = value.replace(/[^A-Za-z0-9]+/g, '');
  return alnum.length >= 2;
}

function isIcePacked(headerChunk: Buffer): boolean {
  return headerChunk.length >= 4 && headerChunk.subarray(0, 4).toString('ascii') === 'ICE!';
}

function isAyFile(headerChunk: Buffer, absolutePath: string): boolean {
  if (absolutePath.toLowerCase().endsWith('.ay')) return true;
  return headerChunk.length >= 8 && headerChunk.subarray(0, 8).toString('ascii') === 'ZXAYEMUL';
}

function collectCStrings(buf: Buffer, limit = 768): string[] {
  const out: string[] = [];
  let start = -1;
  const max = Math.min(buf.length, limit);
  for (let i = 0; i < max; i += 1) {
    const b = buf[i]!;
    if (b >= 0x20 && b < 0x7f) {
      if (start < 0) start = i;
      continue;
    }
    if (b === 0 && start >= 0 && i - start >= 3) {
      out.push(buf.subarray(start, i).toString('ascii').trim());
    }
    start = -1;
  }
  return out;
}

function parseAyMeta(headerChunk: Buffer, pathTitle: string): { title: string; author?: string } {
  const strings = collectCStrings(headerChunk).filter(
    (value) =>
      !/^ZXAY/i.test(value) &&
      !/^EMUL$/i.test(value) &&
      !/^Unknown$/i.test(value) &&
      !/^\(c\)/i.test(value) &&
      value.length >= 3 &&
      value.length < 120,
  );
  const songLike = strings.find((value) => /\(AY\)/i.test(value) || / - /.test(value));
  const title = songLike ?? strings[0] ?? pathTitle;
  return { title };
}

function titleFromPath(absolutePath: string): string {
  return path
    .parse(absolutePath)
    .name.replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function folderArtistFrom(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean);
  const top = (parts[0] ?? 'Unknown').toLowerCase();
  if (top === 'cpc_lf' || top === 'cpc_sf') {
    return (parts[1] ?? 'Unknown').replaceAll('_', ' ');
  }
  if (top === 'projectay') {
    const section = (parts[1] ?? '').toLowerCase();
    if (section === 'games') return 'Project AY · Games';
    if (section === 'demos') return 'Project AY · Demos';
    return 'Project AY';
  }
  if (top === 'ym_games') {
    const pack = (parts[1] ?? '').toLowerCase();
    if (pack === 'cpcmuseum') {
      const section = (parts[2] ?? '').toLowerCase();
      if (section.startsWith('jeux') || section === 'games') return 'CPCMuseum · Games';
      if (section.includes('demo') || section.includes('crack')) return 'CPCMuseum · Demos';
      return 'CPCMuseum';
    }
    if (pack === 'cpctune2' || pack === 'cpctune') {
      const section = (parts[2] ?? '').toLowerCase();
      if (section === 'games') return 'CPCTune · Games';
      return 'CPCTune';
    }
    return 'CPC YM games';
  }
  return (parts[0] ?? 'Unknown').replaceAll('_', ' ');
}

function isGamePath(relativePath: string): boolean {
  return /(^|\/)(games?|jeux)\//i.test(relativePath);
}

function gameTitleFromPath(absolutePath: string, pathTitle: string): string {
  // "Outrun - Musique 1" → "Outrun"; keep short titles as-is.
  const stripped = pathTitle
    .replace(/\s*[-–]\s*(musique|music|tune|loader|intro)\b.*$/i, '')
    .replace(/\s+#?\d+\s*$/i, '')
    .trim();
  return stripped.length >= 2 ? stripped : pathTitle;
}

function collectionNote(relativePath: string, format: CpcFormat): string {
  const top = relativePath.split('/')[0]?.toLowerCase() ?? '';
  if (top === 'projectay') return format === 'AY' ? 'Project AY' : 'Amstrad CPC';
  if (top === 'cpc_lf' || top === 'cpc_sf') return 'sndh.atari.org';
  if (top === 'ym_games') {
    if (format === 'YM') return 'CPCMuseum / genesis8 YM';
    return 'Amstrad CPC';
  }
  return 'Amstrad CPC';
}

/** Read song/author strings from uncompressed YM5/YM6 headers. */
function parseYmMeta(headerChunk: Buffer): { title?: string; artist?: string } {
  const magic = headerChunk.subarray(0, 4).toString('ascii');
  if (magic !== 'YM5!' && magic !== 'YM6!' && magic !== 'YM4!') return {};
  // Skip fixed header: magic(4) + check(8) + frames(4) + attrs(4) + digi(2) + clock(4) + rate(2) + loop(4) + size(2) = 34
  const strings = collectCStrings(headerChunk.subarray(34), headerChunk.length - 34).filter(
    (value) => value.length >= 2 && value.length < 120 && !/^Leonard/i.test(value),
  );
  return {
    title: isUsableMeta(strings[0]) ? strings[0] : undefined,
    artist: isUsableMeta(strings[1]) ? strings[1] : undefined,
  };
}

function ymDetailUrl(relativePath: string): string {
  if (relativePath.toLowerCase().includes('cpcmuseum')) {
    return 'http://genesis8.free.fr/frontend/music.php';
  }
  return 'http://genesis8.free.fr/frontend/music.php';
}

function toTrack(record: CpcRecord): Track {
  return {
    id: record.id,
    source: 'cpc',
    platform: 'cpc',
    title: record.title,
    artist: record.artist,
    format: record.format,
    sizeBytes: record.sizeBytes,
    game: record.game,
    notes: record.notes,
    year: record.year,
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
    streamUrl: `/api/stream/cpc/${record.id}`,
    detailUrl:
      record.format === 'AY'
        ? 'https://worldofspectrum.org/projectay/'
        : record.format === 'YM'
          ? ymDetailUrl(record.relativePath)
          : CPC_DETAIL,
  };
}

function isCpcMusicFile(name: string): boolean {
  const lower = name.toLowerCase();
  // ym2149-wasm AY replayer is ZX Spectrum–only; CPC Project AY .ay rips stop immediately.
  // Playable CPC: SNDH (.snd) under cpc_lf + ST-Sound YM (.ym) game dumps under ym_games.
  return lower.endsWith('.snd') || lower.endsWith('.sndh') || lower.endsWith('.ym');
}

async function listCpcFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isCpcMusicFile(entry.name)) {
        files.push(full);
      }
    }
  }

  await walk(root);
  return files;
}

async function indexFile(root: string, absolutePath: string): Promise<CpcRecord | null> {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    const headerChunk = buf.subarray(0, bytesRead);
    const pathTitle = titleFromPath(absolutePath);
    const folderArtist = folderArtistFrom(relativePath);
    const lowerPath = absolutePath.toLowerCase();
    const ay = isAyFile(headerChunk, absolutePath);
    const ym = !ay && lowerPath.endsWith('.ym');
    const format: CpcFormat = ay ? 'AY' : ym ? 'YM' : 'SNDH';

    let title = pathTitle;
    let artist = folderArtist;
    let year: string | undefined;
    let game: string | undefined;
    let durationSeconds: number | undefined;

    if (ay) {
      const meta = parseAyMeta(headerChunk, pathTitle);
      title = meta.title || pathTitle;
      artist = folderArtist;
      if (isGamePath(relativePath)) {
        game = pathTitle;
      }
    } else if (ym) {
      const meta = parseYmMeta(headerChunk);
      title = meta.title ?? pathTitle;
      artist = meta.artist ?? folderArtist;
      if (isGamePath(relativePath)) {
        game = gameTitleFromPath(absolutePath, pathTitle);
      }
    } else {
      const sndhAt = headerChunk.indexOf(Buffer.from('SNDH'));
      const header = sndhAt >= 0 ? headerChunk.subarray(sndhAt) : headerChunk;
      const packed = isIcePacked(headerChunk);
      title = packed ? pathTitle : (readTag(header, 'TITL') ?? pathTitle);
      artist = packed ? folderArtist : (readTag(header, 'COMM') ?? folderArtist);
      year = packed ? undefined : readTag(header, 'YEAR');
      game = isGamePath(relativePath) ? title : undefined;
      const timing = packed ? null : parseSndhTiming(new Uint8Array(headerChunk));
      durationSeconds = timing?.seconds ?? undefined;
    }

    const notes = [
      game ? 'Game soundtrack' : undefined,
      collectionNote(relativePath, format),
    ]
      .filter(Boolean)
      .join(' · ') || undefined;
    const stat = await handle.stat();

    return {
      id: pathToId(relativePath),
      relativePath,
      absolutePath,
      title,
      artist,
      folderArtist,
      format,
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

async function buildIndex(): Promise<CpcRecord[]> {
  const root = archiveRoot();
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const files = await listCpcFiles(root);
  const records: CpcRecord[] = [];

  for (let i = 0; i < files.length; i += INDEX_BATCH) {
    const batch = files.slice(i, i + INDEX_BATCH);
    const indexed = await Promise.all(batch.map((file) => indexFile(root, file)));
    for (const record of indexed) {
      if (record) records.push(record);
    }
  }

  records.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  const sndhCount = records.filter((record) => record.format === 'SNDH').length;
  const ymCount = records.filter((record) => record.format === 'YM').length;
  const ayCount = records.filter((record) => record.format === 'AY').length;
  console.log(
    `[cpc] indexed ${records.length.toLocaleString('en-US')} files (${sndhCount.toLocaleString('en-US')} SNDH · ${ymCount.toLocaleString('en-US')} YM · ${ayCount.toLocaleString('en-US')} AY)`,
  );
  return records;
}

export function loadCpcIndex(): Promise<CpcRecord[]> {
  if (!indexPromise) {
    indexPromise = buildIndex();
  }
  return indexPromise;
}

export async function localCpcStats(): Promise<{ connected: boolean; count: number }> {
  const index = await loadCpcIndex();
  return { connected: index.length > 0, count: index.length };
}

function resolveIndexedPath(index: CpcRecord[], id: string): string | null {
  const record = index.find((entry) => entry.id === id);
  if (!record) return null;

  const root = archiveRoot();
  const resolved = path.resolve(record.absolutePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export async function resolveCpcFilePath(id: string): Promise<string | null> {
  const index = await loadCpcIndex();
  return resolveIndexedPath(index, id);
}

function recordHaystack(record: CpcRecord, field: SearchField): string {
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

function scoreRecord(record: CpcRecord, query: string, field: SearchField): number {
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

function searchLocalIndex(index: CpcRecord[], query: string, field: SearchField): Track[] {
  const q = query.trim();
  const limit = q ? SEARCH_LIMIT : EMPTY_SEARCH_LIMIT;

  const ranked = index
    .map((record) => ({ record, score: scoreRecord(record, q, field) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title));

  return ranked.slice(0, limit).map((entry) => toTrack(entry.record));
}

export async function searchCpc(query: string, field: SearchField = 'any'): Promise<Track[]> {
  const index = await loadCpcIndex();
  if (index.length === 0) return [];
  return searchLocalIndex(index, query, field);
}

export async function getCpcTrack(id: string): Promise<Track | null> {
  const index = await loadCpcIndex();
  const local = index.find((record) => record.id === id);
  return local ? toTrack(local) : null;
}
