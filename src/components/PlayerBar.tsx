import type { PlayerStatus } from '../hooks/useMusicPlayer';
import type { Track } from '../types';

interface PlayerBarProps {
  track: Track | null;
  status: PlayerStatus;
  position: number;
  duration: number;
  error: string | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function PlayerBar({
  track,
  status,
  position,
  duration,
  error,
  onPause,
  onResume,
  onStop,
}: PlayerBarProps) {
  const progress = duration > 0 ? Math.min((position / duration) * 100, 100) : 0;

  return (
    <footer className="player-bar">
      <div className="player-info">
        {track ? (
          <>
            <strong>{track.title}</strong>
            <span>{track.artist} · {track.format}</span>
          </>
        ) : (
          <span className="muted">Select a track to start playback</span>
        )}
        {error && <span className="player-error">{error}</span>}
      </div>

      <div className="player-controls">
        {status === 'playing' && (
          <button type="button" onClick={onPause} aria-label="Pause">
            ❚❚
          </button>
        )}
        {status === 'paused' && (
          <button type="button" onClick={onResume} aria-label="Resume">
            ▶
          </button>
        )}
        {(status === 'playing' || status === 'paused' || status === 'loading') && (
          <button type="button" onClick={onStop} aria-label="Stop">
            ■
          </button>
        )}
        {status === 'loading' && <span className="muted">Loading…</span>}
      </div>

      <div className="player-progress">
        <span>{formatTime(position)}</span>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span>{formatTime(duration)}</span>
      </div>
    </footer>
  );
}
