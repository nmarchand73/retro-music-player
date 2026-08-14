import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAmigaIndex } from './amiga.js';
import { normalizeGameKey } from '../searchQuery.js';
import type { Track } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

interface GameCover {
  key: string;
  label: string;
  coverPath: string;
}

let cached: { map: Map<string, GameCover>; from: unknown } | null = null;

function amigaRoot(): string {
  const override = process.env.AMIGA_ARCHIVE_DIR?.trim();
  if (override) return path.resolve(PROJECT_ROOT, override);
  return path.join(PROJECT_ROOT, 'data', 'amiga');
}

function expandKeys(value: string): string[] {
  const keys = new Set<string>();
  const base = normalizeGameKey(value);
  if (base) keys.add(base);
  return [...keys];
}

function coverSlug(key: string): string {
  return key.replaceAll(' ', '-');
}

function slugToKey(slug: string): string {
  return decodeURIComponent(slug).replaceAll('-', ' ').replaceAll(/\s+/g, ' ').trim();
}

function isSpecificCover(coverPath: string, game: string): boolean {
  const folder = game.replaceAll(' ', '_');
  return coverPath.includes(`${folder}.`) || coverPath.includes(`/${folder}/`) || coverPath.includes(`/${folder}.`);
}

async function loadGameCoverMap(): Promise<Map<string, GameCover>> {
  const index = await loadAmigaIndex();
  if (cached && cached.from === index) return cached.map;

  const map = new Map<string, GameCover>();
  for (const record of index) {
    if (!record.coverPath || !record.game) continue;
    if (!isSpecificCover(record.coverPath, record.game)) continue;
    for (const key of expandKeys(record.game)) {
      map.set(key, { key, label: record.game, coverPath: record.coverPath });
    }
  }

  cached = { map, from: index };
  return map;
}

function tokensAlign(query: string, candidate: string): boolean {
  const queryTokens = query.split(' ').filter(Boolean);
  const candidateTokens = candidate.split(' ').filter(Boolean);
  if (queryTokens.length === 0 || queryTokens.length !== candidateTokens.length) return false;
  return queryTokens.every((token, index) => {
    const other = candidateTokens[index];
    return other === token || other.startsWith(token) || token.startsWith(other);
  });
}

function lookupCover(map: Map<string, GameCover>, ...values: Array<string | undefined>): GameCover | undefined {
  for (const value of values) {
    if (!value) continue;
    for (const key of expandKeys(value)) {
      const hit = map.get(key);
      if (hit) return hit;
    }
  }
  for (const value of values) {
    if (!value) continue;
    for (const key of expandKeys(value)) {
      for (const [candidate, cover] of map) {
        if (tokensAlign(key, candidate)) return cover;
      }
    }
  }
  return undefined;
}

export async function attachGameCovers(tracks: Track[]): Promise<Track[]> {
  const map = await loadGameCoverMap();
  return tracks.map((track) => {
    const cover = lookupCover(map, track.game, track.title);
    if (!cover) return track;
    return {
      ...track,
      game: track.game ?? cover.label,
      coverUrl: track.coverUrl ?? `/api/cover/game/${encodeURIComponent(coverSlug(cover.key))}`,
    };
  });
}

export async function attachGameCover(track: Track | null): Promise<Track | null> {
  if (!track) return null;
  const [next] = await attachGameCovers([track]);
  return next ?? track;
}

export async function resolveGameCoverPath(slug: string): Promise<string | null> {
  const map = await loadGameCoverMap();
  const cover = map.get(slugToKey(slug)) ?? lookupCover(map, slugToKey(slug));
  if (!cover) return null;

  const root = amigaRoot();
  const resolved = path.resolve(cover.coverPath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}
