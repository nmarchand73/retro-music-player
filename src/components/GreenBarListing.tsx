import * as THREE from 'three';
import { C64_ASM_LINES } from '../data/c64AsmListing';

const PAPER = '#f4f1e6';
const BAR = '#c8e0c4';
const INK = '#2f4a4a';
const HOLE = '#1a2525';
const HOLE_RING = '#8a9a8a';

/** One printable row on continuous form = green OR white band. */
const ROW_PX = 28;
/** Feed speed in paper-rows per second while playing. */
const ROWS_PER_SEC = 1.35;

export type GreenBarFloorHandle = {
  texture: THREE.CanvasTexture;
  update: (opts: {
    playing: boolean;
    dt: number;
    title?: string | null;
    text?: string | null;
  }) => void;
  dispose: () => void;
};

/**
 * Continuous-form green-bar listing as a floor texture.
 * Real C64 6502 source scrolls with the paper feed (stripes + tractor holes locked).
 */
export function createGreenBarFloorTexture(
  width = 1024,
  height = 512,
): GreenBarFloorHandle {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const texture = new THREE.CanvasTexture(canvas);
    return {
      texture,
      update: () => undefined,
      dispose: () => texture.dispose(),
    };
  }

  /** Paper distance scrolled in pixels (positive = feed toward viewer). */
  let feedPx = 0;
  let lastHistoryKey = '';
  let lastDrawnFeedPx = Number.NaN;
  let lines = [...C64_ASM_LINES];

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const update: GreenBarFloorHandle['update'] = ({ playing, dt, title, text }) => {
    const historyKey = `${title ?? ''}\0${text ?? ''}`;
    const historyChanged = historyKey !== lastHistoryKey;
    if (historyChanged) {
      lastHistoryKey = historyKey;
      const history =
        title && text
          ? `; NOW PLAYING: ${title.toUpperCase()} — ${text.replace(/\s+/g, ' ').trim()}`
          : '; NOW PLAYING: SID TUNE / HVSC';
      lines = [...C64_ASM_LINES.slice(0, 4), history, '', ...C64_ASM_LINES.slice(4)];
    }

    if (playing) feedPx += dt * ROW_PX * ROWS_PER_SEC;

    if (!historyChanged && !playing && lastDrawnFeedPx === feedPx) return;
    if (!historyChanged && playing && Math.abs(feedPx - lastDrawnFeedPx) < 1.5) return;
    lastDrawnFeedPx = feedPx;

    const margin = Math.max(32, width * 0.055);
    const holeR = Math.max(4, ROW_PX * 0.18);
    const fontSize = Math.max(12, Math.min(16, ROW_PX * 0.52));
    const textCenterX = width * 0.5;
    const maxChars = Math.max(28, Math.floor((width - margin * 2 - 24) / (fontSize * 0.58)));
    const period = lines.length * ROW_PX;
    const feed = ((feedPx % period) + period) % period;

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);

    const firstRow = Math.floor(feed / ROW_PX) - 2;
    const rowCount = Math.ceil(height / ROW_PX) + 4;

    for (let i = 0; i < rowCount; i += 1) {
      const row = firstRow + i;
      const y = row * ROW_PX - feed;
      if (y > height || y + ROW_PX < 0) continue;

      if (row % 2 === 0) {
        ctx.fillStyle = BAR;
        ctx.fillRect(0, y, width, ROW_PX);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.fillRect(0, y, margin, ROW_PX);
      ctx.fillRect(width - margin, y, margin, ROW_PX);

      const cy = y + ROW_PX * 0.5;
      for (const cx of [margin * 0.5, width - margin * 0.5]) {
        ctx.beginPath();
        ctx.arc(cx, cy, holeR + 1.2, 0, Math.PI * 2);
        ctx.fillStyle = HOLE_RING;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
        ctx.fillStyle = HOLE;
        ctx.fill();
      }

      const lineIndex = ((row % lines.length) + lines.length) % lines.length;
      let line = lines[lineIndex] ?? '';
      if (line.length > maxChars) line = `${line.slice(0, maxChars - 1)}…`;
      const trimmed = line.trimStart();
      const isComment = trimmed.startsWith(';') || trimmed.length === 0;
      ctx.globalAlpha = isComment ? 0.65 : 0.92;
      ctx.fillStyle = isComment ? '#3d5c5c' : INK;
      ctx.font = `600 ${fontSize}px "IBM Plex Mono", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(line, textCenterX, cy);
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'left';

    ctx.strokeStyle = 'rgba(47,74,74,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(margin, 0);
    ctx.lineTo(margin, height);
    ctx.moveTo(width - margin, 0);
    ctx.lineTo(width - margin, height);
    ctx.stroke();
    ctx.setLineDash([]);

    texture.needsUpdate = true;
  };

  update({ playing: false, dt: 0 });

  return {
    texture,
    update,
    dispose: () => texture.dispose(),
  };
}
