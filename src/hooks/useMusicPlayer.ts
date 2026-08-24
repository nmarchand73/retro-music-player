import { useCallback, useEffect, useRef, useState } from 'react';
import initYm2149, { Ym2149Player } from 'ym2149-wasm';
import type { Track } from '../types';
import { absoluteStreamUrl } from '../api';
import {
  AudioFxBus,
  createAnalyser,
  DEFAULT_AUDIO_FX_SETTINGS,
  wirePlaybackGraph,
  type AudioFxSettings,
  type FxPlatformHint,
} from '../lib/audioFxBus';
import { SidPlayer } from '../lib/sidPlayer';
import { TrackerPlayer } from '../lib/trackerPlayer';
import type { TrackerPlayback, TrackerSong } from '../utils/trackerFormat';
import { parseSndhSubtuneCount, parseSndhTiming } from '../utils/sndhTiming';

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

/** Chip channel mute state for YM (A/B/C) or SID (1/2/3). */
export type ChipChannelMutes = {
  kind: 'ym' | 'sid' | 'mod';
  muted: [boolean, boolean, boolean];
};

const OPEN_CHANNELS: ChipChannelMutes['muted'] = [false, false, false];

interface PlayerState {
  status: PlayerStatus;
  currentTrack: Track | null;
  error: string | null;
  position: number;
  duration: number;
  trackerSong: TrackerSong | null;
  trackerPlayback: TrackerPlayback | null;
  analyser: AnalyserNode | null;
  channelMutes: ChipChannelMutes | null;
  /** 1-based SNDH/YM subsong when the file has more than one. */
  subsong: number | null;
  subsongCount: number;
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

export function useMusicPlayer(audioFx: AudioFxSettings = DEFAULT_AUDIO_FX_SETTINGS) {
  const [state, setState] = useState<PlayerState>({
    status: 'idle',
    currentTrack: null,
    error: null,
    position: 0,
    duration: 0,
    trackerSong: null,
    trackerPlayback: null,
    analyser: null,
    channelMutes: null,
    subsong: null,
    subsongCount: 0,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const trackerRef = useRef<TrackerPlayer | null>(null);
  const sidPlayerRef = useRef<SidPlayer | null>(null);
  const sidSongDurationsRef = useRef<number[] | null>(null);
  const ymPlayerRef = useRef<Ym2149Player | null>(null);
  const ymNodeRef = useRef<ScriptProcessorNode | null>(null);
  const ymBytesRef = useRef<Uint8Array | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fxBusRef = useRef<AudioFxBus | null>(null);
  const fxSettingsRef = useRef(audioFx);
  fxSettingsRef.current = audioFx;
  const ymPausedRef = useRef(false);
  const ymDurationRef = useRef<number | null>(null);
  const ymRateRef = useRef(50);
  const ymSamplesOutRef = useRef(0);
  const ymOutputRateRef = useRef(YM_SAMPLE_RATE);
  const ymSeekingRef = useRef(false);
  const endedRef = useRef(false);
  const onEndedRef = useRef<(() => void) | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    fxBusRef.current?.applySettings(audioFx);
  }, [audioFx]);

  useEffect(
    () => () => {
      fxBusRef.current?.dispose();
      fxBusRef.current = null;
    },
    [],
  );

  const ensureFxBus = useCallback((ctx: AudioContext) => {
    if (!fxBusRef.current || fxBusRef.current.context !== ctx) {
      fxBusRef.current?.dispose();
      fxBusRef.current = new AudioFxBus(ctx);
    }
    fxBusRef.current.applySettings(fxSettingsRef.current);
    return fxBusRef.current;
  }, []);

  const connectThroughFx = useCallback(
    (source: AudioNode, ctx: AudioContext, hint: FxPlatformHint) => {
      const bus = ensureFxBus(ctx);
      bus.setPlatformHint(hint);
      bus.applySettings(fxSettingsRef.current);
      try {
        bus.output.disconnect();
      } catch {
        // first connect
      }
      const analyser = createAnalyser(ctx);
      wirePlaybackGraph(source, bus, analyser, ctx.destination);
      return analyser;
    },
    [ensureFxBus],
  );

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

    if (sidPlayerRef.current) {
      sidPlayerRef.current.stop();
      sidPlayerRef.current = null;
    }
    sidSongDurationsRef.current = null;

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
    ymBytesRef.current = null;

    if (audioElRef.current) {
      audioElRef.current.onended = null;
      audioElRef.current.ontimeupdate = null;
      audioElRef.current.pause();
      audioElRef.current.removeAttribute('src');
      audioElRef.current.load();
      audioElRef.current = null;
    }
    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect();
      mediaSourceRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }

