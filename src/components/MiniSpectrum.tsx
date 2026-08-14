import { useSpectrum } from '../hooks/useSpectrum';

interface MiniSpectrumProps {
  analyser: AnalyserNode | null;
  playing: boolean;
  variant?: 'mini' | 'stage';
}

export function MiniSpectrum({ analyser, playing, variant = 'mini' }: MiniSpectrumProps) {
  const barCount = variant === 'stage' ? 64 : 48;
  const { canvasRef } = useSpectrum(analyser, playing, true, barCount);

  return (
    <div className={`mini-spectrum${variant === 'stage' ? ' is-stage' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="mini-spectrum-canvas" />
    </div>
  );
}
