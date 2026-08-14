import * as cheerio from 'cheerio';
import type { Track } from '../types.js';

const SNDH_BASE = 'https://sndh.atari.org';

function parseRow($: cheerio.CheerioAPI, row: cheerio.Element): Track | null {
  const cells = $(row).find('td');
  if (cells.length < 4) return null;

  let titleLink = cells.find('a[href^="/?ID="], a[href^="?ID="]').first();
  if (!titleLink.length) return null;

  const href = titleLink.attr('href');
  const idMatch = href?.match(/ID=(\d+)/i);
  if (!idMatch) return null;

  const id = idMatch[1];
  const title = titleLink.text().trim();
  const artistLink = cells.find('a[href*="p=composer"]').first();
  const artist = artistLink.text().trim() || 'Unknown';
  const notes = cells.last().text().trim();

  return {
    id,
    source: 'sndh',
    platform: 'atari',
    title: title || 'Untitled',
    artist,
    format: 'SNDH',
    notes: notes && notes !== title && notes !== artist ? notes : undefined,
    streamUrl: `/api/stream/sndh/${id}`,
    detailUrl: `${SNDH_BASE}/?ID=${id}`,
  };
}

function parseSearchResults(html: string): Track[] {
  const $ = cheerio.load(html);
  const tracks: Track[] = [];

  $('table tr').each((_, row) => {
    const track = parseRow($, row);
    if (track) tracks.push(track);
  });

  return tracks;
}

export async function searchSndh(query: string): Promise<Track[]> {
  if (!query.trim()) {
    return fetchRecentSndh();
  }

  const body = new URLSearchParams({ searchword: query });
  const response = await fetch(`${SNDH_BASE}/?p=searchdone`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'RetroMusicPlayer/1.0',
    },
    body,
  });

  if (!response.ok) return [];
  return parseSearchResults(await response.text()).slice(0, 25);
}

async function fetchRecentSndh(): Promise<Track[]> {
  const response = await fetch(`${SNDH_BASE}/`, {
    headers: { 'User-Agent': 'RetroMusicPlayer/1.0' },
  });
  if (!response.ok) return [];
  return parseSearchResults(await response.text()).slice(0, 20);
}

export async function getSndhTrack(id: string): Promise<Track | null> {
  const response = await fetch(`${SNDH_BASE}/?ID=${id}`, {
    headers: { 'User-Agent': 'RetroMusicPlayer/1.0' },
  });
  if (!response.ok) return null;

  const $ = cheerio.load(await response.text());
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
