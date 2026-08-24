import { useEffect, useState } from 'react';
import { hydrateClientPrefs, persistPrefsPatch } from '../lib/clientPrefs';
import {
  DEFAULT_VISUALIZER_MODE,
  parseVisualizerMode,
  type VisualizerMode,
} from '../utils/visualizerMode';

const STORAGE_KEY = 'retro-music-player:visualizer';

function loadMode(): VisualizerMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISUALIZER_MODE;
    return parseVisualizerMode(JSON.parse(raw) as unknown) ?? DEFAULT_VISUALIZER_MODE;
  } catch {
    return DEFAULT_VISUALIZER_MODE;
  }
}

function writeLocal(mode: VisualizerMode): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode }));
}

function persist(mode: VisualizerMode): void {
  writeLocal(mode);
  persistPrefsPatch({ visualizer: { mode } });
}

export function useVisualizerSettings() {
  const [mode, setModeState] = useState<VisualizerMode>(loadMode);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateClientPrefs().then((prefs) => {
      if (cancelled) return;
      const fromDisk = parseVisualizerMode(prefs.visualizer);
      if (fromDisk) {
        writeLocal(fromDisk);
        setModeState(fromDisk);
      } else {
        persist(loadMode());
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    persist(mode);
  }, [mode, ready]);

  const setMode = (next: VisualizerMode) => {
    setModeState(next);
  };

  return { visualizerMode: mode, setVisualizerMode: setMode };
}
