import * as cheerio from 'cheerio';
import type { SearchField, Track } from '../types.js';

const SNDH_BASE = 'https://sndh.atari.org';

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
        return (
          title.includes(q) ||
          game.includes(q) ||
          notes.includes(q) ||
          (isGameTrack(track) && (title.includes(q) || notes.includes(q) || game.includes(q)))
        );
      case 'any':
      default:
        return title.includes(q) || artist.includes(q) || notes.includes(q) || game.includes(q);
    }
  });
}

async function fetchHtml(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(`${SNDH_BASE}${path}`, {
    ...init,
    headers: {
      'User-Agent': 'RetroMusicPlayer/1.0',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) return '';
  return response.text();
}

export async function searchSndh(query: string, field: SearchField = 'any'): Promise<Track[]> {
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

export async function getSndhTrack(id: string): Promise<Track | null> {
  const html = await fetchHtml(`/?ID=${id}`);
  if (!html) return null;

  const $ = cheerio.load(html);
  const title = $('h2').first().text().trim() || $('title').text().replace('SNDH Atari ST YM2149 collection', '').trim();
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
