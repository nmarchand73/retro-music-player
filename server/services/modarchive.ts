import { XMLParser } from 'fast-xml-parser';
import type { Track } from '../types.js';

const API_BASE = 'https://api.modarchive.org/xml-tools.php';

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

export function hasModArchiveKey(apiKey?: string): boolean {
  return Boolean(apiKey && apiKey !== 'your_key_here');
}

export async function searchModArchive(
  query: string,
  apiKey: string | undefined,
  platform: 'amiga' | 'atari' | 'all',
): Promise<Track[]> {
  if (!hasModArchiveKey(apiKey)) return [];

  const formats =
    platform === 'atari'
      ? ['MOD', 'STM']
      : platform === 'amiga'
        ? ['MOD', 'MED', 'XM', 'S3M', 'OKT']
        : ['MOD', 'MED', 'XM', 'S3M', 'STM', 'OKT'];

  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const results: Track[] = [];

  for (const format of formats) {
    const url = new URL(API_BASE);
    url.searchParams.set('key', apiKey!);
    url.searchParams.set('request', 'search');
    url.searchParams.set('query', query || '*');
    url.searchParams.set('type', 'filename_or_songtitle');
    url.searchParams.set('format', format);
    url.searchParams.set('page', '1');

    const response = await fetch(url);
    if (!response.ok) continue;

    const xml = await response.text();
    const parsed = parser.parse(xml) as { modarchive?: Record<string, unknown>; error?: string };
    if (parsed.error) continue;

    const modules = normalizeModules(parsed.modarchive ?? parsed);
    for (const mod of modules.slice(0, 12)) {
      const id = String(mod.id ?? '');
      if (!id) continue;

      results.push({
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
        timestamp: mod.timestamp ? new Date(Number(mod.timestamp) * 1000).toISOString() : undefined,
        streamUrl: `/api/stream/modarchive/${id}`,
        detailUrl: `https://modarchive.org/index.php?request=view&query=${id}`,
      });
    }
  }

  const seen = new Set<string>();
  return results.filter((track) => {
    const key = `${track.source}:${track.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getModArchiveTrack(id: string, apiKey?: string): Promise<Track | null> {
  if (!hasModArchiveKey(apiKey)) return null;

  const url = new URL(API_BASE);
  url.searchParams.set('key', apiKey!);
  url.searchParams.set('request', 'view_by_moduleid');
  url.searchParams.set('query', id);

  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const response = await fetch(url);
  if (!response.ok) return null;

  const parsed = parser.parse(await response.text()) as { modarchive?: Record<string, unknown>; error?: string };
  if (parsed.error) return null;

  const mod = normalizeModules(parsed.modarchive ?? parsed)[0];
  if (!mod) return null;

  const format = String(mod.format || 'MOD').toUpperCase();

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
    streamUrl: `/api/stream/modarchive/${id}`,
    detailUrl: `https://modarchive.org/index.php?request=view&query=${id}`,
  };
}

export function modArchiveDownloadUrl(id: string): string {
  return `https://api.modarchive.org/downloads.php?moduleid=${id}`;
}
