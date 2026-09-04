import { useEffect, useRef, useState } from 'react';
import type { PlayerStatus } from './useMusicPlayer';
import type { Track } from '../types';
import { fetchMiniTooHealth, pushMiniTooNowPlaying } from '../lib/minitooClient';

type BridgeState = 'unknown' | 'offline' | 'daemon-offline' | 'online';

/** Progress bucket (seconds) — matches MiniToo `PROGRESS_BUCKET_S`. */
const POSITION_BUCKET_S = 1;

/**
 * When enabled, mirror the current track onto the MiniToo via the local HTTP bridge.
 * Pushes identity changes immediately and live position every ~2s while playing.
 */
export function useMiniTooNowPlaying(opts: {
  enabled: boolean;
  track: Track | null;
  status: PlayerStatus;
  duration: number;
  position: number;
}) {
  const { enabled, track, status, duration, position } = opts;
  const [bridge, setBridge] = useState<BridgeState>('unknown');
  const lastFp = useRef<string>('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBridge('unknown');
      return;
    }
    let cancelled = false;
    const tick = () => {
      void fetchMiniTooHealth().then((h) => {
        if (cancelled) return;
        if (!h) setBridge('offline');
        else if (!h.daemon) setBridge('daemon-offline');
        else setBridge('online');
      });
    };
    tick();
    const id = window.setInterval(tick, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !track) return;
    if (status === 'idle') return;

    const dur = duration > 0 ? duration : track.durationSeconds ?? 0;
    const posBucket =
      status === 'playing' || status === 'paused'
        ? Math.floor(Math.max(0, position) / POSITION_BUCKET_S)
        : '';

    const fp = [
      track.title,
      track.artist,
      track.game ?? '',
      track.platform,
      track.format,
      status,
      dur > 0 ? Math.round(dur) : '',
      posBucket,
    ].join('|');

    if (fp === lastFp.current) return;
    lastFp.current = fp;

    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void pushMiniTooNowPlaying({
        title: track.title,
        artist: track.artist,
        game: track.game ?? null,
        platform: track.platform,
        format: track.format,
        status,
        position: Math.max(0, position),
        duration: dur > 0 ? dur : null,
      }).then((res) => {
        if (!res.ok && res.error?.includes('Failed to fetch')) setBridge('offline');
        else if (!res.ok && res.error === 'daemon offline') setBridge('daemon-offline');
        else if (res.ok) setBridge('online');
      });
    }, 120);

    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [enabled, track, status, duration, position]);

  return { bridge };
}
