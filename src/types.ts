export type MusicPlatform = 'amiga' | 'atari' | 'all';

export type SearchField = 'any' | 'author' | 'game' | 'title';

export interface LibrarySearch {
  query?: string;
  field?: SearchField;
  platform?: MusicPlatform;
}

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
  sources: Record<string, { connected: boolean; message: string }>;
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

export const SEARCH_FIELD_LABELS: Record<SearchField, string> = {
  any: 'Any field',
  author: 'Author / Composer',
  game: 'Game',
  title: 'Title',
};

export const SEARCH_FIELD_PLACEHOLDERS: Record<SearchField, string> = {
  any: 'Search titles, authors, games, notes…',
  author: 'Search by composer or artist name…',
  game: 'Search game soundtracks…',
  title: 'Search by song title…',
};
