import { useCallback, useEffect, useRef, useState } from 'react';
import initYm2149, { Ym2149Player } from 'ym2149-wasm';
import type { Track } from '../types';
import { absoluteStreamUrl } from '../api';
import { TrackerPlayer } from '../lib/trackerPlayer';
import type { TrackerPlayback, TrackerSong } from '../utils/trackerFormat';
import { parseSndhTiming } from '../utils/sndhTiming';

const YM_SAMPLE_RATE = 44100;

const SEEK_FRAME_TOLERANCE = 2;
const SEEK_SAMPLE_CHUNK = YM_SAMPLE_RATE * 4;

function discardYmSamples(ym: Ym2149Player, sampleCount: number): void {
  let left = Math.max(0, Math.round(sampleCount));
  while (left > 0) {
    const chunk = Math.min(left, SEEK_SAMPLE_CHUNK);
    ym.generateSamples(chunk);
    left -= chunk;
  }
}

function seekYmPlayer(
  ym: Ym2149Player,
  seconds: number,
  rateHz: number,
  currentSeconds: number,
  paused: boolean,
): void {
  const safeRate = rateHz > 0 ? rateHz : 50;
  const frame = Math.max(0, Math.floor(seconds * safeRate));
  const currentFrame = Math.max(0, Math.floor(currentSeconds * safeRate));
  const before = ym.frame_position();
  ym.seek_to_frame(frame);
  const after = ym.frame_position();
  const onTarget = Math.abs(after - frame) <= SEEK_FRAME_TOLERANCE;
  const wasmMoved = after !== before;
  const alreadyThere = Math.abs(currentFrame - frame) <= SEEK_FRAME_TOLERANCE;
  if (onTarget && (wasmMoved || alreadyThere)) {
    if (paused) ym.pause();
    else ym.play();
    return;
  }

  // 0.8.x SNDH seek_to_frame is a no-op; fast-forward by generating discarded samples.
  if (seconds + 0.05 < currentSeconds) {
    ym.restart();
  }
  ym.play();
  const startFrame = seconds + 0.05 < currentSeconds ? 0 : currentFrame;
  discardYmSamples(ym, Math.max(0, frame - startFrame) * (YM_SAMPLE_RATE / safeRate));
  if (paused) ym.pause();
}

