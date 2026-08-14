import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SearchField, Track } from '../types.js';

const SNDH_BASE = 'https://sndh.atari.org';
const HEADER_BYTES = 4096;
const SEARCH_LIMIT = 80;
const EMPTY_SEARCH_LIMIT = 24;
const INDEX_BATCH = 48;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export interface SndhRecord {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  artist: string;
  folderArtist: string;
  year?: string;
  game?: string;
  notes?: string;
  sizeBytes: number;
}

let indexPromise: Promise<SndhRecord[]> | null = null;

function archiveRoot(): string {
  const override = process.env.SNDH_ARCHIVE_DIR?.trim();
  if (override) {
    return path.resolve(PROJECT_ROOT, override);
  }
  return path.join(PROJECT_ROOT, 'data', 'sndh', 'sndh_lf');
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
  return value || undefined;
}

function folderArtistFrom(relativePath: string): string {
  const top = relativePath.split('/')[0] ?? 'Unknown';
  return top.replaceAll('_', ' ');
}

function isGamePath(relativePath: string): boolean {
  return /(^|\/)games?\//i.test(relativePath);
}

function toTrack(record: SndhRecord): Track {
  return {
    id: record.id,
    source: 'sndh',
    platform: 'atari',
    title: record.title,
    artist: record.artist,
    format: 'SNDH',
    sizeBytes: record.sizeBytes,
    game: record.game,
    notes: record.notes,
    streamUrl: `/api/stream/sndh/${record.id}`,
    detailUrl: `${SNDH_BASE}/`,
  };
}

async function listSndhFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sndh')) {
        files.push(full);
      }
    }
  }

  await walk(root);
  return files;
}

async function indexFile(root: string, absolutePath: string): Promise<SndhRecord | null> {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    const headerChunk = buf.subarray(0, bytesRead);
    const sndhAt = headerChunk.indexOf(Buffer.from('SNDH'));
    const header = sndhAt >= 0 ? headerChunk.subarray(sndhAt) : headerChunk;
    const folderArtist = folderArtistFrom(relativePath);
    const title = readTag(header, 'TITL') ?? path.parse(absolutePath).name.replaceAll('_', ' ');
    const artist = readTag(header, 'COMM') ?? folderArtist;
    const year = readTag(header, 'YEAR');
    const game = isGamePath(relativePath) ? title : undefined;
    const notes = [year, game ? 'Game soundtrack' : undefined].filter(Boolean).join(' · ') || undefined;
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
      sizeBytes: stat.size,
    };
  } finally {
    await handle.close();
  }
}

async function buildIndex(): Promise<SndhRecord[]> {
  const root = archiveRoot();
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const files = await listSndhFiles(root);
  const records: SndhRecord[] = [];

  for (let i = 0; i < files.length; i += INDEX_BATCH) {
    const batch = files.slice(i, i + INDEX_BATCH);
    const indexed = await Promise.all(batch.map((file) => indexFile(root, file)));
    for (const record of indexed) {
      if (record) records.push(record);
    }
  }

  records.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  return records;
}

export function loadSndhIndex(): Promise<SndhRecord[]> {
  if (!indexPromise) {
    indexPromise = buildIndex();
  }
  return indexPromise;
}

export async function localSndhStats(): Promise<{ connected: boolean; count: number }> {
  const index = await loadSndhIndex();
  return { connected: index.length > 0, count: index.length };
}

function resolveIndexedPath(index: SndhRecord[], id: string): string | null {
  const record = index.find((entry) => entry.id === id);
  if (!record) return null;

  const root = archiveRoot();
  const resolved = path.resolve(record.absolutePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export async function resolveSndhFilePath(id: string): Promise<string | null> {
  const index = await loadSndhIndex();
  return resolveIndexedPath(index, id);
}

export async function findLocalSndhByTitle(query: string): Promise<SndhRecord | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const index = await loadSndhIndex();
  return (
    index.find((record) => record.title.toLowerCase() === q) ??
    index.find((record) => record.title.toLowerCase().includes(q)) ??
    null
  );
}

function scoreRecord(record: SndhRecord, query: string, field: SearchField): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const title = record.title.toLowerCase();
  const artist = record.artist.toLowerCase();
  const folderArtist = record.folderArtist.toLowerCase();
  const notes = (record.notes ?? '').toLowerCase();
  const game = (record.game ?? '').toLowerCase();
  const year = (record.year ?? '').toLowerCase();

  const includes = (value: string) => value.includes(q);
  const starts = (value: string) => value.startsWith(q);
  const exact = (value: string) => value === q;

  switch (field) {
    case 'author':
      if (exact(artist) || exact(folderArtist)) return 100;
      if (starts(artist) || starts(folderArtist)) return 80;
      if (includes(artist) || includes(folderArtist)) return 60;
      return 0;
    case 'title':
      if (exact(title)) return 100;
      if (starts(title)) return 80;
      if (includes(title)) return 50;
      return 0;
    case 'game':
      if (exact(game) || exact(title)) return 100;
      if (starts(game) || starts(title)) return 80;
      if (includes(game) || includes(title) || includes(notes)) return 50;
      return 0;
    case 'any':
      if (exact(title) || exact(artist)) return 100;
      if (starts(title) || starts(artist) || starts(folderArtist)) return 80;
      if (includes(title)) return 70;
      if (includes(artist) || includes(folderArtist) || includes(game) || includes(notes) || includes(year)) {
        return 40;
      }
      return 0;
    default: {
      const _exhaustive: never = field;
      throw new Error(`Unhandled search field: ${_exhaustive}`);
    }
  }
}

