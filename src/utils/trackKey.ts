import type { Track } from '../types';

export function trackKey(track: Track): string {
  return `${track.source}:${track.id}`;
}
