import { useEffect, useRef } from 'react';

const ACCENT = '#e2185a';

export function useWaveform(analyser: AnalyserNode | null, playing: boolean, mounted: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(226, 24, 90, 0.28)';
      ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    if (!analyser || !playing) {
      drawIdle();
      return () => observer.disconnect();
    }

    const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));

    const draw = () => {
      analyser.getByteTimeDomainData(buffer);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const { width, height } = canvas;
        const mid = height / 2;
        const amp = height * 0.42;
        const step = Math.max(1, Math.floor(buffer.length / width));

        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let x = 0; x < width; x += 1) {
          const index = Math.min(buffer.length - 1, x * step);
          const sample = (buffer[index]! - 128) / 128;
          ctx.lineTo(x, mid + sample * amp);
        }
        ctx.lineTo(width, mid);
        ctx.closePath();
        ctx.fillStyle = 'rgba(226, 24, 90, 0.2)';
        ctx.fill();

        ctx.beginPath();
        for (let x = 0; x < width; x += 1) {
          const index = Math.min(buffer.length - 1, x * step);
          const sample = (buffer[index]! - 128) / 128;
          const y = mid + sample * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = Math.max(1.4, (window.devicePixelRatio || 1) * 1.15);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
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
