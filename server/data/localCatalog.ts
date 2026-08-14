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
    notes: 'From the game of the same name. Atari ST game soundtrack.',
    streamUrl: '/api/stream/local/demo-atari-2',
    detailUrl: 'https://sndh.atari.org/',
  },
];

function matchesField(track: Track, q: string, field: SearchField): boolean {
  const title = track.title.toLowerCase();
  const artist = track.artist.toLowerCase();
  const notes = (track.notes ?? '').toLowerCase();
  const genre = (track.genre ?? '').toLowerCase();
  const game = (track.game ?? '').toLowerCase();

  if (field === 'game' && !game && !genre.includes('game') && !notes.includes('game')) {
    return false;
  }

  if (!q) return true;

  switch (field) {
    case 'author':
      return artist.includes(q);
    case 'title':
      return title.includes(q);
    case 'game':
      return title.includes(q) || game.includes(q) || notes.includes(q);
    case 'any':
      return (
        title.includes(q) ||
        artist.includes(q) ||
        notes.includes(q) ||
        genre.includes(q) ||
        game.includes(q) ||
        track.format.toLowerCase().includes(q)
      );
    default: {
      const _exhaustive: never = field;
      throw new Error(`Unhandled search field: ${_exhaustive}`);
    }
  }
}

export function searchLocalCatalog(
  query: string,
  platform: 'amiga' | 'atari' | 'all',
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
