import { matchesAllTokens, searchTokens } from '../searchQuery.js';
import type { SearchField, Track } from './types.js';

export const localCatalog: Track[] = [
  {
    id: 'demo-atari-1',
    source: 'local',
    platform: 'atari',
    title: 'Second Reality 2013',
    artist: 'Dma-Sc',
    format: 'SNDH',
    genre: 'Demo',
    notes: 'From the demo with the same title. Sommarhack 2026',
    year: '2013',
    streamUrl: '/api/stream/local/demo-atari-1',
    detailUrl: 'https://sndh.atari.org/',
  },
  {
    id: 'demo-atari-2',
    source: 'local',
    platform: 'atari',
    title: 'Batman The Movie',
    artist: 'Matthew Cannon',
    format: 'SNDH',
    genre: 'Game',
    game: 'Batman The Movie',
    year: '1989',
    notes: 'From the game of the same name. Atari ST game soundtrack.',
    streamUrl: '/api/stream/local/demo-atari-2',
    detailUrl: 'https://sndh.atari.org/',
  },
];

function trackHaystack(track: Track, field: SearchField): string {
  const title = track.title;
  const artist = track.artist;
  const notes = track.notes ?? '';
  const genre = track.genre ?? '';
  const game = track.game ?? '';

  switch (field) {
    case 'author':
      return artist;
    case 'title':
      return title;
    case 'game':
      return `${game} ${title} ${notes} ${genre}`;
    case 'any':
      return `${title} ${artist} ${notes} ${genre} ${game} ${track.format}`;
    default: {
      const _exhaustive: never = field;
      throw new Error(`Unhandled search field: ${_exhaustive}`);
    }
  }
}

function matchesField(track: Track, q: string, field: SearchField): boolean {
  const tokens = searchTokens(q);
  if (tokens.length === 0) {
    if (field === 'game') {
      const haystack = trackHaystack(track, 'game').toLowerCase();
      return haystack.includes('game') || Boolean(track.game);
    }
    return true;
  }

  return matchesAllTokens(trackHaystack(track, field), tokens);
}

export function searchLocalCatalog(
  query: string,
  platform: 'amiga' | 'atari' | 'cpc' | 'c64' | 'all',
  field: SearchField = 'any',
): Track[] {
  const q = query.trim().toLowerCase();
  return localCatalog.filter((track) => {
    if (platform !== 'all' && track.platform !== platform) return false;
    return matchesField(track, q, field);
  });
}

export function getLocalTrack(id: string): Track | undefined {
  return localCatalog.find((track) => track.id === id);
}
