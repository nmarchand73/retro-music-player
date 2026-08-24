import { SidAudioEngine } from 'libsidplayfp-wasm';
import {
  AudioFxBus,
  createAnalyser,
  wirePlaybackGraph,
  type AudioFxSettings,
} from './audioFxBus';

/** Cycles to request per ScriptProcessor fill (~20 ms chunks from libsidplayfp). */
const RENDER_CYCLES = 100_000;

function int16StereoToFloat32(
  pcm: Int16Array,
  left: Float32Array,
  right: Float32Array,
  frameOffset: number,
): number {
  const channels = 2;
  const availableFrames = Math.floor(pcm.length / channels);
  const want = left.length - frameOffset;
  const frames = Math.min(want, availableFrames);
  for (let i = 0; i < frames; i += 1) {
    const base = i * channels;
    left[frameOffset + i] = pcm[base]! / 32768;
    right[frameOffset + i] = pcm[base + 1]! / 32768;
  }
  return frames;
}

export class SidPlayer {
  private engine: SidAudioEngine | null = null;
  private node: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private paused = false;
  private seeking = false;
  private durationSeconds: number | null = null;
  private pending: Int16Array | null = null;
  private pendingOffset = 0;
  private ended = false;
  private voiceMuted: [boolean, boolean, boolean] = [false, false, false];
  private onEnded: (() => void) | null = null;
  private progressTimer: number | null = null;
  private onProgress: ((position: number, duration: number) => void) | null = null;

  async play(
    arrayBuffer: ArrayBuffer,
    ctx: AudioContext,
    durationSeconds?: number | null,
    fxBus?: AudioFxBus | null,
    fxSettings?: AudioFxSettings | null,
    /** 1-based song when known; omit to use the SID header start song. */
    song?: number | null,
  ): Promise<AnalyserNode> {
    this.stop();

    const engine = new SidAudioEngine({
      sampleRate: ctx.sampleRate,
      engine: 'sidlite',
      stereo: true,
      locateFile: (file) => `/sid/sidlite/${file.replace(/^.*\//, '')}`,
    });
    this.engine = engine;
    this.durationSeconds = durationSeconds != null && durationSeconds > 0 ? durationSeconds : null;
    this.paused = false;
    this.ended = false;
    this.voiceMuted = [false, false, false];

    const initialZeroBased =
      song != null && song > 0 ? Math.max(0, Math.round(song) - 1) : null;
    const buffer = new Uint8Array(arrayBuffer);
    if (initialZeroBased != null) {
      await engine.loadSidBuffer(buffer, initialZeroBased);
    } else {
      await engine.loadSidBuffer(buffer);
    }

    const analyser = createAnalyser(ctx);
    this.analyser = analyser;

    const bufferSize = 2048;
    const scriptNode = ctx.createScriptProcessor(bufferSize, 0, 2);
    scriptNode.onaudioprocess = (event) => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      if (!this.engine || this.paused || this.seeking || this.ended) {
        left.fill(0);
        right.fill(0);
        return;
      }

      let written = 0;
      while (written < left.length) {
        if (!this.pending || this.pendingOffset >= this.pending.length) {
          const chunk = this.engine.renderCycles(RENDER_CYCLES);
          if (!chunk || chunk.length === 0) {
            left.fill(0, written);
            right.fill(0, written);
            if (!this.ended) {
              this.ended = true;
              this.onEnded?.();
            }
            return;
          }
          this.pending = chunk;
          this.pendingOffset = 0;
        }

        const framesWritten = int16StereoToFloat32(
          this.pending.subarray(this.pendingOffset),
          left,
          right,
          written,
        );
        this.pendingOffset += framesWritten * 2;
        written += framesWritten;
        if (framesWritten === 0) break;
      }

      if (this.durationSeconds != null) {
        const position = this.engine.getTimeMs() / 1000;
        if (position >= this.durationSeconds) {
          left.fill(0);
          right.fill(0);
          if (!this.ended) {
            this.ended = true;
            this.paused = true;
            this.onEnded?.();
          }
        }
      }
    };

