import { useCallback, useEffect, useRef, useState } from 'react';
import initYm2149, { Ym2149Player } from 'ym2149-wasm';
import type { Track } from '../types';
import { absoluteStreamUrl } from '../api';
import { TrackerPlayer } from '../lib/trackerPlayer';
import type { TrackerPlayback, TrackerSong } from '../utils/trackerFormat';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerState {
  status: PlayerStatus;
  currentTrack: Track | null;
  error: string | null;
  position: number;
  duration: number;
  trackerSong: TrackerSong | null;
  trackerPlayback: TrackerPlayback | null;
  analyser: AnalyserNode | null;
}

let ymInitPromise: Promise<void> | null = null;

async function ensureYmInit(): Promise<void> {
  if (!ymInitPromise) {
    ymInitPromise = initYm2149().then(() => undefined);
  }
  await ymInitPromise;
}

function toTrackerSong(meta: { song?: TrackerSong } | undefined): TrackerSong | null {
  if (!meta?.song?.patterns?.length) return null;
  return meta.song as TrackerSong;
}

export function useMusicPlayer() {
  const [state, setState] = useState<PlayerState>({
    status: 'idle',
    currentTrack: null,
    error: null,
    position: 0,
    duration: 0,
    trackerSong: null,
    trackerPlayback: null,
    analyser: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const trackerRef = useRef<TrackerPlayer | null>(null);
  const ymPlayerRef = useRef<Ym2149Player | null>(null);
  const ymNodeRef = useRef<ScriptProcessorNode | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  const clearProgressTimer = () => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const stopAll = useCallback(() => {
    clearProgressTimer();

    if (trackerRef.current) {
      trackerRef.current.stop();
      trackerRef.current = null;
    }

    if (ymNodeRef.current) {
      ymNodeRef.current.disconnect();
      ymNodeRef.current.onaudioprocess = null;
      ymNodeRef.current = null;
    }

    if (ymPlayerRef.current) {
      ymPlayerRef.current.stop();
      ymPlayerRef.current.free();
      ymPlayerRef.current = null;
    }
  }, []);

  const playSndh = useCallback(async (arrayBuffer: ArrayBuffer, ctx: AudioContext) => {
    await ensureYmInit();
    const player = new Ym2149Player(new Uint8Array(arrayBuffer));
    ymPlayerRef.current = player;
    player.play();

    const duration = player.metadata.duration_seconds || 120;
    const bufferSize = 2048;
    const scriptNode = ctx.createScriptProcessor(bufferSize, 0, 2);
    scriptNode.onaudioprocess = (event) => {
      if (!ymPlayerRef.current?.is_playing()) return;

      const samples = ymPlayerRef.current.generateSamples(bufferSize);
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      for (let i = 0; i < left.length; i += 1) {
        const sample = samples[i] ?? 0;
        left[i] = sample;
        right[i] = sample;
      }
    };

    scriptNode.connect(ctx.destination);
    ymNodeRef.current = scriptNode;

    const started = performance.now();
    progressTimerRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      const playing = ymPlayerRef.current?.is_playing() ?? false;
      setState((prev) => ({
        ...prev,
        position: Math.min(elapsed, duration),
        duration,
        status: !playing || elapsed >= duration ? 'idle' : 'playing',
      }));
      if (!playing || elapsed >= duration) {
        clearProgressTimer();
      }
    }, 200);

    setState((prev) => ({ ...prev, status: 'playing', duration }));
  }, []);

  const playMod = useCallback(async (arrayBuffer: ArrayBuffer, ctx: AudioContext) => {
    const player = new TrackerPlayer({ context: ctx });
    trackerRef.current = player;
    await player.init();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;

    if (player.processNode) {
      player.processNode.disconnect();
      player.gain.disconnect();
      player.processNode.connect(analyser);
      analyser.connect(player.gain);
      player.gain.connect(ctx.destination);
    }

    await new Promise<void>((resolve, reject) => {
      player.onMetadata((meta) => {
        setState((prev) => ({
          ...prev,
          duration: Number(meta.dur ?? player.duration ?? 0),
          trackerSong: toTrackerSong(meta as { song?: TrackerSong }),
          analyser,
        }));
      });
      player.onEnded(() => {
        clearProgressTimer();
        setState((prev) => ({
          ...prev,
          status: 'idle',
          position: 0,
          trackerPlayback: null,
        }));
      });
      player.onError(() => reject(new Error('Tracker playback failed')));
      player.onProgress((progress) => {
        setState((prev) => ({
          ...prev,
          position: progress.pos ?? player.getCurrentTime() ?? prev.position,
          trackerPlayback: {
            order: progress.order ?? 0,
            pattern: progress.pattern ?? 0,
            row: progress.row ?? 0,
          },
        }));
      });
      player.play(arrayBuffer);
      setState((prev) => ({ ...prev, status: 'playing', analyser }));
      resolve();
    });
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
        trackerSong: null,
        trackerPlayback: null,
        analyser: null,
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
          await playSndh(arrayBuffer, ctx);
          return;
        }

        await playMod(arrayBuffer, ctx);
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error.message : 'Playback failed',
        }));
      }
    },
    [playMod, playSndh, stopAll],
  );

  const pause = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.pause();
      setState((prev) => ({ ...prev, status: 'paused' }));
      return;
    }
    if (ymPlayerRef.current) {
      ymPlayerRef.current.pause();
      setState((prev) => ({ ...prev, status: 'paused' }));
    }
  }, []);

  const resume = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.unpause();
      setState((prev) => ({ ...prev, status: 'playing' }));
      return;
    }
    if (ymPlayerRef.current) {
      ymPlayerRef.current.play();
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
      trackerSong: null,
      trackerPlayback: null,
      analyser: null,
    });
  }, [stopAll]);

  useEffect(() => () => stopAll(), [stopAll]);

  return { ...state, playTrack, pause, resume, stop };
}
