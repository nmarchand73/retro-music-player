import { useEffect, useState } from 'react';
import {
  DEFAULT_AUDIO_FX_SETTINGS,
  type AudioFxSettings,
  type FxPreset,
} from '../lib/audioFxBus';
import { hydrateClientPrefs, persistPrefsPatch } from '../lib/clientPrefs';

const STORAGE_KEY = 'retro-music-player:audio-fx';

function parseAudioFx(raw: unknown): AudioFxSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<AudioFxSettings>;
  const preset: FxPreset =
    parsed.preset === 'authentic' || parsed.preset === 'modern' || parsed.preset === 'hall'
      ? parsed.preset
      : DEFAULT_AUDIO_FX_SETTINGS.preset;
  const amount =
    typeof parsed.amount === 'number' && Number.isFinite(parsed.amount)
      ? Math.min(1, Math.max(0, parsed.amount))
      : DEFAULT_AUDIO_FX_SETTINGS.amount;
  return {
    enabled: Boolean(parsed.enabled),
    preset,
    amount,
  };
}

function loadSettings(): AudioFxSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_FX_SETTINGS };
    return parseAudioFx(JSON.parse(raw) as unknown) ?? { ...DEFAULT_AUDIO_FX_SETTINGS };
  } catch {
    return { ...DEFAULT_AUDIO_FX_SETTINGS };
  }
}

function writeLocal(settings: AudioFxSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function persist(settings: AudioFxSettings): void {
  writeLocal(settings);
  persistPrefsPatch({ audioFx: settings });
}

export function useAudioFxSettings() {
  const [audioFx, setAudioFx] = useState<AudioFxSettings>(loadSettings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateClientPrefs().then((prefs) => {
      if (cancelled) return;
      const fromDisk = parseAudioFx(prefs.audioFx);
      if (fromDisk) {
        writeLocal(fromDisk);
        setAudioFx(fromDisk);
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
    persist(audioFx);
  }, [audioFx, ready]);

  const setEnabled = (enabled: boolean) => {
    setAudioFx((prev) => ({
      ...prev,
      enabled,
      preset: enabled && prev.preset === 'authentic' ? 'modern' : prev.preset,
    }));
  };

  const setPreset = (preset: FxPreset) => {
    setAudioFx((prev) => ({
      ...prev,
      preset,
      enabled: preset !== 'authentic',
    }));
  };

  const setAmount = (amount: number) => {
    setAudioFx((prev) => ({
      ...prev,
      amount: Math.min(1, Math.max(0, amount)),
    }));
  };

  return { audioFx, setEnabled, setPreset, setAmount };
}
