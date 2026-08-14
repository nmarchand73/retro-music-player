import { useRef, useState } from 'react';
import { BookmarkButton } from './BookmarkButton';
import { MiniSpectrum } from './MiniSpectrum';
import { Spectrum3D } from './Spectrum3D';
import { TrackCover } from './TrackCover';
import type { PlayerStatus } from '../hooks/useMusicPlayer';
import type { Track } from '../types';
import { formatClock, formatDuration } from '../utils/formatTime';

interface PlayerBarProps {
  track: Track | null;
  status: PlayerStatus;
  position: number;
  duration: number;
  error: string | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  minimized: boolean;
  analyser: AnalyserNode | null;
}

export function PlayerBar({
  track,
  status,
  position,
  duration,
  error,
  hasPrevious,
  hasNext,
  onPlayPause,
  onStop,
  onSeek,
  onPrevious,
  onNext,
  bookmarked,
  onToggleBookmark,
  minimized,
  analyser,
}: PlayerBarProps) {
  const canSeek = duration > 0;
  const showPause = status === 'playing';
  const canPlayPause = Boolean(track) && status !== 'loading';
  const [scrub, setScrub] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const shownPosition = scrub ?? position;
  const titleDuration =
    duration > 0 ? formatClock(duration) : status !== 'loading' && track ? formatDuration(duration) : null;
  const playing = status === 'playing';

  const commitSeek = (seconds: number) => {
    draggingRef.current = false;
    onSeek(seconds);
    setScrub(null);
  };

  const seekControls = (
    <div className="player-progress">
      <span>{formatClock(shownPosition)}</span>
      <label className="progress-track">
        <span className="visually-hidden">Seek</span>
        <input
          type="range"
          min={0}
          max={canSeek ? duration : 1}
          step={0.1}
          value={canSeek ? Math.min(shownPosition, duration) : 0}
          disabled={!canSeek || !track}
          aria-label="Seek"
          onPointerDown={() => {
            draggingRef.current = true;
            setScrub(position);
          }}
          onInput={(event) => setScrub(Number(event.currentTarget.value))}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (draggingRef.current) {
              setScrub(value);
              return;
            }
            commitSeek(value);
          }}
          onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
          onPointerCancel={() => {
            draggingRef.current = false;
            setScrub(null);
          }}
        />
      </label>
      <span>{formatDuration(duration)}</span>
    </div>
  );

  if (minimized) {
    return (
      <footer className="player-bar is-minimized" aria-label="Player">
        <div className="player-info">
          {track ? (
            <>
              <TrackCover track={track} className="player-cover" />
              <div className="player-copy">
                <div className="player-title">
                  <strong>{track.title}</strong>
                  {titleDuration && <span className="player-title-duration">{titleDuration}</span>}
                </div>
                <span className="player-artist">
                  {track.artist}
                  {status === 'loading' ? ' · Loading…' : ''}
                </span>
              </div>
            </>
          ) : (
            <span className="muted">Pick a track to play</span>
          )}
          {error && <span className="player-error">{error}</span>}
        </div>

        <MiniSpectrum analyser={analyser} playing={playing} />

        <div className="player-controls">
          <button
            type="button"
            className="player-play"
            onClick={onPlayPause}
            aria-label={showPause ? 'Pause' : 'Play'}
            disabled={!canPlayPause}
          >
            <span>{showPause ? 'Pause' : 'Play'}</span>
            {showPause ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
      </footer>
    );
  }

  return (
    <footer
      className={`player-bar is-expanded${playing ? ' is-playing' : ''}${track?.coverUrl ? ' has-art' : ''}`}
      aria-label="Player"
    >
      {track?.coverUrl ? (
        <div
          className="player-stage-bg"
          style={{ backgroundImage: `url(${track.coverUrl})` }}
          aria-hidden="true"
        />
      ) : (
        <div className="player-stage-bg is-fallback" aria-hidden="true" />
      )}
      <div className="player-stage-veil" aria-hidden="true" />

      <div className="player-stage">
        <aside className="player-stage-side">
          <div className={`player-stage-art${playing ? ' is-live' : ''}`}>
            <div className="player-art-glow" aria-hidden="true" />
            <div className="player-art-frame">
              {track ? (
                <TrackCover track={track} className="player-cover-hero" />
              ) : (
                <span className="player-cover-hero is-placeholder" aria-hidden="true">
                  ?
                </span>
              )}
            </div>
          </div>

          <div className="player-hud-meta">
            {track ? (
              <>
                <div className="player-title">
                  <strong>{track.title}</strong>
                  <BookmarkButton title={track.title} bookmarked={bookmarked} onToggle={onToggleBookmark} />
                </div>
                {titleDuration && <span className="player-title-duration">{titleDuration}</span>}
                <span className="player-artist">
                  {track.artist}
                  {track.game ? ` · ${track.game}` : ''}
                  {status === 'loading' ? ' · Loading…' : ''}
                </span>
                {track.platform ? (
                  <span className="player-platform-chip" data-platform={track.platform}>
                    {track.platform === 'amiga' ? 'Amiga' : 'Atari ST'}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="muted">Pick a track to play</span>
            )}
            {error && <span className="player-error">{error}</span>}
          </div>
        </aside>

        <div className="player-stage-viz">
          <Spectrum3D analyser={analyser} playing={playing} variant="panel" />
        </div>
      </div>

      <div className="player-hud-dock">
        <div className="player-controls">
          <button type="button" onClick={onPrevious} aria-label="Previous track" disabled={!hasPrevious}>
            <PrevIcon />
          </button>
          <button
            type="button"
            className="player-play"
            onClick={onPlayPause}
            aria-label={showPause ? 'Pause' : 'Play'}
            disabled={!canPlayPause}
          >
            <span>{showPause ? 'Pause' : 'Play'}</span>
            {showPause ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" onClick={onNext} aria-label="Next track" disabled={!hasNext}>
            <NextIcon />
          </button>
          <button type="button" onClick={onStop} aria-label="Stop" disabled={!track}>
            <StopIcon />
          </button>
        </div>
        {seekControls}
      </div>
    </footer>
  );
}

function PrevIcon() {
  return (
    <svg className="transport-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M6 6h2.2v12H6V6zm3.8 6 8.2 5.5V6.5L9.8 12z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="transport-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="transport-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg className="transport-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M15.8 6h2.2v12h-2.2V6zM6 6.5v11L14.2 12 6 6.5z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="transport-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M7 7h10v10H7V7z" />
    </svg>
  );
}
