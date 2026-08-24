export interface VgmPlayInstance {
  init(options?: { audioContext?: AudioContext }): Promise<void>;
  playFromBuffer(data: Uint8Array, filename: string, loopCount?: number): Promise<boolean>;
  pause(): void;
  play(): void;
  stop(): void;
  hasEnded(): boolean;
  masterGain: GainNode | null;
  context: AudioContext | null;
  isPlaybackPaused: boolean;
}

declare global {
  interface Window {
    vgmPlayInstance?: VgmPlayInstance;
  }
}

let bridgePromise: Promise<VgmPlayInstance> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function getVgmPlayer(): Promise<VgmPlayInstance> {
  if (!bridgePromise) {
    bridgePromise = loadScript('/vgmplay/vgmplay-bridge.js').then(() => {
      const instance = window.vgmPlayInstance;
      if (!instance) {
        throw new Error('VGM player bridge did not initialize');
      }
      return instance;
    });
  }
  return bridgePromise;
}

export function vgmFilename(format: string): string {
  const ext = format.trim().replace(/^\./, '').toLowerCase();
  return ext === 'vgz' ? 'track.vgz' : 'track.vgm';
}
