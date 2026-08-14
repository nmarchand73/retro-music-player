import type { TrackerPlayback, TrackerSong } from '../utils/trackerFormat';
import { buildTrackerRows, formatHex } from '../utils/trackerFormat';
import { useWaveform } from '../hooks/useWaveform';

interface TrackerVisualizerProps {
  song: TrackerSong | null;
  playback: TrackerPlayback | null;
  analyser: AnalyserNode | null;
  active: boolean;
  playing: boolean;
}

export function TrackerVisualizer({
  song,
  playback,
  analyser,
  active,
  playing,
}: TrackerVisualizerProps) {
  const { rows, channelCount, totalChannels, patternName, patternLength } = buildTrackerRows(
    song,
    playback,
  );
  const mounted = active && rows.length > 0;
  const { canvasRef } = useWaveform(analyser, playing, mounted);

  if (!mounted || !playback) {
    return null;
  }

  return (
    <section className="panel tracker-panel is-compact" aria-label="Tracker pattern">
      <header className="tracker-header">
        <h2>
          Pat {formatHex(playback.pattern)}
          {patternName ? ` · ${patternName}` : ''}
          <span className="tracker-header-row">
            {' '}
            · Row {formatHex(playback.row)}/{formatHex(Math.max(0, patternLength - 1))}
          </span>
        </h2>
        <div className="tracker-meta">
          <span className="chip">Ord {formatHex(playback.order)}</span>
          <span className="chip subtle">
            {channelCount === totalChannels
              ? `${channelCount} ch`
              : `${channelCount} / ${totalChannels} ch`}
          </span>
        </div>
      </header>

      <div className="tracker-scope" aria-hidden="true">
        <canvas ref={canvasRef} className="tracker-waveform" />
      </div>
    </section>
  );
}
