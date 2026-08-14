import { useEffect, useRef, useState } from 'react';

export function useWaveform(analyser: AnalyserNode | null, active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [samples, setSamples] = useState<number[]>([]);

  useEffect(() => {
    if (!analyser || !active) {
      setSamples([]);
      return;
    }

    const buffer = new Uint8Array(analyser.fftSize);
    const draw = () => {
      analyser.getByteTimeDomainData(buffer);
      const next = Array.from(buffer).map((value) => (value - 128) / 128);
      setSamples(next);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const { width, height } = canvas;
          ctx.clearRect(0, 0, width, height);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          next.forEach((sample, index) => {
            const x = (index / next.length) * width;
            const y = height / 2 + sample * (height * 0.35);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [analyser, active]);

  return { canvasRef, samples };
}
