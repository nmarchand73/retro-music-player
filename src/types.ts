export type MusicPlatform = 'amiga' | 'atari' | 'cpc' | 'c64' | 'all';

export type SearchField = 'any' | 'author' | 'game' | 'title';

export interface LibrarySearch {
  query?: string;
  field?: SearchField;
  platform?: MusicPlatform;
}

export type TrackSource = 'sndh' | 'local' | 'amiga' | 'cpc' | 'c64';

export interface Track {
  id: string;
  source: TrackSource;
  platform: 'amiga' | 'atari' | 'cpc' | 'c64';
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
  platform: 'amiga' | 'atari' | 'cpc' | 'c64' | 'both';
  url: string;
  apiUrl?: string;
  connected: boolean;
  requiresKey: boolean;
  stats?: string;
}

export interface InsightRank {
  label: string;
  count: number;
  amigaCount: number;
  atariCount: number;
  cpcCount: number;
  c64Count: number;
  share: number;
  coverUrl?: string;
}

export interface InsightTrackBrief {
  id: string;
  source: 'amiga' | 'sndh' | 'cpc' | 'c64';
  platform: 'amiga' | 'atari' | 'cpc' | 'c64';
  title: string;
  artist: string;
  game?: string;
  format: string;
  durationSeconds?: number;
  timestamp?: string;
  streamUrl: string;
  coverUrl?: string;
}

export interface InsightsResponse {
  platform: MusicPlatform;
  generatedAt: string;
  overview: {
    tracks: number;
    amiga: number;
    atari: number;
    cpc: number;
    c64: number;
    composers: number;
    games: number;
    formats: number;
    withDuration: number;
    withGame: number;
    totalDurationSeconds: number;
    openmpt: number;
    exotic: number;
  };
  topAuthors: InsightRank[];
  topGames: InsightRank[];
  formats: InsightRank[];
  years: InsightRank[];
  longest: InsightTrackBrief[];
  recentlyAdded: InsightTrackBrief[];
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
