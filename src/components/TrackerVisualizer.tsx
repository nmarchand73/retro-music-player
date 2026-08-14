import type { CSSProperties, ReactNode } from 'react';
import type { TrackerPlayback, TrackerSong, TrackerViewRow } from '../utils/trackerFormat';
import { buildTrackerRows, formatHex } from '../utils/trackerFormat';
import { useWaveform } from '../hooks/useWaveform';

interface TrackerVisualizerProps {
  song: TrackerSong | null;
  playback: TrackerPlayback | null;
  analyser: AnalyserNode | null;
  active: boolean;
  playing: boolean;
}

function TrackerRowView({ row }: { row: TrackerViewRow }) {
  return (
    <div
      className={`tracker-row${row.isCurrent ? ' current' : ''}${row.isBeat ? ' beat' : ''}${row.outside ? ' outside' : ''}`}
      style={{ '--fade': String(Math.min(0.55, row.distance * 0.07)) } as CSSProperties}
    >
      <div className="tracker-row-num">{row.outside ? '' : formatHex(row.rowIndex)}</div>
      {row.cells.map((cell, cellIndex) => (
        <div
          key={cellIndex}
          className={`tracker-cell${cell.empty ? ' empty' : ''}${cell.hasNote ? ' has-note' : ''}`}
        >
          <span className="note">{cell.note}</span>
          <span className="inst">{cell.instrument}</span>
          <span className="fx">{cell.effect}</span>
        </div>
      ))}
    </div>
  );
}

function TrackerSheet({
  columns,
  children,
}: {
  columns: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="tracker-sheet" style={columns}>
      {children}
    </div>
  );
}

export function TrackerVisualizer({
  song,
  playback,
  analyser,
  active,
  playing,
}: TrackerVisualizerProps) {
  const { rows, channelCount, totalChannels, channelNames, patternName, patternLength, activeChannels } =
    buildTrackerRows(song, playback);
  const mounted = active && rows.length > 0;
  const { canvasRef } = useWaveform(analyser, playing, mounted);

  if (!mounted || !playback) {
    return null;
  }

  const currentIndex = rows.findIndex((row) => row.isCurrent);
  const ahead = currentIndex >= 0 ? rows.slice(0, currentIndex) : rows;
  const current = currentIndex >= 0 ? rows[currentIndex] : null;
  const behind = currentIndex >= 0 ? rows.slice(currentIndex + 1) : [];

  const columns: CSSProperties = {
    gridTemplateColumns: `2.35rem repeat(${channelCount}, minmax(7.4rem, 1fr))`,
  };

  return (
    <section className="panel tracker-panel" aria-label="Tracker pattern">
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

      <div className="tracker-scroll">
        <TrackerSheet columns={columns}>
          <div className="tracker-corner" aria-hidden="true">
            #
          </div>
          {channelNames.map((name, index) => (
            <div
              key={`${name}-${index}`}
              className={`tracker-channel ${activeChannels[index] ? 'live' : ''}`}
            >
              <div className="tracker-channel-head">{name}</div>
              <div className="tracker-channel-cols">
                <span>Nt</span>
                <span>In</span>
                <span>Fx</span>
              </div>
            </div>
          ))}
        </TrackerSheet>

        <div className="tracker-lanes">
          <div className="tracker-ahead">
            <TrackerSheet columns={columns}>
              {ahead.map((row) => (
                <TrackerRowView key={row.outside ? `out-${row.rowIndex}` : row.rowIndex} row={row} />
              ))}
            </TrackerSheet>
          </div>
          {current ? (
            <div className="tracker-now">
              <TrackerSheet columns={columns}>
                <TrackerRowView row={current} />
              </TrackerSheet>
            </div>
          ) : null}
          <div className="tracker-behind">
            <TrackerSheet columns={columns}>
              {behind.map((row) => (
                <TrackerRowView key={row.outside ? `out-${row.rowIndex}` : row.rowIndex} row={row} />
              ))}
            </TrackerSheet>
          </div>
        </div>
      </div>
    </section>
  );
}
