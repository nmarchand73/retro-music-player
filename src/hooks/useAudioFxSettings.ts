import { useEffect, useState } from 'react';
import {
  DEFAULT_AUDIO_FX_SETTINGS,
  type AudioFxSettings,
  type FxPreset,
} from '../lib/audioFxBus';

const STORAGE_KEY = 'retro-music-player:audio-fx';

function loadSettings(): AudioFxSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_FX_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AudioFxSettings>;
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
  } catch {
    return { ...DEFAULT_AUDIO_FX_SETTINGS };
  }
}

function persist(settings: AudioFxSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useAudioFxSettings() {
  const [audioFx, setAudioFx] = useState<AudioFxSettings>(loadSettings);

  useEffect(() => {
    persist(audioFx);
  }, [audioFx]);

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
