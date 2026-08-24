import * as THREE from 'three';
import {
  buildListingLines,
  pickRandomGreenBarListing,
  type GreenBarListingDef,
} from '../data/greenBarListings';

const PAPER = '#f4f1e6';
const BAR = '#c8e0c4';
const HOLE = '#1a2525';
const HOLE_RING = '#8a9a8a';

/** Seeded speckle — stable grain that tiles as ribbon ink. */
function createInkPattern(base: string, speckle: string, seed0: number): CanvasPattern {
  const size = 48;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const pctx = tile.getContext('2d');
  if (!pctx) {
    const fallback = document.createElement('canvas');
    fallback.width = 1;
    fallback.height = 1;
    return fallback.getContext('2d')!.createPattern(fallback, 'repeat')!;
  }

  let seed = seed0;
  const rnd = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  pctx.fillStyle = base;
  pctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 380; i += 1) {
    const x = (rnd() * size) | 0;
    const y = (rnd() * size) | 0;
    const w = rnd() > 0.88 ? 2 : 1;
    pctx.globalAlpha = 0.18 + rnd() * 0.72;
    pctx.fillStyle = speckle;
    pctx.fillRect(x, y, w, 1);
  }

  for (let i = 0; i < 48; i += 1) {
    pctx.globalAlpha = 1;
    pctx.clearRect((rnd() * size) | 0, (rnd() * size) | 0, 1, 1);
  }

  pctx.globalAlpha = 1;
  return pctx.createPattern(tile, 'repeat')!;
}

/** Ink ribbon print — grainy fill, density varies gently per line. */
function drawInkLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  lineIndex: number,
  isComment: boolean,
  fontSize: number,
  inkCode: CanvasPattern,
  inkComment: CanvasPattern,
): void {
  const density = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(lineIndex * 0.21 + 0.4));

  ctx.font = `600 ${fontSize}px "IBM Plex Mono", "Courier New", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Soft bleed — ribbon ink spread, not embossed shadow
  ctx.fillStyle = isComment ? 'rgba(52,78,74,0.22)' : 'rgba(18,42,40,0.28)';
  ctx.globalAlpha = density;
  ctx.fillText(text, x + 0.45, y + 0.3);

  ctx.fillStyle = isComment ? inkComment : inkCode;
  ctx.globalAlpha = (isComment ? 0.8 : 0.95) * density;
  ctx.fillText(text, x, y);

  ctx.globalAlpha = 1;
}

/** One printable row on continuous form = green OR white band. */
const ROW_PX = 28;
/** Feed speed in paper-rows per second while playing. */
const ROWS_PER_SEC = 1.35;

export type GreenBarFloorHandle = {
  texture: THREE.CanvasTexture;
  update: (opts: {
    playing: boolean;
    dt: number;
    /** Stable id per loaded track (e.g. `${track.id}:${subsong}`). */
    trackKey?: string | null;
    title?: string | null;
    text?: string | null;
  }) => void;
  dispose: () => void;
};

/**
 * Continuous-form green-bar listing as a floor texture.
 * Picks a random language listing (C, C++, Pascal, …) on each new track.
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
  let lastTrackKey = '';
  let lastDrawnFeedPx = Number.NaN;
  let listing: GreenBarListingDef = pickRandomGreenBarListing();
  let lines = buildListingLines(listing);
  const inkCode = createInkPattern('#142826', '#061210', 0x2a4f4c);
  const inkComment = createInkPattern('#2a403e', '#142826', 0x3d5c58);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const update: GreenBarFloorHandle['update'] = ({ playing, dt, trackKey, title, text }) => {
    const key = trackKey ?? '';
    const trackChanged = key !== lastTrackKey;
    if (trackChanged && key) {
      lastTrackKey = key;
      listing = pickRandomGreenBarListing();
      lines = buildListingLines(listing, title, text);
      feedPx = 0;
      lastDrawnFeedPx = Number.NaN;
    } else if (trackChanged) {
      lastTrackKey = key;
      lastDrawnFeedPx = Number.NaN;
    }

    if (playing) feedPx += dt * ROW_PX * ROWS_PER_SEC;

    if (!trackChanged && !playing && lastDrawnFeedPx === feedPx) return;
    if (!trackChanged && playing && Math.abs(feedPx - lastDrawnFeedPx) < 1.5) return;
    lastDrawnFeedPx = feedPx;

    const margin = Math.max(32, width * 0.055);
    const textPad = Math.max(10, margin * 0.35);
    const textX = margin + textPad;
    const holeR = Math.max(4, ROW_PX * 0.18);
    const fontSize = Math.max(13, Math.min(17, ROW_PX * 0.56));
    const maxChars = Math.max(
      28,
      Math.floor((width - margin - textPad - 12) / (fontSize * 0.58)),
    );
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
      const isComment = listing.isComment(trimmed);
      drawInkLine(ctx, line, textX, cy, lineIndex, isComment, fontSize, inkCode, inkComment);
    }

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
};
