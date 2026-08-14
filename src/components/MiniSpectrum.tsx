import { useSpectrum } from '../hooks/useSpectrum';

interface MiniSpectrumProps {
  analyser: AnalyserNode | null;
  playing: boolean;
}

export function MiniSpectrum({ analyser, playing }: MiniSpectrumProps) {
  const { canvasRef } = useSpectrum(analyser, playing, true);

  return (
    <div className="mini-spectrum" aria-hidden="true">
      <canvas ref={canvasRef} className="mini-spectrum-canvas" />
    </div>
  );
}