function searchLocalIndex(index: SndhRecord[], query: string, field: SearchField): Track[] {
  const q = query.trim();
  const limit = q ? SEARCH_LIMIT : EMPTY_SEARCH_LIMIT;

  const ranked = index
    .map((record) => ({ record, score: scoreRecord(record, q, field) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title));

  return ranked.slice(0, limit).map((entry) => toTrack(entry.record));
}

function extractGameLabel(title: string, notes?: string): string | undefined {
  const haystack = `${title} ${notes ?? ''}`.toLowerCase();
  if (!/(game|soundtrack|from the game|from the release)/i.test(haystack)) return undefined;
  const fromGame = (notes ?? '').match(/from (?:the )?game(?: of the same name)?[:\s]+([^.;]+)/i);
  if (fromGame?.[1]) return fromGame[1].trim();
  return title.trim() || undefined;
}

function isGameTrack(track: Track): boolean {
  const haystack = `${track.title} ${track.notes ?? ''} ${track.game ?? ''}`.toLowerCase();
  return /(game|soundtrack|from the game|from the release)/i.test(haystack);
}

function parseRow($: cheerio.CheerioAPI, row: cheerio.Element, artistOverride?: string): Track | null {
  const cells = $(row).find('td');
  if (cells.length < 4) return null;

  const titleLink = cells.find('a[href^="/?ID="], a[href^="?ID="]').first();
  if (!titleLink.length) return null;

  const href = titleLink.attr('href');
  const idMatch = href?.match(/ID=(\d+)/i);
  if (!idMatch) return null;

  const id = idMatch[1];
  const title = titleLink.text().trim();
  const artistLink = cells.find('a[href*="p=composer"]').first();
  const artist = artistOverride ?? (artistLink.text().trim() || 'Unknown');
  const notes = cells.last().text().trim();

  return {
    id,
    source: 'sndh',
    platform: 'atari',
    title: title || 'Untitled',
    artist,
    format: 'SNDH',
    notes: notes && notes !== title && notes !== artist ? notes : undefined,
    game: extractGameLabel(title, notes),
    streamUrl: `/api/stream/sndh/${id}`,
    detailUrl: `${SNDH_BASE}/?ID=${id}`,
  };
}

function parseSearchResults(html: string, artistOverride?: string): Track[] {
  const $ = cheerio.load(html);
  const tracks: Track[] = [];

  $('table tr').each((_, row) => {
    const track = parseRow($, row, artistOverride);
    if (track) tracks.push(track);
  });

  return tracks;
}

function filterByField(tracks: Track[], query: string, field: SearchField): Track[] {
  const q = query.trim().toLowerCase();

  return tracks.filter((track) => {
    if (!q) {
      return field === 'game' ? isGameTrack(track) : true;
    }

    const title = track.title.toLowerCase();
    const artist = track.artist.toLowerCase();
    const notes = (track.notes ?? '').toLowerCase();
    const game = (track.game ?? '').toLowerCase();

    switch (field) {
      case 'author':
        return artist.includes(q);
      case 'title':
        return title.includes(q);
      case 'game':
        return title.includes(q) || game.includes(q) || notes.includes(q);
      case 'any':
        return title.includes(q) || artist.includes(q) || notes.includes(q) || game.includes(q);
      default: {
        const _exhaustive: never = field;
        throw new Error(`Unhandled search field: ${_exhaustive}`);
      }
    }
  });
}

async function fetchHtml(pathName: string, init?: RequestInit): Promise<string> {
  const response = await fetch(`${SNDH_BASE}${pathName}`, {
    ...init,
    headers: {
      'User-Agent': 'RetroMusicPlayer/1.0',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) return '';
  return response.text();
}

async function searchRemoteSndh(query: string, field: SearchField): Promise<Track[]> {
  if (!query.trim()) {
    const recent = parseSearchResults(await fetchHtml('/'));
    return filterByField(recent, query, field).slice(0, 20);
  }

  if (field === 'author') {
    const composerHtml = await fetchHtml(`/?p=composer&name=${encodeURIComponent(query)}`);
    const composerTracks = parseSearchResults(composerHtml, query);
    if (composerTracks.length > 0) {
      return composerTracks.slice(0, 25);
    }
  }

  const body = new URLSearchParams({ searchword: query });
  const html = await fetchHtml('/?p=searchdone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const tracks = parseSearchResults(html);
  return filterByField(tracks, query, field).slice(0, 25);
}

export async function searchSndh(query: string, field: SearchField = 'any'): Promise<Track[]> {
  const index = await loadSndhIndex();
  if (index.length > 0) {
    return searchLocalIndex(index, query, field);
  }
  return searchRemoteSndh(query, field);
}

export async function getSndhTrack(id: string): Promise<Track | null> {
  const index = await loadSndhIndex();
  const local = index.find((record) => record.id === id);
  if (local) return toTrack(local);

  const html = await fetchHtml(`/?ID=${id}`);
  if (!html) return null;

  const $ = cheerio.load(html);
  const title =
    $('h2').first().text().trim() ||
    $('title').text().replace('SNDH Atari ST YM2149 collection', '').trim();
  const composerLink = $('a[href*="p=composer"]').first();
  const artist = composerLink.text().trim() || 'Unknown';

  return {
    id,
    source: 'sndh',
    platform: 'atari',
    title: title || `SNDH #${id}`,
    artist,
    format: 'SNDH',
    streamUrl: `/api/stream/sndh/${id}`,
    detailUrl: `${SNDH_BASE}/?ID=${id}`,
  };
}

export function sndhDownloadUrl(id: string): string {
  return `${SNDH_BASE}/dl.php?ID=${id}`;
}

export function sndhReferer(id: string): string {
  return `${SNDH_BASE}/?ID=${id}`;
}
