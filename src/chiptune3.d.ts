declare module 'chiptune3' {
  export interface ChiptuneMetadata {
    dur?: number;
    title?: string;
    artist?: string;
    song?: {
      channels: string[];
      patterns: Array<{
        name: string;
        rows: number[][][];
      }>;
      orders: Array<{ name: string; pat: number }>;
    };
  }

  export interface ChiptuneProgress {
    pos?: number;
    order?: number;
    pattern?: number;
    row?: number;
  }

  export interface ChiptuneConfig {
    repeatCount?: number;
    stereoSeparation?: number;
    interpolationFilter?: number;
    context?: AudioContext;
  }

  export class ChiptuneJsPlayer {
    constructor(cfg?: ChiptuneConfig);
    duration?: number;
    meta?: ChiptuneMetadata;
    gain: GainNode;
    processNode?: AudioWorkletNode;
    onInitialized(handler: () => void): void;
    onEnded(handler: () => void): void;
    onError(handler: (error: { type?: string }) => void): void;
    onMetadata(handler: (meta: ChiptuneMetadata) => void): void;
    onProgress(handler: (progress: ChiptuneProgress) => void): void;
    play(value: ArrayBuffer): void;
    pause(): void;
    unpause(): void;
    stop(): void;
    getCurrentTime(): number | undefined;
  }
}
