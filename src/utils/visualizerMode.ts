export const VISUALIZER_MODES = ['spectrum3d', 'pianoRoll'] as const;

export type VisualizerMode = (typeof VISUALIZER_MODES)[number];

export const DEFAULT_VISUALIZER_MODE: VisualizerMode = 'spectrum3d';

export const VISUALIZER_MODE_LABELS: Record<VisualizerMode, string> = {
  spectrum3d: 'Spectrum 3D',
  pianoRoll: 'Piano roll',
};

export function parseVisualizerMode(raw: unknown): VisualizerMode | null {
  if (raw === 'spectrum3d' || raw === 'pianoRoll') return raw;
  if (raw && typeof raw === 'object' && 'mode' in raw) {
    const mode = (raw as { mode?: unknown }).mode;
    if (mode === 'spectrum3d' || mode === 'pianoRoll') return mode;
  }
  return null;
}