    ymDurationRef.current = null;
    ymSamplesOutRef.current = 0;
    endedRef.current = false;
  }, []);

  const playSndh = useCallback(async (arrayBuffer: ArrayBuffer, ctx: AudioContext, hint: FxPlatformHint) => {
    await ensureYmInit();
    const bytes = new Uint8Array(arrayBuffer);
    ymBytesRef.current = bytes;
    const player = new Ym2149Player(bytes);
    ymPlayerRef.current = player;

    const headerCount = parseSndhSubtuneCount(bytes);
    const wasmCount = player.subsongCount();
    const count = Math.max(1, headerCount, wasmCount > 0 ? wasmCount : 1);
    // Subtune 1 = digi samples + YM chip mixed together (Goldrunner, etc.).
    // Subtune 2 is chip-only when present — switchable in the player UI.
    const initialSubsong = 1;
    player.setSubsong(initialSubsong);

    player.play();
    ymPausedRef.current = false;
    endedRef.current = false;

    const timing = parseSndhTiming(bytes, initialSubsong);
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

    const analyser = connectThroughFx(scriptNode, ctx, hint);
    ymNodeRef.current = scriptNode;

    for (let channel = 0; channel < 3; channel += 1) {
      player.set_channel_mute(channel, false);
    }

    progressTimerRef.current = window.setInterval(() => {
      const current = ymPlayerRef.current;
      if (!current) return;

      const outputRate = ymOutputRateRef.current || YM_SAMPLE_RATE;
      const position = outputRate > 0 ? ymSamplesOutRef.current / outputRate : 0;
      const trackDuration = ymDurationRef.current;
      const finished = trackDuration != null && position >= trackDuration;
      const clamped = trackDuration != null ? Math.min(position, trackDuration) : position;

      if (finished) {
        if (endedRef.current) return;
        endedRef.current = true;
        current.pause();
        ymPausedRef.current = true;
        setState((prev) => ({
          ...prev,
          position: clamped,
          duration: trackDuration ?? 0,
          status: 'idle',
        }));
        onEndedRef.current?.();
        return;
      }

      endedRef.current = false;

      if (ymPausedRef.current) {
        setState((prev) => ({ ...prev, position: clamped, duration: trackDuration ?? 0 }));
        return;
      }

      setState((prev) => ({
        ...prev,
        position: clamped,
        duration: trackDuration ?? 0,
        status: current.is_playing() ? 'playing' : 'idle',
      }));
    }, 200);

    setState((prev) => ({
      ...prev,
      status: 'playing',
      duration: duration ?? 0,
      analyser,
      channelMutes: { kind: 'ym', muted: [...OPEN_CHANNELS] },
      subsong: count > 1 ? initialSubsong : null,
      subsongCount: count > 1 ? count : 0,
    }));
  }, [connectThroughFx]);

  const playWav = useCallback(async (
    arrayBuffer: ArrayBuffer,
    ctx: AudioContext,
    hint: FxPlatformHint = 'amiga',
  ) => {
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const objectUrl = URL.createObjectURL(blob);
    audioObjectUrlRef.current = objectUrl;

    const audio = new Audio(objectUrl);
    audio.preload = 'auto';
    audioElRef.current = audio;

    const source = ctx.createMediaElementSource(audio);
    mediaSourceRef.current = source;
    const analyser = connectThroughFx(source, ctx, hint);

    audio.ontimeupdate = () => {
      setState((prev) => ({
        ...prev,
        position: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : prev.duration,
        status: audio.paused ? (endedRef.current ? 'idle' : 'paused') : 'playing',
      }));
    };
    audio.onended = () => {
      endedRef.current = true;
      setState((prev) => ({
        ...prev,
        status: 'idle',
        position: prev.duration,
        trackerPlayback: null,
      }));
      onEndedRef.current?.();
    };

    await audio.play();
    setState((prev) => ({
      ...prev,
      status: 'playing',
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      trackerSong: null,
      trackerPlayback: null,
      analyser,
      channelMutes: null,
    }));
  }, [connectThroughFx]);

  const playSid = useCallback(async (arrayBuffer: ArrayBuffer, ctx: AudioContext, track: Track) => {
    const player = new SidPlayer();
    sidPlayerRef.current = player;
    sidSongDurationsRef.current = track.songDurations ?? null;
    endedRef.current = false;

    player.setOnEnded(() => {
      if (endedRef.current) return;
      endedRef.current = true;
      setState((prev) => ({
        ...prev,
        status: 'idle',
        position: prev.duration || prev.position,
        trackerPlayback: null,
      }));
      onEndedRef.current?.();
    });
    player.setOnProgress((position, duration) => {
      const capped =
        duration > 0 ? Math.min(position, duration) : position;
      if (duration > 0 && position >= duration) {
        if (!endedRef.current) {
          endedRef.current = true;
          player.pause();
          setState((prev) => ({
            ...prev,
            position: capped,
            duration,
            status: 'idle',
          }));
          onEndedRef.current?.();
        }
        return;
      }
      setState((prev) => ({
        ...prev,
        position: capped,
        duration: duration > 0 ? duration : prev.duration,
        status: 'playing',
      }));
    });

    const bus = ensureFxBus(ctx);
    const analyser = await player.play(
      arrayBuffer,
      ctx,
      track.durationSeconds,
      bus,
      fxSettingsRef.current,
    );
    for (let voice = 0; voice < 3; voice += 1) {
      player.setVoiceMute(voice, false);
    }
    const meta = player.getSubsongInfo();
    const count = Math.max(1, track.subsongCount ?? 0, meta?.songs ?? 0);
    const current = meta?.currentSong && meta.currentSong > 0 ? meta.currentSong : 1;
    const songDuration =
      track.songDurations?.[current - 1] ??
      track.songDurations?.[0] ??
      track.durationSeconds ??
      null;
    if (songDuration != null && songDuration > 0) {
      player.setDurationSeconds(songDuration);
    }
    setState((prev) => ({
      ...prev,
      status: 'playing',
      duration: songDuration ?? 0,
      trackerSong: null,
      trackerPlayback: null,
      analyser,
      channelMutes: { kind: 'sid', muted: [...OPEN_CHANNELS] },
      subsong: count > 1 ? current : null,
      subsongCount: count > 1 ? count : 0,
    }));
  }, [ensureFxBus]);

  const playMod = useCallback(async (arrayBuffer: ArrayBuffer, ctx: AudioContext) => {
    const player = new TrackerPlayer({ context: ctx });
    trackerRef.current = player;
    await player.init();

    if (player.processNode) {
      player.processNode.disconnect();
      player.gain.disconnect();
      const analyser = connectThroughFx(player.processNode, ctx, 'amiga');

      await new Promise<void>((resolve, reject) => {
        player.onMetadata((meta) => {
          setState((prev) => ({
            ...prev,
            duration: Number(meta.dur ?? player.duration ?? 0),
            trackerSong: toTrackerSong(meta as { song?: TrackerSong }),
            analyser,
            channelMutes: { kind: 'mod', muted: [...OPEN_CHANNELS] },
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
        setState((prev) => ({
          ...prev,
          status: 'playing',
          analyser,
          channelMutes: prev.channelMutes ?? { kind: 'mod', muted: [...OPEN_CHANNELS] },
        }));
        resolve();
      });
      return;
    }

    throw new Error('Tracker worklet failed to initialize');
  }, [connectThroughFx]);

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
        channelMutes: null,
        subsong: null,
        subsongCount: 0,
      });

      try {
        const url = absoluteStreamUrl(track.streamUrl);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Could not load audio file');
        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') ?? '';
        const engine = response.headers.get('x-playback-engine') ?? '';

        const ctx = audioContextRef.current ?? new AudioContext();
        audioContextRef.current = ctx;
        if (ctx.state === 'suspended') await ctx.resume();

        // Digi SNDH (Goldrunner, …) is rendered server-side with psgplay — same family as
        // https://sndh.atari.org/ — because ym2149-wasm only plays a short digi burst then silence.
        if (
          engine === 'uade' ||
          engine === 'psgplay' ||
          contentType.includes('audio/wav') ||
          contentType.includes('audio/wave')
        ) {
          const hint: FxPlatformHint =
            engine === 'psgplay' || track.platform === 'atari' || track.format.toUpperCase() === 'SNDH'
              ? 'atari'
              : 'amiga';
          await playWav(arrayBuffer, ctx, hint);
          return;
        }

        if (
          track.format.toUpperCase() === 'SNDH' ||
          track.format.toUpperCase() === 'AY' ||
          track.format.toUpperCase() === 'YM' ||
          track.platform === 'cpc'
        ) {
          const hint: FxPlatformHint =
            track.platform === 'cpc' || track.format.toUpperCase() === 'YM' || track.format.toUpperCase() === 'AY'
              ? 'cpc'
              : 'atari';
          await playSndh(arrayBuffer, ctx, hint);
          return;
        }

        if (
          track.format.toUpperCase() === 'SID' ||
          track.platform === 'c64' ||
          engine === 'sid'
        ) {
          await playSid(arrayBuffer, ctx, track);
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
    [playMod, playSid, playSndh, playWav, stopAll],
  );

  const pause = useCallback(() => {
    if (trackerRef.current) {
      trackerRef.current.pause();
      setState((prev) => ({ ...prev, status: 'paused' }));
      return;
    }
    if (sidPlayerRef.current) {
      sidPlayerRef.current.pause();
      setState((prev) => ({ ...prev, status: 'paused' }));
      return;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
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
    if (sidPlayerRef.current) {
      sidPlayerRef.current.resume();
      setState((prev) => ({ ...prev, status: 'playing' }));
      return;
    }
    if (audioElRef.current) {
      void audioElRef.current.play().then(() => {
        setState((prev) => ({ ...prev, status: 'playing' }));
      });
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
      channelMutes: null,
      subsong: null,
      subsongCount: 0,
    });
  }, [stopAll]);

  const setSubsong = useCallback((index: number) => {
    const sid = sidPlayerRef.current;
    if (sid) {
      const meta = sid.getSubsongInfo();
      const count = Math.max(1, meta?.songs ?? 1);
      const next = Math.min(Math.max(Math.round(index), 1), count);
      if (count <= 1) return false;
      if (meta?.currentSong === next) return true;

      void (async () => {
        const durations = sidSongDurationsRef.current;
        const songDuration =
          durations?.[next - 1] ?? (next === 1 ? durations?.[0] : undefined) ?? null;
        const applied = await sid.selectSong(next, songDuration);
        if (applied < 1) return;
        endedRef.current = false;
        setState((prev) => ({
          ...prev,
          position: 0,
          duration: songDuration ?? 0,
          status: 'playing',
          subsong: applied,
          subsongCount: count,
          channelMutes: prev.channelMutes?.kind === 'sid'
            ? prev.channelMutes
            : { kind: 'sid', muted: [...OPEN_CHANNELS] },
        }));
      })();
      return true;
    }

    const ym = ymPlayerRef.current;
    const bytes = ymBytesRef.current;
    if (!ym || !bytes) return false;

    const count = Math.max(1, parseSndhSubtuneCount(bytes), ym.subsongCount() || 1);
    const next = Math.min(Math.max(Math.round(index), 1), count);
    if (count <= 1) return false;
    if (ym.currentSubsong() === next) return true;

    const ok = ym.setSubsong(next);
    if (!ok) return false;

    const timing = parseSndhTiming(bytes, next);
    const wasmRate = ym.metadata.frame_rate;
    const rateHz = wasmRate > 0 ? wasmRate : timing.rateHz > 0 ? timing.rateHz : 50;
    const wasmFrames = ym.frame_count() || ym.metadata.frame_count;
    const wasmSeconds = ym.metadata.duration_seconds;
    const duration =
      (timing.frames != null && timing.frames > 0 ? timing.frames / rateHz : null) ??
      timing.seconds ??
      (wasmFrames > 0 && rateHz > 0 ? wasmFrames / rateHz : null) ??
      (wasmSeconds > 0 ? wasmSeconds : null);

    ymDurationRef.current = duration;
    ymRateRef.current = rateHz;
    ymSamplesOutRef.current = 0;
    endedRef.current = false;
    ymPausedRef.current = false;
    for (let channel = 0; channel < 3; channel += 1) {
      ym.set_channel_mute(channel, false);
    }
    ym.play();

    setState((prev) => ({
      ...prev,
      position: 0,
      duration: duration ?? 0,
      status: 'playing',
      subsong: next,
      subsongCount: count,
      channelMutes: { kind: 'ym', muted: [...OPEN_CHANNELS] },
    }));
    return true;
  }, []);

  const setChannelMute = useCallback((index: 0 | 1 | 2, mute: boolean) => {
    const ym = ymPlayerRef.current;
    if (ym) {
      ym.set_channel_mute(index, mute);
      setState((prev) => {
        if (!prev.channelMutes || prev.channelMutes.kind !== 'ym') {
          const muted: ChipChannelMutes['muted'] = [...OPEN_CHANNELS];
          muted[index] = mute;
          return { ...prev, channelMutes: { kind: 'ym', muted } };
        }
        const muted: ChipChannelMutes['muted'] = [...prev.channelMutes.muted];
        muted[index] = mute;
        return { ...prev, channelMutes: { kind: 'ym', muted } };
      });
      return;
    }

    const sid = sidPlayerRef.current;
    if (sid) {
      sid.setVoiceMute(index, mute);
      setState((prev) => {
        if (!prev.channelMutes || prev.channelMutes.kind !== 'sid') {
          const muted: ChipChannelMutes['muted'] = [...OPEN_CHANNELS];
          muted[index] = mute;
          return { ...prev, channelMutes: { kind: 'sid', muted } };
        }
        const muted: ChipChannelMutes['muted'] = [...prev.channelMutes.muted];
        muted[index] = mute;
        return { ...prev, channelMutes: { kind: 'sid', muted } };
      });
      return;
    }

    const tracker = trackerRef.current;
    if (tracker) {
      tracker.setChannelMute(index, mute);
      setState((prev) => {
        if (!prev.channelMutes || prev.channelMutes.kind !== 'mod') {
          const muted: ChipChannelMutes['muted'] = [...OPEN_CHANNELS];
          muted[index] = mute;
          return { ...prev, channelMutes: { kind: 'mod', muted } };
        }
        const muted: ChipChannelMutes['muted'] = [...prev.channelMutes.muted];
        muted[index] = mute;
        return { ...prev, channelMutes: { kind: 'mod', muted } };
      });
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioElRef.current;
    if (audio) {
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      const next =
        duration != null && duration > 0
          ? Math.min(Math.max(0, seconds), duration)
          : Math.max(0, seconds);
      audio.currentTime = next;
      endedRef.current = duration != null && next >= duration;
      setState((prev) => ({
        ...prev,
        position: next,
        status: audio.paused ? 'paused' : 'playing',
      }));
      return;
    }

    const sid = sidPlayerRef.current;
    if (sid) {
      const duration = sid.getDurationSeconds();
      const next =
        duration != null && duration > 0
          ? Math.min(Math.max(0, seconds), duration)
          : Math.max(0, seconds);
      void sid.seekSeconds(next).then(() => {
        endedRef.current = duration != null && next >= duration;
        setState((prev) => ({
          ...prev,
          position: next,
          status: endedRef.current ? 'idle' : 'playing',
        }));
      });
      return;
    }

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

  return { ...state, playTrack, pause, resume, stop, seek, setChannelMute, setSubsong, setOnEnded };
}
