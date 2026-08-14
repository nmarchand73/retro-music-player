import { XMLParser } from 'fast-xml-parser';
import type { SearchField, Track } from '../types.js';

const API_BASE = 'https://api.modarchive.org/xml-tools.php';

export type ModArchiveSearchType =
  | 'filename_or_songtitle'
  | 'filename_and_songtitle'
  | 'filename'
  | 'songtitle'
  | 'module_instruments'
  | 'module_comments';

interface ModArchiveModule {
  id?: string | number;
  filename?: string;
  songtitle?: string;
  artist?: string;
  bytes?: string | number;
  channels?: string | number;
  genre?: string;
  format?: string;
  timestamp?: string | number;
  comment?: string;
}

interface ModArchiveArtist {
  id?: string | number;
  alias?: string;
  realname?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function normalizeModules(payload: Record<string, unknown>): ModArchiveModule[] {
  const modules = payload.module;
  if (!modules) return [];
  return Array.isArray(modules) ? modules : [modules];
}

function normalizeArtists(payload: Record<string, unknown>): ModArchiveArtist[] {
  const items = payload.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

export function hasModArchiveKey(apiKey?: string): boolean {
  return Boolean(apiKey && apiKey !== 'your_key_here');
}

function formatsForPlatform(platform: 'amiga' | 'atari' | 'all'): string[] {
  if (platform === 'atari') return ['MOD', 'STM'];
  if (platform === 'amiga') return ['MOD', 'MED', 'XM', 'S3M', 'OKT'];
  return ['MOD', 'MED', 'XM', 'S3M', 'STM', 'OKT'];
}

function modToTrack(mod: ModArchiveModule, format: string): Track | null {
  const id = String(mod.id ?? '');
  if (!id) return null;

  return {
    id,
    source: 'modarchive',
    platform: format === 'STM' ? 'atari' : 'amiga',
    title: decodeHtml(String(mod.songtitle || mod.filename || 'Untitled')),
    artist: decodeHtml(String(mod.artist || 'Unknown')),
    format,
    sizeBytes: Number(mod.bytes) || undefined,
    channels: Number(mod.channels) || undefined,
    genre: decodeHtml(String(mod.genre || '')),
    notes: decodeHtml(String(mod.comment || '')),
    game: extractGameLabel(decodeHtml(String(mod.songtitle || '')), decodeHtml(String(mod.comment || '')), decodeHtml(String(mod.genre || ''))),
    timestamp: mod.timestamp ? new Date(Number(mod.timestamp) * 1000).toISOString() : undefined,
    streamUrl: `/api/stream/modarchive/${id}`,
    detailUrl: `https://modarchive.org/index.php?request=view&query=${id}`,
  };
}

function extractGameLabel(title: string, notes: string, genre: string): string | undefined {
  const haystack = `${title} ${notes} ${genre}`.toLowerCase();
  if (!/(game|soundtrack|ost|video game|from the)/i.test(haystack)) return undefined;
  const fromGame = notes.match(/from (?:the )?game(?: of the same name)?[:\s]+([^.;]+)/i);
  if (fromGame?.[1]) return fromGame[1].trim();
  return title.trim() || undefined;
}

function isGameTrack(track: Track): boolean {
  const haystack = `${track.title} ${track.notes ?? ''} ${track.genre ?? ''} ${track.game ?? ''}`.toLowerCase();
  return /(game|soundtrack|ost|video game|from the game|from the demo)/i.test(haystack);
}

async function fetchModArchiveModules(url: URL, format: string): Promise<Track[]> {
  const response = await fetch(url);
  if (!response.ok) return [];

  const parsed = parser.parse(await response.text()) as { modarchive?: Record<string, unknown>; error?: string };
  if (parsed.error) return [];

  return normalizeModules(parsed.modarchive ?? parsed)
    .slice(0, 15)
    .map((mod) => modToTrack(mod, format))
    .filter((track): track is Track => Boolean(track));
}

async function searchModArchiveByType(
  query: string,
  apiKey: string,
  platform: 'amiga' | 'atari' | 'all',
  searchType: ModArchiveSearchType | 'view_modules_by_guessed_artist',
): Promise<Track[]> {
  const formats = formatsForPlatform(platform);
  const results: Track[] = [];

  for (const format of formats) {
    const url = new URL(API_BASE);
    url.searchParams.set('key', apiKey);
    if (searchType === 'view_modules_by_guessed_artist') {
      url.searchParams.set('request', 'view_modules_by_guessed_artist');
      url.searchParams.set('query', query);
    } else {
      url.searchParams.set('request', 'search');
      url.searchParams.set('query', query || '*');
      url.searchParams.set('type', searchType);
    }
    url.searchParams.set('format', format);
    url.searchParams.set('page', '1');
    results.push(...(await fetchModArchiveModules(url, format)));
  }

  return results;
}

async function searchModArchiveByArtistId(
  artistId: string,
  apiKey: string,
  platform: 'amiga' | 'atari' | 'all',
): Promise<Track[]> {
  const formats = formatsForPlatform(platform);
  const results: Track[] = [];

  for (const format of formats) {
    const url = new URL(API_BASE);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('request', 'view_modules_by_artistid');
    url.searchParams.set('query', artistId);
    url.searchParams.set('format', format);
    url.searchParams.set('page', '1');
    results.push(...(await fetchModArchiveModules(url, format)));
  }

  return results;
}

async function searchModArchiveArtists(query: string, apiKey: string): Promise<ModArchiveArtist[]> {
  const url = new URL(API_BASE);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('request', 'search_artist');
  url.searchParams.set('query', query);
  url.searchParams.set('page', '1');

  const response = await fetch(url);
  if (!response.ok) return [];

  const parsed = parser.parse(await response.text()) as { modarchive?: Record<string, unknown>; error?: string };
  if (parsed.error) return [];
  return normalizeArtists(parsed.modarchive ?? parsed).slice(0, 3);
}

function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const key = `${track.source}:${track.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterGameTracks(tracks: Track[], query: string): Track[] {
  const q = query.trim().toLowerCase();
  return tracks.filter((track) => {
    if (!isGameTrack(track)) return false;
    if (!q) return true;
    const haystack = `${track.title} ${track.artist} ${track.notes ?? ''} ${track.game ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

export async function searchModArchive(
  query: string,
  apiKey: string | undefined,
  platform: 'amiga' | 'atari' | 'all',
  field: SearchField = 'any',
): Promise<Track[]> {
  if (!hasModArchiveKey(apiKey)) return [];

  let results: Track[] = [];

  switch (field) {
    case 'author': {
      const guessed = await searchModArchiveByType(query, apiKey!, platform, 'view_modules_by_guessed_artist');
      results = guessed;
      if (results.length === 0) {
        const artists = await searchModArchiveArtists(query, apiKey!);
        for (const artist of artists) {
          if (!artist.id) continue;
          results.push(...(await searchModArchiveByArtistId(String(artist.id), apiKey!, platform)));
        }
      }
      break;
    }
    case 'game': {
      const [comments, titles] = await Promise.all([
        searchModArchiveByType(query, apiKey!, platform, 'module_comments'),
        searchModArchiveByType(query, apiKey!, platform, 'songtitle'),
      ]);
      results = filterGameTracks([...comments, ...titles], query);
      break;
    }
    case 'title':
      results = await searchModArchiveByType(query, apiKey!, platform, 'songtitle');
      break;
    case 'any':
    default: {
      const [general, comments, instruments] = await Promise.all([
        searchModArchiveByType(query, apiKey!, platform, 'filename_or_songtitle'),
        query ? searchModArchiveByType(query, apiKey!, platform, 'module_comments') : Promise.resolve([]),
        query ? searchModArchiveByType(query, apiKey!, platform, 'module_instruments') : Promise.resolve([]),
      ]);
      results = [...general, ...comments, ...instruments];
      break;
    }
  }

  return dedupeTracks(results).slice(0, 30);
}

export async function getModArchiveTrack(id: string, apiKey?: string): Promise<Track | null> {
  if (!hasModArchiveKey(apiKey)) return null;

  const url = new URL(API_BASE);
  url.searchParams.set('key', apiKey!);
  url.searchParams.set('request', 'view_by_moduleid');
  url.searchParams.set('query', id);

  const response = await fetch(url);
  if (!response.ok) return null;

  const parsed = parser.parse(await response.text()) as { modarchive?: Record<string, unknown>; error?: string };
  if (parsed.error) return null;

  const mod = normalizeModules(parsed.modarchive ?? parsed)[0];
  if (!mod) return null;

  const format = String(mod.format || 'MOD').toUpperCase();
  return modToTrack(mod, format);
}

export function modArchiveDownloadUrl(id: string): string {
  return `https://api.modarchive.org/downloads.php?moduleid=${id}`;
}