    if (fxBus) {
      if (fxSettings) {
        fxBus.setPlatformHint('c64');
        fxBus.applySettings(fxSettings);
      }
      try {
        fxBus.output.disconnect();
      } catch {
        // first connect
      }
      wirePlaybackGraph(scriptNode, fxBus, analyser, ctx.destination);
    } else {
      scriptNode.connect(analyser);
      analyser.connect(ctx.destination);
    }
    this.node = scriptNode;

    this.progressTimer = window.setInterval(() => {
      if (!this.engine || !this.onProgress) return;
      const position = this.engine.getTimeMs() / 1000;
      const duration = this.durationSeconds ?? 0;
      this.onProgress(position, duration);
    }, 200);

    return analyser;
  }

  /** 1-based song count / current song from the loaded tune. */
  getSubsongInfo(): { songs: number; currentSong: number } | null {
    const info = this.engine?.getTuneInfo();
    if (!info || info.songs < 1) return null;
    const current =
      info.currentSong > 0 ? info.currentSong : info.startSong > 0 ? info.startSong : 1;
    return { songs: info.songs, currentSong: Math.min(current, info.songs) };
  }

  /**
   * Switch to a 1-based song (matches Atari SNDH UI). SidAudioEngine uses 0-based indexes.
   */
  async selectSong(oneBased: number, durationSeconds?: number | null): Promise<number> {
    if (!this.engine) return 0;
    const info = this.engine.getTuneInfo();
    const songs = info?.songs && info.songs > 0 ? info.songs : 1;
    const next = Math.min(Math.max(1, Math.round(oneBased)), songs);
    await this.engine.selectSong(next - 1);
    this.pending = null;
    this.pendingOffset = 0;
    this.ended = false;
    this.paused = false;
    if (durationSeconds != null && durationSeconds > 0) {
      this.durationSeconds = durationSeconds;
    }
    this.applyVoiceMutes();
    return next;
  }

  setOnEnded(handler: (() => void) | null): void {
    this.onEnded = handler;
  }

  setOnProgress(handler: ((position: number, duration: number) => void) | null): void {
    this.onProgress = handler;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (this.ended) return;
    this.paused = false;
  }

  async seekSeconds(seconds: number): Promise<void> {
    if (!this.engine) return;
    const duration = this.durationSeconds;
    const next =
      duration != null && duration > 0
        ? Math.min(Math.max(0, seconds), duration)
        : Math.max(0, seconds);
    this.seeking = true;
    this.pending = null;
    this.pendingOffset = 0;
    try {
      await this.engine.seekSeconds(next);
      this.ended = duration != null && next >= duration;
      if (!this.ended) this.paused = false;
      this.applyVoiceMutes();
    } finally {
      this.seeking = false;
    }
  }

  getTimeMs(): number {
    return this.engine?.getTimeMs() ?? 0;
  }

  getDurationSeconds(): number | null {
    return this.durationSeconds;
  }

  setDurationSeconds(seconds: number | null): void {
    this.durationSeconds = seconds != null && seconds > 0 ? seconds : null;
  }

  /** Mute SID voice 0..2 on chip 0. libsidplayfp: enable=true silences the voice. */
  setVoiceMute(voice: number, mute: boolean): void {
    if (!this.engine || voice < 0 || voice > 2) return;
    this.voiceMuted[voice] = mute;
    this.engine.mute(0, voice, mute);
  }

  private applyVoiceMutes(): void {
    if (!this.engine) return;
    for (let voice = 0; voice < 3; voice += 1) {
      this.engine.mute(0, voice, this.voiceMuted[voice]!);
    }
  }

  stop(): void {
    if (this.progressTimer != null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    if (this.node) {
      this.node.disconnect();
      this.node.onaudioprocess = null;
      this.node = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }
    this.pending = null;
    this.pendingOffset = 0;
    this.paused = false;
    this.seeking = false;
    this.ended = false;
  }
}