function copyOrResample(source: Float32Array, target: Float32Array): void {
  if (source.length === target.length) {
    target.set(source);
    return;
  }
  if (source.length === 0) {
    target.fill(0);
    return;
  }
  const ratio = source.length / target.length;
  for (let i = 0; i < target.length; i += 1) {
    const srcIndex = i * ratio;
    const leftIndex = Math.min(Math.floor(srcIndex), source.length - 1);
    const rightIndex = Math.min(leftIndex + 1, source.length - 1);
    const mix = srcIndex - leftIndex;
    target[i] = source[leftIndex] * (1 - mix) + source[rightIndex] * mix;
  }
}

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
  const ymPausedRef = useRef(false);
  const ymDurationRef = useRef<number | null>(null);
  const ymRateRef = useRef(50);
  const ymSamplesOutRef = useRef(0);
  const ymOutputRateRef = useRef(YM_SAMPLE_RATE);
  const ymSeekingRef = useRef(false);
  const endedRef = useRef(false);
  const onEndedRef = useRef<(() => void) | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  const clearProgressTimer = () => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const stopAll = useCallback(() => {
    clearProgressTimer();
    ymPausedRef.current = false;

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

    ymDurationRef.current = null;
    ymSamplesOutRef.current = 0;
    endedRef.current = false;
  }, []);

  const playSndh = useCallback(async (arrayBuffer: ArrayBuffer, ctx: AudioContext) => {
    await ensureYmInit();
    const player = new Ym2149Player(new Uint8Array(arrayBuffer));
    ymPlayerRef.current = player;
    player.play();
    ymPausedRef.current = false;
    endedRef.current = false;

    const timing = parseSndhTiming(new Uint8Array(arrayBuffer), player.currentSubsong());
    const wasmRate = player.metadata.frame_rate;
    const rateHz = wasmRate > 0 ? wasmRate : timing.rateHz > 0 ? timing.rateHz : 50;
    const wasmFrames = player.frame_count() || player.metadata.frame_count;
    const wasmSeconds = player.metadata.duration_seconds;
    const duration =
      (timing.frames != null && timing.frames > 0 ? timing.frames / rateHz : null) ??
      timing.seconds ??
      (wasmFrames > 0 && rateHz > 0 ? wasmFrames / rateHz : null) ??
      (wasmSeconds > 0 ? wasmSeconds : null);
    ymDurationRef.current = duration;
    ymRateRef.current = rateHz;
    ymSamplesOutRef.current = 0;
    ymOutputRateRef.current = YM_SAMPLE_RATE;

    const bufferSize = 2048;
    const scriptNode = ctx.createScriptProcessor(bufferSize, 0, 2);
    scriptNode.onaudioprocess = (event) => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      const current = ymPlayerRef.current;
      if (!current || ymPausedRef.current || ymSeekingRef.current || !current.is_playing()) {
        left.fill(0);
        right.fill(0);
        return;
      }

      const outputRate = ctx.sampleRate || YM_SAMPLE_RATE;
      const want = Math.max(1, Math.round((left.length * YM_SAMPLE_RATE) / outputRate));
      const samples = current.generateSamples(want);
      copyOrResample(samples, left);
      right.set(left);
      ymSamplesOutRef.current += samples.length;
    };

    scriptNode.connect(ctx.destination);
    ymNodeRef.current = scriptNode;

    progressTimerRef.current = window.setInterval(() => {
      const current = ymPlayerRef.current;
      if (!current) return;

      const outputRate = ymOutputRateRef.current || YM_SAMPLE_RATE;
      const position = outputRate > 0 ? ymSamplesOutRef.current / outputRate : 0;
      const finished = duration != null && position >= duration;
      const clamped = duration != null ? Math.min(position, duration) : position;

      if (finished) {
        if (!endedRef.current) {
          endedRef.current = true;
          current.pause();
          ymPausedRef.current = true;
          setState((prev) => ({
            ...prev,
            position: clamped,
            duration: duration ?? 0,
            status: 'idle',
          }));
          onEndedRef.current?.();
        }
        return;
      }

      endedRef.current = false;

      if (ymPausedRef.current) {
        setState((prev) => ({ ...prev, position: clamped, duration: duration ?? 0 }));
        return;
      }

      setState((prev) => ({
        ...prev,
        position: clamped,
        duration: duration ?? 0,
        status: current.is_playing() ? 'playing' : 'idle',
      }));
    }, 200);

    setState((prev) => ({ ...prev, status: 'playing', duration: duration ?? 0 }));
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
        setState((prev) => ({
          ...prev,
          status: 'idle',
          position: prev.duration,
          trackerPlayback: null,
        }));
        onEndedRef.current?.();
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
      ymPausedRef.current = true;
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
      ymPausedRef.current = false;
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

  const seek = useCallback((seconds: number) => {
    const ym = ymPlayerRef.current;
    if (ym) {
      const duration = ymDurationRef.current;
      const rateHz = ymRateRef.current > 0 ? ymRateRef.current : 50;
      const outputRate = ymOutputRateRef.current || YM_SAMPLE_RATE;
      const next =
        duration != null && duration > 0
          ? Math.min(Math.max(0, seconds), duration)
          : Math.max(0, seconds);
      const currentSeconds = outputRate > 0 ? ymSamplesOutRef.current / outputRate : 0;
      ymSeekingRef.current = true;
      try {
        seekYmPlayer(ym, next, rateHz, currentSeconds, ymPausedRef.current);
      } finally {
        ymSeekingRef.current = false;
      }
      ymSamplesOutRef.current = Math.round(next * outputRate);
      endedRef.current = duration != null && next >= duration;
      setState((prev) => ({
        ...prev,
        position: next,
        status: ymPausedRef.current ? 'paused' : 'playing',
      }));
      return;
    }

    const tracker = trackerRef.current;
    if (!tracker) return;
    tracker.postMsg('seek', seconds);
    setState((prev) => ({ ...prev, position: seconds }));
  }, []);

  const setOnEnded = useCallback((handler: (() => void) | null) => {
    onEndedRef.current = handler;
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  return { ...state, playTrack, pause, resume, stop, seek, setOnEnded };
}
