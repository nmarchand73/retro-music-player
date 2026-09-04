import { useEffect, useState } from 'react';
import { hydrateClientPrefs, persistPrefsPatch } from '../lib/clientPrefs';

const STORAGE_KEY = 'retro-music-player:minitoo';

export type MiniTooSettings = {
  enabled: boolean;
};

export const DEFAULT_MINITOO_SETTINGS: MiniTooSettings = {
  enabled: false,
};

export function parseMiniTooSettings(raw: unknown): MiniTooSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const enabled = (raw as { enabled?: unknown }).enabled;
  if (typeof enabled !== 'boolean') return null;
  return { enabled };
}

function loadSettings(): MiniTooSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MINITOO_SETTINGS;
    return parseMiniTooSettings(JSON.parse(raw) as unknown) ?? DEFAULT_MINITOO_SETTINGS;
  } catch {
    return DEFAULT_MINITOO_SETTINGS;
  }
}

function writeLocal(settings: MiniTooSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function persist(settings: MiniTooSettings): void {
  writeLocal(settings);
  persistPrefsPatch({ minitoo: settings });
}

export function useMiniTooSettings() {
  const [settings, setSettingsState] = useState<MiniTooSettings>(loadSettings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateClientPrefs().then((prefs) => {
      if (cancelled) return;
      const fromDisk = parseMiniTooSettings(prefs.minitoo);
      if (fromDisk) {
        writeLocal(fromDisk);
        setSettingsState(fromDisk);
      } else {
        persist(loadSettings());
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    persist(settings);
  }, [settings, ready]);

  const setEnabled = (enabled: boolean) => {
    setSettingsState({ enabled });
  };

  return { minitoo: settings, setMiniTooEnabled: setEnabled };
}
