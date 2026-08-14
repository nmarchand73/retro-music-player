import { useCallback, useEffect, useRef, useState } from 'react';
import { ChiptuneJsPlayer } from 'chiptune3';
import initYm2149, { Ym2149Player } from 'ym2149-wasm';
import type { Track } from '../types';
import { absoluteStreamUrl } from '../api';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerState {
  status: PlayerStatus;
  currentTrack: Track | null;
  error: string | null;
  position: number;
  duration: number;
}

let ymInitPromise: Promise<void> | null = null;

async function ensureYmInit(): Promise<void> {
  if (!ymInitPromise) {
    ymInitPromise = initYm2149().then(() => undefined);
  }
  await ymInitPromise;
}

export function useMusicPlayer() {
  const [state, setState] = useState<PlayerState>({
    status: 'idle',
    currentTrack: null,
    error: null,
    position: 0,
    duration: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const chiptuneRef = useRef<ChiptuneJsPlayer | null>(null);
  const ymSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  const clearProgressTimer = () => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const stopAll = useCallback(() => {
    clearProgressTimer();

    if (chiptuneRef.current) {
      chiptuneRef.current.stop();
      chiptuneRef.current = null;
    }

    if (ymSourceRef.current) {
      try {
        ymSourceRef.current.stop();
      } catch {
        // already stopped
      }
      ymSourceRef.current = null;
    }
  }, []);

  const playTrack = useCallback(
    async (track: Track) => {
      stopAll();
      setState({
        status: 'loading',
        currentTrack: track,
        error: null,
        position: 0,
        duration: 0,
      });

      try {
        const url = absoluteStreamUrl(track.streamUrl);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Could not load audio file');
        const arrayBuffer = await response.arrayBuffer();

        const ctx = audioContextRef.current ?? new AudioContext();
        audioContextRef.current = ctx;
        if (ctx.state === 'suspended') await ctx.resume();

        if (track.format.toUpperCase() === 'SNDH') {
          await ensureYmInit();
          const player = new Ym2149Player(new Uint8Array(arrayBuffer));
          const duration = player.metadata.duration_seconds || 120;
          const sampleRate = 44100;
          const totalSamples = Math.floor(duration * sampleRate);
          const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
          const channel = audioBuffer.getChannelData(0);
          const frameSize = 4096;
          let offset = 0;

          while (offset < totalSamples) {
            const samples = player.generateSamples(frameSize);
            for (let i = 0; i < samples.length && offset < totalSamples; i += 1) {
              channel[offset] = samples[i];
              offset += 1;
            }
          }

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => {
            clearProgressTimer();
            setState((prev) => ({ ...prev, status: 'idle', position: 0 }));
          };
          source.start();
          ymSourceRef.current = source;

          const started = performance.now();
          progressTimerRef.current = window.setInterval(() => {
            const elapsed = (performance.now() - started) / 1000;
            setState((prev) => ({
              ...prev,
              position: Math.min(elapsed, duration),
              duration,
              status: elapsed >= duration ? 'idle' : 'playing',
            }));
          }, 200);

          setState((prev) => ({ ...prev, status: 'playing', duration }));
          return;
        }

        await new Promise<void>((resolve, reject) => {
          const player = new ChiptuneJsPlayer({ context: ctx });
          chiptuneRef.current = player;

          player.onInitialized(() => {
            player.onMetadata((meta: { dur?: number }) => {
              setState((prev) => ({
                ...prev,
                duration: meta.dur ?? player.duration ?? 0,
              }));
            });
            player.onEnded(() => {
              clearProgressTimer();
              setState((prev) => ({ ...prev, status: 'idle', position: 0 }));
            });
            player.onError(() => reject(new Error('Tracker playback failed')));
            player.onProgress((progress: { pos?: number }) => {
              setState((prev) => ({
                ...prev,
                position: progress.pos ?? player.getCurrentTime() ?? prev.position,
              }));
            });
            player.play(arrayBuffer);
            setState((prev) => ({ ...prev, status: 'playing' }));
            resolve();
          });
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Playback failed',
        }));
      }
    },
    [stopAll],
  );

  const pause = useCallback(() => {
    if (chiptuneRef.current) {
      chiptuneRef.current.pause();
      setState((prev) => ({ ...prev, status: 'paused' }));
    }
  }, []);

  const resume = useCallback(() => {
    if (chiptuneRef.current) {
      chiptuneRef.current.unpause();
      setState((prev) => ({ ...prev, status: 'playing' }));
    }
  }, []);

  const stop = useCallback(() => {
    stopAll();
    setState({
      status: 'idle',
      currentTrack: null,
      error: null,
      position: 0,
      duration: 0,
    });
  }, [stopAll]);

  useEffect(() => () => stopAll(), [stopAll]);

  return { ...state, playTrack, pause, resume, stop };
}
