import { useCallback, useEffect, useState } from 'react';
import { hydrateTrackCovers } from '../api';
import { hydrateClientPrefs, persistPrefsPatch } from '../lib/clientPrefs';
import type { Track } from '../types';
import { trackKey } from '../utils/trackKey';

const STORAGE_KEY = 'retro-music-player.bookmarks';

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

function parseBookmarks(raw: unknown): Track[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(isTrack);
}

function loadBookmarks(): Track[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parseBookmarks(JSON.parse(raw) as unknown) ?? [];
  } catch {
    return [];
  }
}

function writeLocal(next: Track[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function persist(next: Track[]): void {
  writeLocal(next);
  persistPrefsPatch({ bookmarks: next });
}

/** Catalog fields refreshed from the live index (covers, songs, origin, …). */
function catalogFieldsChanged(before: Track, after: Track): boolean {
  return (
    before.coverUrl !== after.coverUrl ||
    before.game !== after.game ||
    before.subsongCount !== after.subsongCount ||
    JSON.stringify(before.songDurations ?? null) !== JSON.stringify(after.songDurations ?? null) ||
    before.durationSeconds !== after.durationSeconds ||
    before.originalGame !== after.originalGame ||
    before.originKind !== after.originKind ||
    before.title !== after.title ||
    before.artist !== after.artist ||
    before.year !== after.year ||
    before.notes !== after.notes ||
    before.format !== after.format ||
    before.platform !== after.platform
  );
}

function bookmarksNeedPersist(before: Track[], after: Track[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((track, index) => {
    const next = after[index];
    return !next || trackKey(track) !== trackKey(next) || catalogFieldsChanged(track, next);
  });
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Track[]>(loadBookmarks);

  useEffect(() => {
    let cancelled = false;
    void hydrateClientPrefs()
      .then((prefs) => {
        if (cancelled) return;
        const fromDisk = parseBookmarks(prefs.bookmarks);
        const stored = fromDisk ?? loadBookmarks();
        if (fromDisk) {
          writeLocal(fromDisk);
          setBookmarks(fromDisk);
        } else if (stored.length > 0) {
          persist(stored);
        }
        if (stored.length === 0) return;
        // Re-pull live index metadata (subsongCount, origin, covers, …) for saved titles.
        return hydrateTrackCovers(stored).then((hydrated) => {
          if (cancelled || !bookmarksNeedPersist(stored, hydrated)) return;
          persist(hydrated);
          setBookmarks(hydrated);
        });
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
          if (!current || !catalogFieldsChanged(current, hydrated)) {
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

  const patchBookmark = useCallback((track: Track, patch: Partial<Track>) => {
    const key = trackKey(track);
    setBookmarks((prev) => {
      const index = prev.findIndex((entry) => trackKey(entry) === key);
      if (index < 0) return prev;
      const current = prev[index];
      if (!current) return prev;
      const nextTrack = { ...current, ...patch };
      if (!catalogFieldsChanged(current, nextTrack)) {
        return prev;
      }
      const next = [...prev];
      next[index] = nextTrack;
      persist(next);
      return next;
    });
  }, []);

  return { bookmarks, isBookmarked, toggleBookmark, patchBookmark };
}
