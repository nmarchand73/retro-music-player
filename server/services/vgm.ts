import fs from 'node:fs/promises';
import path from 'node:path';
import { matchesAllTokens, searchTokens } from '../searchQuery.js';
import type { SearchField, Track } from '../types.js';
import { applyCoverYearHeuristic } from '../../src/utils/trackOrigin.js';
import { parseVgmMetadata } from '../utils/vgmTags.js';
import { DATA_ROOT, PROJECT_ROOT } from '../paths.js';

const SEARCH_LIMIT = 80;
const EMPTY_SEARCH_LIMIT = 24;
const INDEX_BATCH = 64;
const HEADER_BYTES = 0x200;
const VGM_DETAIL = 'https://vgmrips.net/';

export interface VgmRecord {
  id: string;
  relativePath: string;
  absolutePath: string;
  title: string;
  artist: string;
  game?: string;
  notes?: string;
  year?: string;
  durationSeconds?: number;
  timestamp?: string;
  sizeBytes: number;
  publisher?: string;
}

let indexPromise: Promise<VgmRecord[]> | null = null;
/** One retry when the archive appears after a cold start with an empty cache. */
let indexRetryDone = false;

function archiveRoot(): string {
  const override = process.env.VGM_ARCHIVE_DIR?.trim();
  if (override) {
    return path.resolve(PROJECT_ROOT, override);
  }
  return path.join(DATA_ROOT, 'vgm', 'vgmrips');
}

function pathToId(relativePath: string): string {
  return Buffer.from(relativePath).toString('base64url');
}

/** Extra tokens for search (regional / marketing titles). */
const GAME_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'Sky Shark': ['Flying Shark', 'Hishou Zame', 'Hishouzame'],
  'Bad Dudes vs. Dragonninja': ['Dragon Ninja', 'Dragonninja', 'Bad Dudes'],
  'Salamander': ['Nemesis', 'Gradius', 'Life Force', 'Salamander'],
  'Salamander 2': ['Salamander 2'],
  'R-Type': ['Rtype', 'R-Type'],
  'R-Type II': ['R-Type 2', 'Rtype 2', 'R-Type II'],
  Pang: ['Buster Bros', 'Buster Brothers'],
  'Super Pang': ['Pang 2'],
  'Operation Wolf': ['Op Wolf'],
  "Ghosts'n Goblins": ['Ghosts n Goblins', 'Ghost n Goblins'],
  "Ghouls'n Ghosts": ['Ghouls n Ghosts', 'Ghouls and Ghosts'],
  'Bubble Bobble': ['Bubble Bobble'],
  'Snow Bros.': ['Snow Bros', 'Snow Brothers'],
  'Metal Slug': ['Metal Slug'],
  Asterix: ['Asterix and Obelix'],
  'Track & Field': ['Hyper Olympic', 'Track Field'],
  'Rastan Saga': ['Rastan'],
  'Street Fighter II: The World Warrior': ['Street Fighter II', 'SF2', 'World Warrior'],
  'Street Fighter II': ['SF2', 'World Warrior'],
  'Mortal Kombat': ['MK1', 'Mortal Kombat 1'],
  'Golden Axe': ['Golden Axe'],
  'Teenage Mutant Ninja Turtles: Turtles in Time': ['TMNT', 'Turtles in Time'],
  'The Simpsons Arcade Game': ['Simpsons', 'The Simpsons'],
  "The King of Fighters '94": ['KOF 94', 'King of Fighters 94', 'KOF94'],
  'Puzzle Bobble': ['Bust-A-Move', 'Bust a Move'],
  '1943: The Battle of Midway': ['1943', 'Battle of Midway'],
  'Bad Dudes vs. DragonNinja': ['Bad Dudes', 'Dragon Ninja', 'Dragonninja'],
  'Cadillacs and Dinosaurs': ['Cadillacs', 'Cadillacs & Dinosaurs'],
  'Super Hang-On': ['Super Hang On', 'Hang-On'],
  'Virtua Fighter': ['VF1', 'Virtua Fighter 1'],
  Tekken: ['Tekken 1'],
  'Knights of the Round': ['Knights of Round'],
  'After Burner II': ['After Burner', 'After Burner 2'],
};

function gameSearchAliases(game: string | undefined): string {
  if (!game) return '';
  const extras = GAME_SEARCH_ALIASES[game];
  return extras?.join(' ') ?? '';
}

function publisherFromPath(relativePath: string): string | undefined {
  const parts = relativePath.split('/');
  if (parts[0]?.toLowerCase() !== 'arcade') return undefined;
  const sys = parts[1];
  if (sys === 'SegaSys') return 'Sega';
  if (sys === 'DataEast') return 'Data East';
  const joined = relativePath.toLowerCase();
  if (joined.includes('data_east') || joined.includes('dataeast')) return 'Data East';
  if (joined.includes('segasys') || joined.includes('sega_') || joined.includes('sega ')) return 'Sega';
  return sys?.replace(/_/g, ' ');
}

function gameFromPath(relativePath: string, metaGame: string): string | undefined {
  if (metaGame.trim()) return metaGame.trim();
  const parts = relativePath.split('/');
  const folder = parts[parts.length - 2] ?? '';
  const match = folder.match(/^(.+?)_\([^)]+\)$/);
  if (match?.[1]) return match[1].replace(/_/g, ' ');
  return folder.replace(/_/g, ' ') || undefined;
}

