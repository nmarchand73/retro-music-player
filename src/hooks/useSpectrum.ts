import { useEffect, useRef } from 'react';

const BAR_COUNT = 48;
const PEAK_HOLD_FRAMES = 18;
const PEAK_FALL = 0.014;
const FLOOR = 0.02;
const ATTACK = 0.92;
const RELEASE = 0.28;

function groupBins(data: Uint8Array, groups: number): Float32Array {
  const out = new Float32Array(groups);
  // Skip DC / very-low bins; keep most of the spectrum for mid/high detail.
  const lo = 2;
  const hi = Math.max(lo + 1, Math.floor(data.length * 0.72));
  const span = hi / lo;

  for (let i = 0; i < groups; i += 1) {
    const start = Math.min(hi - 1, Math.floor(lo * Math.pow(span, i / groups)));
    const end = Math.min(hi, Math.max(start + 1, Math.floor(lo * Math.pow(span, (i + 1) / groups))));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const v = data[j] ?? 0;
      if (v > peak) peak = v;
    }
    // Emphasize differences between quiet and loud bins.
    const norm = peak / 255;
    out[i] = Math.pow(norm, 1.15);
  }
  return out;
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  ctx.fill();
}

export function useSpectrum(analyser: AnalyserNode | null, playing: boolean, mounted: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const peakHoldRef = useRef<Int16Array>(new Int16Array(BAR_COUNT));
  const displayRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));

  useEffect(() => {
    if (!mounted) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    };

    const drawIdle = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const gap = Math.max(1.5, width / (BAR_COUNT * 4.4));
      const barW = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const x = i * (barW + gap);
        const h = height * (FLOOR + ((i * 17) % 7) * 0.007);
        const y = height - h;
        ctx.fillStyle = 'rgba(226, 24, 90, 0.16)';
        fillRoundRect(ctx, x, y, barW, h, Math.min(barW / 2, 3));
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    if (!analyser) {
      drawIdle();
      return () => observer.disconnect();
    }

    // Prefer snappy FFT for this view even if the node was created elsewhere.
    analyser.smoothingTimeConstant = Math.min(analyser.smoothingTimeConstant, 0.22);
    analyser.minDecibels = -92;
    analyser.maxDecibels = -18;

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const peaks = peaksRef.current;
    const holds = peakHoldRef.current;
    const display = displayRef.current;

    const draw = () => {
      analyser.getByteFrequencyData(buffer);
      const levels = groupBins(buffer, BAR_COUNT);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const { width, height } = canvas;
        const gap = Math.max(1.5, width / (BAR_COUNT * 4.4));
        const barW = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
        const radius = Math.min(barW / 2, Math.max(2, height * 0.08));
        const drawH = height * 0.82;
        const peakThickness = Math.max(2, height * 0.055);
        const peakGap = Math.max(1.5, height * 0.035);

        ctx.clearRect(0, 0, width, height);

        const floorGlow = ctx.createLinearGradient(0, height * 0.55, 0, height);
        floorGlow.addColorStop(0, 'rgba(226, 24, 90, 0)');
        floorGlow.addColorStop(1, 'rgba(226, 24, 90, 0.12)');
        ctx.fillStyle = floorGlow;
        ctx.fillRect(0, height * 0.55, width, height * 0.45);

        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#e2185a');
        gradient.addColorStop(0.45, '#d43aa8');
        gradient.addColorStop(0.78, '#7b4ec4');
        gradient.addColorStop(1, '#3d2f8a');

        for (let i = 0; i < BAR_COUNT; i += 1) {
          const target = playing ? Math.min(1, levels[i]! * 1.35) : levels[i]! * 0.12;
          const prev = display[i]!;
          const next =
            target > prev ? prev + (target - prev) * ATTACK : prev + (target - prev) * RELEASE;
          display[i] = Math.max(FLOOR, next);
          const boosted = display[i]!;

          if (boosted >= peaks[i]!) {
            peaks[i] = boosted;
            holds[i] = PEAK_HOLD_FRAMES;
          } else if (holds[i]! > 0) {
            holds[i]!--;
          } else {
            peaks[i] = Math.max(FLOOR, peaks[i]! - PEAK_FALL);
          }

          const x = i * (barW + gap);
          const h = Math.max(2, boosted * drawH);
          const y = height - h;

          ctx.fillStyle = 'rgba(226, 24, 90, 0.22)';
          fillRoundRect(ctx, x - gap * 0.25, y, barW + gap * 0.5, h, radius);

          ctx.fillStyle = gradient;
          fillRoundRect(ctx, x, y, barW, h, radius);

          const shine = ctx.createLinearGradient(x, y, x + barW, y);
          shine.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
          shine.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
          shine.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
          ctx.fillStyle = shine;
          fillRoundRect(ctx, x, y, barW, h, radius);

          const peakLevel = peaks[i]!;
          if (peakLevel > FLOOR + 0.01) {
            const peakH = Math.max(2, peakLevel * drawH);
            const peakY = Math.max(0, height - peakH - peakGap - peakThickness);
            ctx.fillStyle = 'rgba(255, 248, 238, 0.98)';
            ctx.shadowColor = 'rgba(226, 24, 90, 0.65)';
            ctx.shadowBlur = 5;
            fillRoundRect(ctx, x, peakY, barW, peakThickness, Math.min(barW / 2, peakThickness / 2));
            ctx.shadowBlur = 0;
          }
        }

        ctx.fillStyle = 'rgba(36, 18, 40, 0.06)';
        for (let y = 0; y < height; y += 3) {
          ctx.fillRect(0, y, width, 1);
        }
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [analyser, playing, mounted]);

  return { canvasRef };
}
