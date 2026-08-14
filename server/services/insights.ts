import { isOpenmptFormat } from '../../src/utils/amigaPlayable.js';
import type { MusicPlatform } from '../types.js';
import { loadAmigaIndex, type AmigaRecord } from './amiga.js';
import { loadC64Index, type C64Record } from './c64.js';
import { loadCpcIndex, type CpcRecord } from './cpc.js';
import { loadSndhIndex, type SndhRecord } from './sndh.js';

const TOP_LIMIT = 200;
const LONG_LIMIT = 200;
const RECENT_LIMIT = 20;
const FORMAT_LIMIT = 20;
const UNKNOWN_AUTHOR = /^(unknown|n\/a|na|various|misc|<\?>|\?+|\.+)$/i;

export interface InsightRank {
  label: string;
  count: number;
  amigaCount: number;
  atariCount: number;
  cpcCount: number;
  c64Count: number;
  share: number;
  coverUrl?: string;
}

export interface InsightTrackBrief {
  id: string;
  source: 'amiga' | 'sndh' | 'cpc' | 'c64';
  platform: 'amiga' | 'atari' | 'cpc' | 'c64';
  title: string;
  artist: string;
  game?: string;
  format: string;
  durationSeconds?: number;
  timestamp?: string;
  streamUrl: string;
  coverUrl?: string;
}

export interface InsightsResponse {
  platform: MusicPlatform;
  generatedAt: string;
  overview: {
    tracks: number;
    amiga: number;
    atari: number;
    cpc: number;
    c64: number;
    composers: number;
    games: number;
    formats: number;
    withDuration: number;
    withGame: number;
    totalDurationSeconds: number;
    openmpt: number;
    exotic: number;
  };
  topAuthors: InsightRank[];
  topGames: InsightRank[];
  formats: InsightRank[];
  years: InsightRank[];
  longest: InsightTrackBrief[];
  recentlyAdded: InsightTrackBrief[];
}

interface FlatRecord {
  id: string;
  source: 'amiga' | 'sndh' | 'cpc' | 'c64';
  platform: 'amiga' | 'atari' | 'cpc' | 'c64';
  title: string;
  artist: string;
  game?: string;
  year?: string;
  format: string;
  durationSeconds?: number;
  timestamp?: string;
  coverPath?: string;
}

interface Bucket {
  count: number;
  amigaCount: number;
  atariCount: number;
  cpcCount: number;
  c64Count: number;
  coverUrl?: string;
}

function coverSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toFlatAmiga(record: AmigaRecord): FlatRecord {
  return {
    id: record.id,
    source: 'amiga',
    platform: 'amiga',
    title: record.title,
    artist: record.artist,
    game: record.game,
    format: record.format,
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
    coverPath: record.coverPath,
  };
}

function toFlatSndh(record: SndhRecord): FlatRecord {
  return {
    id: record.id,
    source: 'sndh',
    platform: 'atari',
    title: record.title,
    artist: record.artist,
    game: record.game,
    year: record.year,
    format: 'SNDH',
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
  };
}

function toFlatCpc(record: CpcRecord): FlatRecord {
  return {
    id: record.id,
    source: 'cpc',
    platform: 'cpc',
    title: record.title,
    artist: record.artist,
    game: record.game,
    year: record.year,
    format: record.format,
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
  };
}

function toFlatC64(record: C64Record): FlatRecord {
  return {
    id: record.id,
    source: 'c64',
    platform: 'c64',
    title: record.title,
    artist: record.artist,
    game: record.game,
    year: record.year,
    format: 'SID',
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
  };
}

function toBrief(record: FlatRecord): InsightTrackBrief {
  return {
    id: record.id,
    source: record.source,
    platform: record.platform,
    title: record.title,
    artist: record.artist,
    game: record.game,
    format: record.format,
    durationSeconds: record.durationSeconds,
    timestamp: record.timestamp,
    streamUrl: `/api/stream/${record.source}/${record.id}`,
    coverUrl: record.coverPath
      ? `/api/cover/amiga/${record.id}`
      : record.game
        ? `/api/cover/game/${encodeURIComponent(coverSlug(record.game))}`
        : undefined,
  };
}

