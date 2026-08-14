import type { DatabaseInfo, MusicPlatform, SearchField, SearchResponse, Track, InsightsResponse } from './types';

const API_BASE = '/api';

export async function fetchDatabases(): Promise<DatabaseInfo[]> {
  const response = await fetch(`${API_BASE}/databases`);
  if (!response.ok) throw new Error('Failed to load databases');
  const data = (await response.json()) as { databases: DatabaseInfo[] };
  return data.databases;
}

export async function searchTracks(
  query: string,
  platform: MusicPlatform,
  field: SearchField,
  playableOnly = true,
  machines?: string,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    platform,
    field,
    playable: playableOnly ? '1' : '0',
  });
  if (machines) params.set('machines', machines);
  const response = await fetch(`${API_BASE}/search?${params}`);
  if (!response.ok) throw new Error('Search failed');
  return response.json() as Promise<SearchResponse>;
}

export async function fetchInsights(
  platform: MusicPlatform = 'all',
  machines?: string,
): Promise<InsightsResponse> {
  const params = new URLSearchParams({ platform });
  if (machines) params.set('machines', machines);
  const response = await fetch(`${API_BASE}/insights?${params}`);
  if (!response.ok) throw new Error('Failed to load insights');
  return response.json() as Promise<InsightsResponse>;
}

export async function fetchTrack(source: string, id: string): Promise<Track> {
  const response = await fetch(`${API_BASE}/track/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('Track not found');
  return response.json() as Promise<Track>;
}

export async function reportAmigaDuration(id: string, seconds: number): Promise<Track | null> {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const response = await fetch(
    `${API_BASE}/track/amiga/${encodeURIComponent(id)}/duration`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
    },
  );
  if (!response.ok) return null;
  return response.json() as Promise<Track>;
}

export async function hydrateTrackCovers(tracks: Track[]): Promise<Track[]> {
  if (tracks.length === 0) return tracks;
  const response = await fetch(`${API_BASE}/covers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracks }),
  });
  if (!response.ok) throw new Error('Cover hydrate failed');
  const data = (await response.json()) as { tracks: Track[] };
  if (!Array.isArray(data.tracks)) return tracks;
  const byKey = new Map(data.tracks.map((track) => [`${track.source}:${track.id}`, track]));
  return tracks.map((track) => byKey.get(`${track.source}:${track.id}`) ?? track);
}

export function absoluteStreamUrl(streamUrl: string): string {
  return streamUrl.startsWith('http') ? streamUrl : streamUrl;
}
