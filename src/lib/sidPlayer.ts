import { SidAudioEngine } from 'libsidplayfp-wasm';

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
  private onEnded: (() => void) | null = null;
  private progressTimer: number | null = null;
  private onProgress: ((position: number, duration: number) => void) | null = null;

  async play(
    arrayBuffer: ArrayBuffer,
    ctx: AudioContext,
    durationSeconds?: number | null,
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

    await engine.loadSidBuffer(new Uint8Array(arrayBuffer));

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.22;
    analyser.minDecibels = -92;
    analyser.maxDecibels = -18;
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

    scriptNode.connect(analyser);
    analyser.connect(ctx.destination);
    this.node = scriptNode;

    this.progressTimer = window.setInterval(() => {
      if (!this.engine || !this.onProgress) return;
      const position = this.engine.getTimeMs() / 1000;
      const duration = this.durationSeconds ?? 0;
      this.onProgress(position, duration);
    }, 200);

    return analyser;
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