function bump(
  map: Map<string, Bucket>,
  key: string,
  platform: FlatRecord['platform'],
  coverUrl?: string,
): void {
  const label = key.trim();
  if (!label) return;
  const current = map.get(label) ?? {
    count: 0,
    amigaCount: 0,
    atariCount: 0,
    cpcCount: 0,
    c64Count: 0,
  };
  current.count += 1;
  switch (platform) {
    case 'amiga':
      current.amigaCount += 1;
      break;
    case 'atari':
      current.atariCount += 1;
      break;
    case 'cpc':
      current.cpcCount += 1;
      break;
    case 'c64':
      current.c64Count += 1;
      break;
    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unhandled platform: ${_exhaustive}`);
    }
  }
  if (!current.coverUrl && coverUrl) current.coverUrl = coverUrl;
  map.set(label, current);
}

function ranked(
  map: Map<string, Bucket>,
  total: number,
  limit: number,
  skip?: (label: string) => boolean,
): InsightRank[] {
  return [...map.entries()]
    .filter(([label]) => !(skip?.(label)))
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, bucket]) => ({
      label,
      count: bucket.count,
      amigaCount: bucket.amigaCount,
      atariCount: bucket.atariCount,
      cpcCount: bucket.cpcCount,
      c64Count: bucket.c64Count,
      share: total > 0 ? bucket.count / total : 0,
      coverUrl: bucket.coverUrl,
    }));
}

export type InsightMachine = 'amiga' | 'atari' | 'cpc' | 'c64';

function includesMachine(
  platform: MusicPlatform,
  machines: readonly InsightMachine[],
  id: InsightMachine,
): boolean {
  if (platform === id) return true;
  if (platform === 'all') return machines.includes(id);
  return false;
}

export async function buildInsights(
  platform: MusicPlatform = 'all',
  machines: readonly InsightMachine[] = ['amiga', 'atari', 'cpc', 'c64'],
): Promise<InsightsResponse> {
  const [amigaIndex, sndhIndex, cpcIndex, c64Index] = await Promise.all([
    loadAmigaIndex(),
    loadSndhIndex(),
    loadCpcIndex(),
    loadC64Index(),
  ]);

  const records: FlatRecord[] = [];
  if (includesMachine(platform, machines, 'amiga')) {
    for (const record of amigaIndex) records.push(toFlatAmiga(record));
  }
  if (includesMachine(platform, machines, 'atari')) {
    for (const record of sndhIndex) records.push(toFlatSndh(record));
  }
  if (includesMachine(platform, machines, 'cpc')) {
    for (const record of cpcIndex) records.push(toFlatCpc(record));
  }
  if (includesMachine(platform, machines, 'c64')) {
    for (const record of c64Index) records.push(toFlatC64(record));
  }

  const authors = new Map<string, Bucket>();
  const games = new Map<string, Bucket>();
  const formats = new Map<string, Bucket>();
  const years = new Map<string, Bucket>();

  let amiga = 0;
  let atari = 0;
  let cpc = 0;
  let c64 = 0;
  let withDuration = 0;
  let withGame = 0;
  let totalDurationSeconds = 0;
  let openmpt = 0;
  let exotic = 0;
  const composerSet = new Set<string>();

  for (const record of records) {
    switch (record.platform) {
      case 'amiga':
        amiga += 1;
        if (isOpenmptFormat(record.format)) openmpt += 1;
        else exotic += 1;
        break;
      case 'atari':
        atari += 1;
        break;
      case 'cpc':
        cpc += 1;
        break;
      case 'c64':
        c64 += 1;
        break;
      default: {
        const _exhaustive: never = record.platform;
        throw new Error(`Unhandled platform: ${_exhaustive}`);
      }
    }

    const authorKey = record.artist.trim() || 'Unknown';
    composerSet.add(authorKey.toLowerCase());
    bump(authors, authorKey, record.platform);

    if (record.game) {
      withGame += 1;
      const coverUrl = record.coverPath
        ? `/api/cover/amiga/${record.id}`
        : `/api/cover/game/${encodeURIComponent(coverSlug(record.game))}`;
      bump(games, record.game, record.platform, coverUrl);
    }

    bump(formats, record.format || 'Unknown', record.platform);

    if (record.year && /^\d{4}$/.test(record.year)) {
      bump(years, record.year, record.platform);
    }

    if (record.durationSeconds && record.durationSeconds > 0) {
      withDuration += 1;
      totalDurationSeconds += record.durationSeconds;
    }
  }

  const total = records.length;
  const longest = [...records]
    .filter((record) => (record.durationSeconds ?? 0) > 0)
    .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))
    .slice(0, LONG_LIMIT)
    .map(toBrief);

  const recentlyAdded = [...records]
    .filter((record) => record.timestamp)
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
    .slice(0, RECENT_LIMIT)
    .map(toBrief);

  const yearRanks = ranked(years, total, 40).sort((a, b) => a.label.localeCompare(b.label));

  return {
    platform,
    generatedAt: new Date().toISOString(),
    overview: {
      tracks: total,
      amiga,
      atari,
      cpc,
      c64,
      composers: composerSet.size,
      games: games.size,
      formats: formats.size,
      withDuration,
      withGame,
      totalDurationSeconds: Math.round(totalDurationSeconds),
      openmpt,
      exotic,
    },
    topAuthors: ranked(authors, total, TOP_LIMIT, (label) => UNKNOWN_AUTHOR.test(label)),
    topGames: ranked(games, total, TOP_LIMIT),
    formats: ranked(formats, total, FORMAT_LIMIT),
    years: yearRanks,
    longest,
    recentlyAdded,
  };
}
