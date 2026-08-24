import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookmarkButton } from './BookmarkButton';
import { DownloadButton } from './DownloadButton';
import { MarqueeText } from './MarqueeText';
import { MiniSpectrum } from './MiniSpectrum';
import { PianoRoll } from './PianoRoll';
import { Spectrum3D } from './Spectrum3D';
import { TrackCover } from './TrackCover';
import { lookupGameHistory } from '../data/topGames';
import type { ChipChannelMutes, PlayerStatus } from '../hooks/useMusicPlayer';
import type { AudioFxSettings, FxPreset } from '../lib/audioFxBus';
import type { Track } from '../types';
import type { TrackerPlayback, TrackerSong } from '../utils/trackerFormat';
import type { VisualizerMode } from '../utils/visualizerMode';
import { formatClock, formatDuration, formatRemainingClock } from '../utils/formatTime';

function playerPlatformLabel(platform: Track['platform']): string {
  switch (platform) {
    case 'amiga':
      return 'Amiga';
    case 'atari':
      return 'Atari ST';
    case 'cpc':
      return 'CPC';
    case 'c64':
      return 'C64';
    case 'arcade':
      return 'Arcade';
    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unhandled platform: ${_exhaustive}`);
    }
  }
}

const YM_CHANNEL_LABELS = ['A', 'B', 'C'] as const;
const SID_CHANNEL_LABELS = ['1', '2', '3'] as const;

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
  channelMutes: ChipChannelMutes | null;
  onChannelMute: (index: 0 | 1 | 2, mute: boolean) => void;
  subsong: number | null;
  subsongCount: number;
  onSubsong: (index: number) => void;
  audioFx: AudioFxSettings;
  onAudioFxEnabled: (enabled: boolean) => void;
  onAudioFxPreset: (preset: FxPreset) => void;
  onAudioFxAmount: (amount: number) => void;
  visualizerMode: VisualizerMode;
  trackerSong?: TrackerSong | null;
  trackerPlayback?: TrackerPlayback | null;
}

function subsongLabel(index: number, count: number, track: Track | null): string {
  if (
    count === 2 &&
    track?.platform === 'atari' &&
    /gold\s*runner/i.test(`${track.title} ${track.game ?? ''}`) &&
    /hubbard/i.test(track.artist)
  ) {
    return index === 1 ? 'Samples + chip' : 'Chip only';
  }
  const notes = (track?.notes ?? '').toLowerCase();
  if (count === 2 && /samples?\s*\/\s*chip|chip only/i.test(notes)) {
    return index === 1 ? 'Samples + chip' : 'Chip only';
  }
  if (track?.platform === 'c64') return `Song ${index}`;
  return `Tune ${index}`;
}

function SubsongControls({
  subsong,
  subsongCount,
  track,
  onSubsong,
  compact = false,
}: {
  subsong: number;
  subsongCount: number;
  track: Track | null;
  onSubsong: (index: number) => void;
  compact?: boolean;
}) {
  if (subsongCount <= 1) return null;
  const label = subsongLabel(subsong, subsongCount, track);
  return (
    <div
      className={`player-subsong${compact ? ' is-compact' : ''}`}
      role="group"
      aria-label={track?.platform === 'c64' ? 'SID songs' : 'Subtunes'}
    >
      <button
        type="button"
        className="player-subsong-btn"
        aria-label={track?.platform === 'c64' ? 'Previous song' : 'Previous subtune'}
        disabled={subsong <= 1}
        onClick={() => onSubsong(subsong - 1)}
      >
        ‹
      </button>
      <span className="player-subsong-label" title={label}>
        {compact ? `${subsong}/${subsongCount}` : `${label} · ${subsong}/${subsongCount}`}
      </span>
      <button
        type="button"
        className="player-subsong-btn"
        aria-label={track?.platform === 'c64' ? 'Next song' : 'Next subtune'}
        disabled={subsong >= subsongCount}
        onClick={() => onSubsong(subsong + 1)}
      >
        ›
      </button>
    </div>
  );
}

function ChannelMuteControls({
  channelMutes,
  onChannelMute,
  compact = false,
}: {
  channelMutes: ChipChannelMutes;
  onChannelMute: (index: 0 | 1 | 2, mute: boolean) => void;
  compact?: boolean;
}) {
  const labels = channelMutes.kind === 'ym' ? YM_CHANNEL_LABELS : SID_CHANNEL_LABELS;
  const kindLabel =
    channelMutes.kind === 'ym'
      ? 'AY channel'
      : channelMutes.kind === 'sid'
        ? 'SID voice'
        : 'MOD channel';
  return (
    <div
      className={`player-channel-mutes${compact ? ' is-compact' : ''}`}
      role="group"
      aria-label={
        channelMutes.kind === 'ym'
          ? 'AY channels'
          : channelMutes.kind === 'sid'
            ? 'SID voices'
            : 'MOD channels'
      }
    >
      {!compact ? <span className="player-channel-mutes-label">Channels</span> : null}
      {labels.map((label, index) => {
        const muted = channelMutes.muted[index]!;
        const channelIndex = index as 0 | 1 | 2;
        return (
          <button
            key={label}
            type="button"
            className={`player-channel-mute${muted ? ' is-muted' : ''}`}
            aria-pressed={!muted}
            aria-label={muted ? `Unmute ${kindLabel} ${label}` : `Mute ${kindLabel} ${label}`}
            onClick={() => onChannelMute(channelIndex, !muted)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function PlayerFxRail({
  audioFx,
  onAudioFxEnabled,
  onAudioFxPreset,
  onAudioFxAmount,
  compact = false,
}: {
  audioFx: AudioFxSettings;
  onAudioFxEnabled: (enabled: boolean) => void;
  onAudioFxPreset: (preset: FxPreset) => void;
  onAudioFxAmount: (amount: number) => void;
  compact?: boolean;
}) {
  const fxLive = audioFx.enabled && audioFx.preset !== 'authentic';
  const activePreset: 'modern' | 'hall' = audioFx.preset === 'hall' ? 'hall' : 'modern';
  const percent = Math.round(audioFx.amount * 100);
  const amountStyle = { '--fx-amount': `${percent}%` } as CSSProperties;

  const toggleModern = () => {
    if (fxLive) {
      onAudioFxEnabled(false);
      return;
    }
    onAudioFxEnabled(true);
    if (audioFx.preset === 'authentic') onAudioFxPreset('modern');
  };

  if (compact) {
    return (
      <div
        className={`player-fx-rail is-compact${fxLive ? ' is-live' : ''}`}
        role="group"
        aria-label="Modern sound"
      >
        <button
          type="button"
          className={`player-fx-switch${fxLive ? ' is-on' : ''}`}
          aria-pressed={fxLive}
          aria-label="Player modern sound"
          onClick={toggleModern}
        >
          <span className="player-fx-switch-knob" aria-hidden="true" />
          <span className="player-fx-switch-copy">
            <span className="player-fx-switch-title">FX</span>
            <span className="player-fx-switch-meta">{fxLive ? `${percent}%` : 'Off'}</span>
          </span>
        </button>
        {fxLive ? (
          <label className="player-fx-amount is-compact">
            <span className="visually-hidden">Player modern sound amount</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={percent}
              aria-label="Player modern sound amount"
              style={amountStyle}
              onChange={(event) => onAudioFxAmount(Number(event.target.value) / 100)}
            />
          </label>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`player-fx-rail${fxLive ? ' is-live' : ''}`}
      role="group"
      aria-label="Audio enhancement"
    >
      <div className="player-fx-rail-main">
        <button
          type="button"
          className={`player-fx-switch${fxLive ? ' is-on' : ''}`}
          aria-pressed={fxLive}
          aria-label="Player modern sound"
          onClick={toggleModern}
        >
          <span className="player-fx-switch-knob" aria-hidden="true" />
          <span className="player-fx-switch-copy">
            <span className="player-fx-switch-title">Modern</span>
            <span className="player-fx-switch-meta">{fxLive ? 'Enhanced' : 'Authentic'}</span>
          </span>
        </button>

        <div
          className={`player-fx-presets${fxLive ? '' : ' is-disabled'}`}
          role="group"
          aria-label="Player audio FX preset"
        >
          <button
            type="button"
            className={activePreset === 'modern' && fxLive ? 'is-active' : undefined}
            aria-pressed={fxLive && activePreset === 'modern'}
            disabled={!fxLive}
            onClick={() => onAudioFxPreset('modern')}
          >
            Studio
          </button>
          <button
            type="button"
            className={activePreset === 'hall' && fxLive ? 'is-active' : undefined}
            aria-pressed={fxLive && activePreset === 'hall'}
            disabled={!fxLive}
            onClick={() => onAudioFxPreset('hall')}
          >
            Hall
          </button>
        </div>

        <label className={`player-fx-amount${fxLive ? '' : ' is-disabled'}`}>
          <span className="player-fx-amount-readout" aria-hidden="true">
            {percent}
            <small>%</small>
          </span>
          <span className="visually-hidden">Player modern sound amount</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            disabled={!fxLive}
            aria-label="Player modern sound amount"
            style={amountStyle}
            onChange={(event) => onAudioFxAmount(Number(event.target.value) / 100)}
          />
        </label>
      </div>
      <p className="player-fx-hint">
        {fxLive
          ? activePreset === 'hall'
            ? 'Wider room · soft plate · air'
            : 'EQ · glue · exciter · mid-side width'
          : 'Dry chip output — flip Modern to enhance'}
      </p>
    </div>
  );
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
  channelMutes,
  onChannelMute,
  subsong,
  subsongCount,
  onSubsong,
  audioFx,
  onAudioFxEnabled,
  onAudioFxPreset,
  onAudioFxAmount,
  visualizerMode,
  trackerSong = null,
  trackerPlayback = null,
}: PlayerBarProps) {
  const canSeek = duration > 0;
  const showPause = status === 'playing';
  const canPlayPause = Boolean(track) && status !== 'loading';
  const [scrub, setScrub] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const shownPosition = scrub ?? position;
  const titleDuration =
    duration > 0 ? formatClock(duration) : status !== 'loading' && track ? formatDuration(duration) : null;
  const miniDurationLabel =
    duration > 0
      ? formatRemainingClock(duration, shownPosition)
      : status !== 'loading' && track
        ? formatDuration(duration)
        : null;
  const playing = status === 'playing';
  const demo = useMemo(() => lookupGameHistory(track?.game), [track?.game]);

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

  const fxRail = (
    <PlayerFxRail
      audioFx={audioFx}
      onAudioFxEnabled={onAudioFxEnabled}
      onAudioFxPreset={onAudioFxPreset}
      onAudioFxAmount={onAudioFxAmount}
      compact={minimized}
    />
  );

  if (minimized) {
    return (
      <footer className="player-bar is-minimized" aria-label="Player">
        <div className="player-info">
          {track ? (
            <>
              <TrackCover track={track} className="player-cover" showPlaceholder={false} />
              <div className="player-copy">
                <div className="player-title">
                  <MarqueeText text={track.title} className="player-title-label" />
                  {miniDurationLabel && (
                    <span className="player-title-duration" aria-label="Time remaining">
                      {miniDurationLabel}
                    </span>
                  )}
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

        {visualizerMode === 'pianoRoll' ? (
          <PianoRoll
            analyser={analyser}
            playing={playing}
            playbackPosition={position}
            trackerSong={trackerSong}
            trackerPlayback={trackerPlayback}
          />
        ) : (
          <MiniSpectrum analyser={analyser} playing={playing} />
        )}

        <div className="player-controls">
          {fxRail}
          {subsong != null && subsongCount > 1 ? (
            <SubsongControls
              subsong={subsong}
              subsongCount={subsongCount}
              track={track}
              onSubsong={onSubsong}
              compact
            />
          ) : null}
          {channelMutes ? (
            <ChannelMuteControls
              channelMutes={channelMutes}
              onChannelMute={onChannelMute}
              compact
            />
          ) : null}
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
          {track?.coverUrl ? (
            <div className={`player-stage-art${playing ? ' is-live' : ''}`}>
              <div className="player-art-glow" aria-hidden="true" />
              <div className="player-art-frame">
                <TrackCover track={track} className="player-cover-hero" showPlaceholder={false} />
              </div>
            </div>
          ) : null}

          <div className="player-hud-meta">
            {track ? (
              <>
                <div className="player-title">
                  <MarqueeText text={track.title} className="player-title-label" />
                  <DownloadButton track={track} />
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
                    {playerPlatformLabel(track.platform)}
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
          {visualizerMode === 'pianoRoll' ? (
            <PianoRoll
              analyser={analyser}
              playing={playing}
              playbackPosition={position}
              trackerSong={trackerSong}
              trackerPlayback={trackerPlayback}
            />
          ) : (
            <Spectrum3D
              analyser={analyser}
              playing={playing}
              variant="panel"
              demoTitle={demo?.title ?? null}
              demoText={demo?.history ?? null}
              trackKey={track ? `${track.id}:${subsong ?? 1}` : null}
              listingTitle={track?.title ?? null}
              listingSubtitle={
                track
                  ? [track.artist, track.game].filter(Boolean).join(' · ') || null
                  : null
              }
            />
          )}
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
        {channelMutes ? (
          <ChannelMuteControls channelMutes={channelMutes} onChannelMute={onChannelMute} />
        ) : null}
        {subsong != null && subsongCount > 1 ? (
          <SubsongControls
            subsong={subsong}
            subsongCount={subsongCount}
            track={track}
            onSubsong={onSubsong}
          />
        ) : null}
        {fxRail}
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
