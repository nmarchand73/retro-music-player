import { useRef, useState } from 'react';
import { BookmarkButton } from './BookmarkButton';
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
}: PlayerBarProps) {
  const canSeek = duration > 0;
  const showPause = status === 'playing';
  const canPlayPause = Boolean(track) && status !== 'loading';
  const [scrub, setScrub] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const shownPosition = scrub ?? position;
  const titleDuration =
    duration > 0 ? formatClock(duration) : status !== 'loading' && track ? formatDuration(duration) : null;

  const commitSeek = (seconds: number) => {
    draggingRef.current = false;
    onSeek(seconds);
    setScrub(null);
  };

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
    <footer className="player-bar" aria-label="Player">
      <div className="player-info">
        {track ? (
          <>
            <TrackCover track={track} className="player-cover" />
            <div className="player-copy">
              <div className="player-title">
                <strong>{track.title}</strong>
                {titleDuration && <span className="player-title-duration">{titleDuration}</span>}
                <BookmarkButton title={track.title} bookmarked={bookmarked} onToggle={onToggleBookmark} />
              </div>
              <span className="player-artist">
                {track.artist}
                {track.game ? ` · ${track.game}` : ''}
                {status === 'loading' ? ' · Loading…' : ''}
              </span>
            </div>
          </>
        ) : (
          <span className="muted">Pick a track to play — search above, then click a result</span>
        )}
        {error && <span className="player-error">{error}</span>}
      </div>

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
      <span className="keyboard-hint">Space pause · ← → seek 5s</span>
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
