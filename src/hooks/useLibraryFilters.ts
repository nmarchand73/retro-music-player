import { useCallback, useEffect, useState } from 'react';
import { hydrateClientPrefs, persistPrefsPatch } from '../lib/clientPrefs';

const STORAGE_KEY = 'retro-music-player.library-filters';

export type LibraryFilters = {
  /** Hide demos, remixes, conversions, and covers. */
  originalOnly: boolean;
  /** Hide formats the current engines cannot play. */
  playableOnly: boolean;
};

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  originalOnly: true,
  playableOnly: true,
};

function parseFilters(raw: unknown): LibraryFilters | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const next = { ...DEFAULT_LIBRARY_FILTERS };
  if (typeof record.originalOnly === 'boolean') next.originalOnly = record.originalOnly;
  if (typeof record.playableOnly === 'boolean') next.playableOnly = record.playableOnly;
  return next;
}

function loadFilters(): LibraryFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LIBRARY_FILTERS };
    return parseFilters(JSON.parse(raw) as unknown) ?? { ...DEFAULT_LIBRARY_FILTERS };
  } catch {
    return { ...DEFAULT_LIBRARY_FILTERS };
  }
}

function writeLocal(filters: LibraryFilters): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

function persist(filters: LibraryFilters): void {
  writeLocal(filters);
  persistPrefsPatch({ libraryFilters: filters });
}

export function useLibraryFilters() {
  const [filters, setFilters] = useState<LibraryFilters>(loadFilters);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateClientPrefs().then((prefs) => {
      if (cancelled) return;
      const fromDisk = parseFilters(prefs.libraryFilters);
      if (fromDisk) {
        writeLocal(fromDisk);
        setFilters(fromDisk);
      } else {
        persist(loadFilters());
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    persist(filters);
  }, [filters, ready]);

  const setOriginalOnly = useCallback((originalOnly: boolean) => {
    setFilters((prev) => (prev.originalOnly === originalOnly ? prev : { ...prev, originalOnly }));
  }, []);

  const setPlayableOnly = useCallback((playableOnly: boolean) => {
    setFilters((prev) => (prev.playableOnly === playableOnly ? prev : { ...prev, playableOnly }));
  }, []);

  return {
    filters,
    originalOnly: filters.originalOnly,
    playableOnly: filters.playableOnly,
    setOriginalOnly,
    setPlayableOnly,
  };
}
