import { useEffect, useRef } from 'react';

interface AmigaDemoScrollProps {
  title: string;
  text: string;
  playing: boolean;
}

const LETTER_COPPER = [
  '#6b4cff',
  '#c44ecf',
  '#e2185a',
  '#ff6b3d',
  '#ffb347',
  '#fff0c8',
  '#ffb347',
  '#ff6b3d',
  '#e2185a',
  '#c44ecf',
];

/** Precompute a 256-entry sine table (Amiga demos never called sin() per pixel). */
function makeSinTable(amplitude: number): Float32Array {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    table[i] = Math.sin((i / 256) * Math.PI * 2) * amplitude;
  }
  return table;
}

/**
 * Amiga cracktro-inspired overlay:
 * - Parallax starfield
 * - Sine scrolltext with water mirror reflection
 */
export function AmigaDemoScroll({ title, text, playing }: AmigaDemoScrollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scroll = `★★★  ${title.toUpperCase()}  ★  ${text.replace(/\s+/g, ' ').trim()}  ★★★   `;

    const nearStars = Array.from({ length: 18 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.62,
      s: 1.4 + Math.random() * 1.6,
      tw: Math.random() * Math.PI * 2,
      layer: 1.15,
    }));
    const midStars = Array.from({ length: 28 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.7,
      s: 0.8 + Math.random() * 1.1,
      tw: Math.random() * Math.PI * 2,
      layer: 0.65,
    }));
    const farStars = Array.from({ length: 36 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.75,
      s: 0.45 + Math.random() * 0.7,
      tw: Math.random() * Math.PI * 2,
      layer: 0.28,
    }));
    const stars = [...farStars, ...midStars, ...nearStars];

    let raf = 0;
    let last = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let sinY = makeSinTable(1);
    let sinStretch = makeSinTable(1);
    let charWidths: Float32Array | null = null;
    let textW = 1;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(2, Math.floor(rect.width));
      height = Math.max(2, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const amp = height * (playing ? 0.045 : 0.03);
      sinY = makeSinTable(amp);
      sinStretch = makeSinTable(0.12);
    };

    const measureScroll = () => {
      const fontPx = Math.max(11, Math.floor(height * 0.078));
      ctx.font = `800 ${fontPx}px "IBM Plex Mono", "Courier New", monospace`;
      charWidths = new Float32Array(scroll.length);
      let total = 0;
      for (let i = 0; i < scroll.length; i += 1) {
        const w = ctx.measureText(scroll[i]!).width;
        charWidths[i] = w;
        total += w;
      }
      textW = Math.max(total, 1);
      return fontPx;
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    const sampleSin = (table: Float32Array, phase: number) => {
      const idx = ((phase % 256) + 256) % 256;
      const i0 = Math.floor(idx);
      const i1 = (i0 + 1) % 256;
      const f = idx - i0;
      return table[i0]! * (1 - f) + table[i1]! * f;
    };

    const drawStars = (t: number) => {
      const drift = playing ? 1 : 0.35;
      for (const star of stars) {
        // Prefer sky + footer; fade stars that sit over the spectrum band.
        const mid = Math.abs(star.y - 0.45);
        const bandFade = mid < 0.18 ? 0.15 : mid < 0.28 ? 0.45 : 1;
        const x = ((star.x + t * 0.03 * star.layer * drift) % 1 + 1) % 1;
        const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * (2.2 + star.layer) + star.tw));
        ctx.fillStyle = `rgba(255, 248, 238, ${twinkle * (0.25 + star.layer * 0.35) * bandFade})`;
        ctx.fillRect(x * width, star.y * height, star.s, star.s);
      }
    };

    const drawTitle = (t: number, fontPx: number) => {
      const badge = `★ ${title.toUpperCase()} ★`;
      const bounce = reduceMotion ? 0 : sampleSin(sinY, t * 28) * 0.35;
      const titleY = height * 0.1 + bounce;
      ctx.save();
      ctx.font = `800 ${Math.max(12, Math.floor(fontPx * 1.15))}px "Bebas Neue", Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Copper-wave per letter
      const letters = [...badge];
      const fullW = ctx.measureText(badge).width;
      let lx = width / 2 - fullW / 2;
      for (let i = 0; i < letters.length; i += 1) {
        const ch = letters[i]!;
        const chW = ctx.measureText(ch).width;
        const wave = reduceMotion ? 0 : sampleSin(sinY, t * 40 + i * 8) * 0.22;
        const gy = titleY + wave;
        const grad = ctx.createLinearGradient(0, gy - fontPx * 0.55, 0, gy + fontPx * 0.55);
        grad.addColorStop(0, '#fff8ee');
        grad.addColorStop(0.4, '#ffc078');
        grad.addColorStop(0.7, '#e2185a');
        grad.addColorStop(1, '#7b4ec4');
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(20, 8, 40, 0.45)';
        ctx.strokeText(ch, lx + chW / 2, gy);
        ctx.fillStyle = grad;
        ctx.fillText(ch, lx + chW / 2, gy);
        lx += chW;
      }
      ctx.restore();
    };

    const drawScroll = (t: number, fontPx: number) => {
      if (!charWidths) measureScroll();
      const widths = charWidths!;
      ctx.font = `800 ${fontPx}px "IBM Plex Mono", "Courier New", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      const speed = playing && !reduceMotion ? 64 : 24;
      const scrollX = reduceMotion ? width * 0.05 : -((t * speed) % textW);
      // Keep the wavy scroll in the lower foreground band.
      const baseY = height * 0.86;
      const mirrorY = height * 0.96;
      const waveAmp = 0.55;

      const drawPass = (opts: {
        yScale: number;
        alpha: number;
        mirror: boolean;
      }) => {
        for (let copy = 0; copy < 2; copy += 1) {
          let cx = scrollX + copy * textW;
          for (let i = 0; i < scroll.length; i += 1) {
            const ch = scroll[i]!;
            const chW = widths[i]!;
            if (cx + chW < -28) {
              cx += chW;
              continue;
            }
            if (cx > width + 28) break;

            const phase = cx * 0.35 + t * 10;
            const sine = reduceMotion ? 0 : sampleSin(sinY, phase) * waveAmp;
            const stretch = reduceMotion ? 1 : 1 + sampleSin(sinStretch, phase * 1.3) * 0.35;
            const y = opts.mirror
              ? mirrorY - sine * 0.4 * opts.yScale
              : baseY + sine * opts.yScale;

            ctx.save();
            ctx.globalAlpha = opts.alpha;
            ctx.translate(cx + chW / 2, y);
            ctx.scale(1, opts.mirror ? -stretch * 0.85 : stretch);

            // Slow copper cycle — readable letter colors, gentle drift over time.
            const color = LETTER_COPPER[
              Math.floor((cx * 0.04 + t * 1.6 + i * 0.35) % LETTER_COPPER.length)
            ]!;
            const grad = ctx.createLinearGradient(0, -fontPx * 0.55, 0, fontPx * 0.55);
            if (opts.mirror) {
              grad.addColorStop(0, 'rgba(80, 50, 140, 0.12)');
              grad.addColorStop(0.5, color);
              grad.addColorStop(1, 'rgba(255, 180, 120, 0.25)');
            } else {
              grad.addColorStop(0, '#fff8ee');
              grad.addColorStop(0.35, color);
              grad.addColorStop(1, '#3d2f8a');
            }
            ctx.lineWidth = 1.8;
            ctx.strokeStyle = opts.mirror ? 'rgba(20, 10, 40, 0.22)' : 'rgba(16, 6, 32, 0.4)';
            ctx.textAlign = 'center';
            ctx.strokeText(ch, 0, 0);
            ctx.fillStyle = grad;
            ctx.fillText(ch, 0, 0);

            // Specular glint on crest of the wave
            if (!opts.mirror && !reduceMotion && playing && sine > sinY[64]! * 0.72) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
              ctx.fillRect(-1, -fontPx * 0.42, 2, 2);
            }
            ctx.restore();
            cx += chW;
          }
        }
      };

      // Mirror first (behind), then glyphs
      drawPass({ yScale: 0.55, alpha: 0.22, mirror: true });
      const water = ctx.createLinearGradient(0, height * 0.88, 0, height);
      water.addColorStop(0, 'rgba(40, 20, 80, 0)');
      water.addColorStop(0.5, 'rgba(60, 30, 110, 0.12)');
      water.addColorStop(1, 'rgba(20, 10, 40, 0.28)');
      ctx.fillStyle = water;
      ctx.fillRect(0, height * 0.88, width, height * 0.12);

      drawPass({ yScale: 1, alpha: 1, mirror: false });
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const minDelta = playing && !reduceMotion ? 1000 / 40 : 1000 / 16;
      if (last && now - last < minDelta) return;
      last = now;
      const t = now * 0.001;

      ctx.clearRect(0, 0, width, height);

      // Edge veils only — leave the spectrum band fully transparent.
      const topVeil = ctx.createLinearGradient(0, 0, 0, height * 0.28);
      topVeil.addColorStop(0, 'rgba(14, 8, 28, 0.38)');
      topVeil.addColorStop(0.65, 'rgba(14, 8, 28, 0.08)');
      topVeil.addColorStop(1, 'rgba(14, 8, 28, 0)');
      ctx.fillStyle = topVeil;
      ctx.fillRect(0, 0, width, height * 0.28);

      const botVeil = ctx.createLinearGradient(0, height * 0.72, 0, height);
      botVeil.addColorStop(0, 'rgba(14, 8, 28, 0)');
      botVeil.addColorStop(0.4, 'rgba(14, 8, 28, 0.1)');
      botVeil.addColorStop(1, 'rgba(14, 8, 28, 0.42)');
      ctx.fillStyle = botVeil;
      ctx.fillRect(0, height * 0.72, width, height * 0.28);

      drawStars(t);
      const fontPx = measureScroll();
      drawTitle(t, fontPx);
      drawScroll(t, fontPx);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [playing, text, title]);

  return <canvas ref={canvasRef} className="amiga-demo-scroll" aria-hidden="true" />;
}
