export type MusicPlatform = 'amiga' | 'atari' | 'all';

export type TrackSource = 'modarchive' | 'sndh' | 'local';

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
  notes?: string;
  timestamp?: string;
  streamUrl: string;
  detailUrl?: string;
}

export interface SearchResponse {
  query: string;
  platform: MusicPlatform;
  total: number;
  tracks: Track[];
  sources: {
    modarchive: { connected: boolean; message: string };
    sndh: { connected: boolean; message: string };
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
