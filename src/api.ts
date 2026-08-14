import type { DatabaseInfo, MusicPlatform, SearchField, SearchResponse, Track } from './types';

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
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, platform, field });
  const response = await fetch(`${API_BASE}/search?${params}`);
  if (!response.ok) throw new Error('Search failed');
  return response.json() as Promise<SearchResponse>;
}

export async function fetchTrack(source: string, id: string): Promise<Track> {
  const response = await fetch(`${API_BASE}/track/${source}/${id}`);
  if (!response.ok) throw new Error('Track not found');
  return response.json() as Promise<Track>;
}

export function absoluteStreamUrl(streamUrl: string): string {
  return streamUrl.startsWith('http') ? streamUrl : streamUrl;
}
