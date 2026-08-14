import type { TrackerPlayback, TrackerSong } from '../utils/trackerFormat';
import { buildTrackerRows } from '../utils/trackerFormat';
import { useWaveform } from '../hooks/useWaveform';

interface TrackerVisualizerProps {
  song: TrackerSong | null;
  playback: TrackerPlayback | null;
  analyser: AnalyserNode | null;
  active: boolean;
}

export function TrackerVisualizer({ song, playback, analyser, active }: TrackerVisualizerProps) {
  const { rows, channelCount } = buildTrackerRows(song, playback);
  const { canvasRef } = useWaveform(analyser, active);

  if (!active || rows.length === 0) {
    return (
      <section className="panel tracker-panel tracker-panel-empty">
        <p className="muted">Start an Amiga tracker module to see the live pattern view.</p>
      </section>
    );
  }

  return (
    <section className="panel tracker-panel">
      <header className="tracker-header">
        <div>
          <p className="eyebrow">Tracker view</p>
          <h2>
            Pattern {playback?.pattern ?? 0} · Row {playback?.row ?? 0}
          </h2>
        </div>
        <div className="tracker-meta">
          <span className="chip">Order {playback?.order ?? 0}</span>
          <span className="chip subtle">{channelCount} channels</span>
        </div>
      </header>

      <div className="tracker-grid" style={{ gridTemplateColumns: `repeat(${channelCount}, 1fr)` }}>
        {Array.from({ length: channelCount }, (_, index) => (
          <div key={index} className="tracker-channel">
            <div className="tracker-channel-head">CH {index + 1}</div>
            <div className="tracker-channel-cols">
              <span>Note</span>
              <span>Inst</span>
              <span>Fx</span>
            </div>
          </div>
        ))}
      </div>

      <div className="tracker-body">
        {rows.map((row) => (
          <div key={row.rowIndex} className={`tracker-row ${row.isCurrent ? 'current' : ''}`}>
            {row.isCurrent && (
              <div className="tracker-playhead">
                <canvas ref={canvasRef} className="tracker-waveform" width={640} height={28} />
              </div>
            )}
            <div
              className="tracker-row-grid"
              style={{ gridTemplateColumns: `repeat(${channelCount}, 1fr)` }}
            >
              {row.cells.map((cell, cellIndex) => (
                <div key={cellIndex} className="tracker-cell">
                  <span className="note">{cell.note}</span>
                  <span className="inst">{cell.instrument}</span>
                  <span className="fx">{cell.effect}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