function toTrack(record: VgmRecord): Track {
  return {
    id: record.id,
    source: 'vgm',
    platform: 'arcade',
    title: record.title,
    artist: record.artist,
    format: record.relativePath.toLowerCase().endsWith('.vgz') ? 'VGZ' : 'VGM',
    sizeBytes: record.sizeBytes,
    game: record.game,
    notes: record.notes,
    year: record.year,
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
    originalGame: true,
    originKind: 'game',
    streamUrl: `/api/stream/vgm/${record.id}`,
    detailUrl: VGM_DETAIL,
  };
}

async function listVgmFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        await walk(full);
      } else if (entry.isFile() && /\.(vgm|vgz)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  }

  await walk(root);
  return files;
}

async function indexFile(root: string, absolutePath: string): Promise<VgmRecord | null> {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  const basename = path.basename(absolutePath);
  try {
    const stat = await fs.stat(absolutePath);
    const lower = basename.toLowerCase();
    let meta;
    try {
      if (lower.endsWith('.vgz')) {
        const full = await fs.readFile(absolutePath);
        meta = parseVgmMetadata(full, basename);
      } else {
        const handle = await fs.open(absolutePath, 'r');
        try {
          const buf = Buffer.alloc(HEADER_BYTES);
          const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
          if (bytesRead < 4) return null;
          meta = parseVgmMetadata(buf.subarray(0, bytesRead), basename);
        } finally {
          await handle.close();
        }
      }
    } catch {
      return null;
    }
    const publisher = publisherFromPath(relativePath);
    const game = gameFromPath(relativePath, meta.game);
    const notes = [meta.system, publisher].filter(Boolean).join(' · ') || undefined;

    return {
      id: pathToId(relativePath),
      relativePath,
      absolutePath,
      title: meta.title,
      artist: meta.artist,
      game,
      notes,
      year: meta.year,
      durationSeconds: meta.durationSeconds,
      timestamp: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      publisher,
    };
  } catch {
    return null;
  }
}

async function buildIndex(): Promise<VgmRecord[]> {
  const root = archiveRoot();
  try {
    await fs.access(root);
  } catch {
    return [];
  }

  const files = await listVgmFiles(root);
  const records: VgmRecord[] = [];

  for (let i = 0; i < files.length; i += INDEX_BATCH) {
    const batch = files.slice(i, i + INDEX_BATCH);
    const indexed = await Promise.all(batch.map((file) => indexFile(root, file)));
    for (const record of indexed) {
      if (record) records.push(record);
    }
  }

  records.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  applyCoverYearHeuristic(records);
  return records;
}

function recordHaystack(record: VgmRecord): string {
  return [
    record.title,
    record.artist,
    record.game ?? '',
    gameSearchAliases(record.game),
    record.notes ?? '',
    record.publisher ?? '',
    record.relativePath,
  ]
    .join(' ')
    .toLowerCase();
}

function scoreRecord(record: VgmRecord, tokens: string[], field: SearchField): number {
  const hay = recordHaystack(record);
  let score = 0;
  for (const token of tokens) {
    if (field === 'author' && record.artist.toLowerCase().includes(token)) score += 12;
    else if (field === 'game' && (record.game ?? '').toLowerCase().includes(token)) score += 12;
    else if (field === 'title' && record.title.toLowerCase().includes(token)) score += 12;
    else if (hay.includes(token)) score += 4;
  }
  if (record.publisher === 'Sega') score += 0.1;
  return score;
}

async function archiveHasVgmFiles(): Promise<boolean> {
  const root = archiveRoot();
  try {
    await fs.access(root);
  } catch {
    return false;
  }
  const files = await listVgmFiles(root);
  return files.length > 0;
}

export async function loadVgmIndex(): Promise<VgmRecord[]> {
  if (!indexPromise) indexPromise = buildIndex();
  let records = await indexPromise;
  if (records.length === 0 && !indexRetryDone) {
    indexRetryDone = true;
    if (await archiveHasVgmFiles()) {
      indexPromise = buildIndex();
      records = await indexPromise;
    }
  }
  return records;
}

export async function localVgmStats(): Promise<{ connected: boolean; count: number }> {
  const records = await loadVgmIndex();
  return { connected: records.length > 0, count: records.length };
}

export async function getVgmTrack(id: string): Promise<Track | null> {
  const records = await loadVgmIndex();
  const record = records.find((entry) => entry.id === id);
  return record ? toTrack(record) : null;
}

export async function resolveVgmFilePath(id: string): Promise<string | null> {
  const records = await loadVgmIndex();
  const record = records.find((entry) => entry.id === id);
  if (!record) return null;
  const root = archiveRoot();
  const resolved = path.resolve(root, record.relativePath);
  if (!resolved.startsWith(path.resolve(root))) return null;
  try {
    await fs.access(resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function searchVgm(query: string, field: SearchField): Promise<Track[]> {
  const records = await loadVgmIndex();
  const trimmed = query.trim();
  if (!trimmed) {
    return records.slice(0, EMPTY_SEARCH_LIMIT).map(toTrack);
  }

  const tokens = searchTokens(trimmed);
  const scored = records
    .map((record) => ({ record, score: scoreRecord(record, tokens, field) }))
    .filter(({ record, score }) => score > 0 && matchesAllTokens(recordHaystack(record), tokens))
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title));

  return scored.slice(0, SEARCH_LIMIT).map(({ record }) => toTrack(record));
}

export function invalidateVgmIndex(): void {
  indexPromise = null;
  indexRetryDone = false;
}
