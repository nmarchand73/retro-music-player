export type MusicPlatform = 'amiga' | 'atari' | 'all';

export type SearchField = 'any' | 'author' | 'game' | 'title';

export type TrackSource = 'sndh' | 'local' | 'amiga';

export interface Track {
  id: string;
  source: TrackSource;
  platform: 'amiga' | 'atari';
  title: string;
  artist: string;
  format: string;
  sizeBytes?: number;
  channels?: number;
  genre?: string;
  game?: string;
  notes?: string;
  year?: string;
  timestamp?: string;
  durationSeconds?: number;
  streamUrl: string;
  coverUrl?: string;
  detailUrl?: string;
}

export interface SearchResponse {
  query: string;
  platform: MusicPlatform;
  field: SearchField;
  total: number;
  tracks: Track[];
  sources: {
    sndh: { connected: boolean; message: string };
    amiga: { connected: boolean; message: string };
    local: { connected: boolean; message: string };
  };
}

export interface DatabaseInfo {
  id: string;
  name: string;
  description: string;
  platform: 'amiga' | 'atari' | 'both';
  url: string;
  apiUrl?: string;
  connected: boolean;
  requiresKey: boolean;
  stats?: string;
}
