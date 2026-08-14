import type { Track } from './types.js';

export const localCatalog: Track[] = [
  {
    id: 'demo-amiga-1',
    source: 'local',
    platform: 'amiga',
    title: 'Space Debris',
    artist: 'LMan',
    format: 'MOD',
    channels: 4,
    genre: 'Chiptune',
    notes: 'Classic Amiga demo tune — browse Mod Archive for thousands more.',
    streamUrl: '/api/stream/local/demo-amiga-1',
    detailUrl: 'https://modarchive.org/',
  },
  {
    id: 'demo-amiga-2',
    source: 'local',
    platform: 'amiga',
    title: 'Enigma',
    artist: 'Skylord',
    format: 'MOD',
    channels: 4,
    genre: 'Demo',
    notes: 'Representative Amiga tracker module.',
    streamUrl: '/api/stream/local/demo-amiga-2',
    detailUrl: 'https://amp.dascene.net/',
  },
  {
    id: 'demo-atari-1',
    source: 'local',
    platform: 'atari',
    title: 'Second Reality 2013',
    artist: 'Dma-Sc',
    format: 'SNDH',
    genre: 'Demo',
    notes: 'Iconic Atari ST YM2149 chiptune from the SNDH archive.',
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
    notes: 'Atari ST game soundtrack from sndh.atari.org.',
    streamUrl: '/api/stream/local/demo-atari-2',
    detailUrl: 'https://sndh.atari.org/',
  },
];

export function searchLocalCatalog(query: string, platform: 'amiga' | 'atari' | 'all'): Track[] {
  const q = query.trim().toLowerCase();
  return localCatalog.filter((track) => {
    if (platform !== 'all' && track.platform !== platform) return false;
    if (!q) return true;
    return (
      track.title.toLowerCase().includes(q) ||
      track.artist.toLowerCase().includes(q) ||
      track.format.toLowerCase().includes(q) ||
      (track.genre?.toLowerCase().includes(q) ?? false)
    );
  });
}

export function getLocalTrack(id: string): Track | undefined {
  return localCatalog.find((track) => track.id === id);
}
