import { useCallback, useEffect, useState } from 'react';
import { hydrateTrackCovers } from '../api';
import type { Track } from '../types';
import { trackKey } from '../utils/trackKey';

const STORAGE_KEY = 'retro-music-player.bookmarks';

function loadBookmarks(): Track[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrack);
  } catch {
    return [];
  }
}

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false;
  const track = value as Track;
  return (
    typeof track.id === 'string' &&
    typeof track.source === 'string' &&
    typeof track.title === 'string' &&
    typeof track.artist === 'string' &&
    typeof track.streamUrl === 'string'
  );
}

function persist(next: Track[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function coversChanged(before: Track[], after: Track[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((track, index) => {
    const next = after[index];
    return !next || trackKey(track) !== trackKey(next) || track.coverUrl !== next.coverUrl || track.game !== next.game;
  });
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Track[]>(loadBookmarks);

  useEffect(() => {
    const stored = loadBookmarks();
    if (stored.length === 0) return;
    let cancelled = false;
    void hydrateTrackCovers(stored)
      .then((hydrated) => {
        if (cancelled || !coversChanged(stored, hydrated)) return;
        persist(hydrated);
        setBookmarks(hydrated);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const isBookmarked = useCallback(
    (track: Track) => bookmarks.some((entry) => trackKey(entry) === trackKey(track)),
    [bookmarks],
  );

  const toggleBookmark = useCallback((track: Track) => {
    const key = trackKey(track);
    let added = false;
    setBookmarks((prev) => {
      if (prev.some((entry) => trackKey(entry) === key)) {
        const next = prev.filter((entry) => trackKey(entry) !== key);
        persist(next);
        return next;
      }
      added = true;
      const next = [track, ...prev];
      persist(next);
      return next;
    });
    if (!added) return;
    void hydrateTrackCovers([track])
      .then(([hydrated]) => {
        if (!hydrated) return;
        setBookmarks((prev) => {
          const index = prev.findIndex((entry) => trackKey(entry) === key);
          if (index < 0) return prev;
          const current = prev[index];
          if (!current || (current.coverUrl === hydrated.coverUrl && current.game === hydrated.game)) {
            return prev;
          }
          const next = [...prev];
          next[index] = hydrated;
          persist(next);
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  return { bookmarks, isBookmarked, toggleBookmark };
}
