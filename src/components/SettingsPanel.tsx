import {
  MACHINE_BLURBS,
  MACHINE_IDS,
  MACHINE_LABELS,
  type MachineId,
  type MachineSettings,
  enabledMachines,
} from '../utils/machines';
import type { AudioFxSettings, FxPreset } from '../lib/audioFxBus';
import type { PlayerStatus } from '../hooks/useMusicPlayer';
import type { FxPreviewTracks } from '../hooks/useFxPreviewTracks';
import type { Track } from '../types';
import type { VisualizerMode } from '../utils/visualizerMode';
import { VISUALIZER_MODE_LABELS, VISUALIZER_MODES } from '../utils/visualizerMode';
import { formatTitleDuration } from '../utils/formatTime';
import { trackKey } from '../utils/trackKey';

function platformBadge(platform: Track['platform']): string {
  switch (platform) {
    case 'amiga':
      return 'AMIGA';
    case 'atari':
      return 'ATARI';
    case 'cpc':
      return 'CPC';
    case 'c64':
      return 'C64';
    default: {
      const _exhaustive: never = platform;
      return _exhaustive;
    }
  }
}

interface SettingsPanelProps {
  machines: MachineSettings;
  onToggle: (id: MachineId) => void;
  onEnableAll: () => void;
  originalOnly: boolean;
  onOriginalOnly: (originalOnly: boolean) => void;
  playableOnly: boolean;
  onPlayableOnly: (playableOnly: boolean) => void;
  audioFx: AudioFxSettings;
  onAudioFxEnabled: (enabled: boolean) => void;
  onAudioFxPreset: (preset: FxPreset) => void;
  onAudioFxAmount: (amount: number) => void;
  visualizerMode: VisualizerMode;
  onVisualizerMode: (mode: VisualizerMode) => void;
  previewTracks: FxPreviewTracks;
  previewLoading: boolean;
  currentTrackId: string | null;
  playerStatus: PlayerStatus;
  playbackDuration: number;
  onActivate: (track: Track) => void;
}

export function SettingsPanel({
  machines,
  onToggle,
  onEnableAll,
  originalOnly,
  onOriginalOnly,
  playableOnly,
  onPlayableOnly,
  audioFx,
  onAudioFxEnabled,
  onAudioFxPreset,
  onAudioFxAmount,
  visualizerMode,
  onVisualizerMode,
  previewTracks,
  previewLoading,
  currentTrackId,
  playerStatus,
  playbackDuration,
  onActivate,
}: SettingsPanelProps) {
  const active = enabledMachines(machines);
  const alone = active.length === 1 ? active[0] : null;
  const fxLive = audioFx.enabled && audioFx.preset !== 'authentic';

  return (
    <>
      <header className="panel-header settings-header">
        <div>
          <h2>Settings</h2>
          <p className="muted">
            Library filters, default machines for search and Insights, plus optional Modern sound FX
            after SID / AY / Amiga playback.
          </p>
        </div>
        <button type="button" className="settings-reset" onClick={onEnableAll} disabled={active.length === MACHINE_IDS.length}>
          Enable all
        </button>
      </header>

      <section className="settings-library-filters" aria-labelledby="settings-library-heading">
        <h3 className="settings-section-heading" id="settings-library-heading">
          Library filters
        </h3>
        <p className="muted">
          Applied to Library search results and Bookmarks. Defaults keep pure game soundtracks only.
        </p>
        <label className={`settings-machine-row${originalOnly ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            checked={originalOnly}
            aria-label="Game music only"
            onChange={(event) => onOriginalOnly(event.target.checked)}
          />
          <span className="settings-machine-copy">
            <strong>Game music only</strong>
            <span className="muted">
              Hide demos, remixes, Quartet conversions, and later covers (e.g. Tyan Goldrunner).
            </span>
          </span>
        </label>
        <label className={`settings-machine-row${playableOnly ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            checked={playableOnly}
            aria-label="Playable only"
            onChange={(event) => onPlayableOnly(event.target.checked)}
          />
          <span className="settings-machine-copy">
            <strong>Playable only</strong>
            <span className="muted">Hide Amiga formats the current engines cannot decode.</span>
          </span>
        </label>
      </section>

      <section className="settings-visualizer" aria-labelledby="settings-visualizer-heading">
        <h3 className="settings-section-heading" id="settings-visualizer-heading">
          Player visualizer
        </h3>
        <p className="muted">
          Expanded player stage: Spectrum 3D bars, or a vertical piano roll (Amiga tracker notes when
          available; otherwise pitch from the live spectrum).
        </p>
        <fieldset className="settings-visualizer-choices">
          <legend className="sr-only">Player visualizer mode</legend>
          {VISUALIZER_MODES.map((mode) => {
            const selected = visualizerMode === mode;
            return (
              <label key={mode} className={`settings-machine-row${selected ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="visualizer-mode"
                  value={mode}
                  checked={selected}
                  aria-label={VISUALIZER_MODE_LABELS[mode]}
                  onChange={() => onVisualizerMode(mode)}
                />
                <span className="settings-machine-copy">
                  <strong>{VISUALIZER_MODE_LABELS[mode]}</strong>
                  <span className="muted">
                    {mode === 'spectrum3d'
                      ? 'Mirrored frequency bars (default).'
                      : 'Scrolling notes over a keyboard.'}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </section>

      <section className="settings-audio-fx" aria-labelledby="settings-audio-fx-heading">
        <h3 id="settings-audio-fx-heading">Listening</h3>
        <p className="muted">
          Research-backed chain: rumble HPF, soft saturation, glue compression, modern tone curve
          (body / mid scoop / presence / air), Aphex-style aural exciter, mid-side width (bass stays
          mono), parallel short plate, then a soft limiter. Leave off for authentic dry chip output.
          Play a sample below and tweak live.
        </p>

        <label className={`settings-machine-row${fxLive ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            checked={fxLive}
            aria-label="Modern sound"
            onChange={(event) => {
              const on = event.target.checked;
              onAudioFxEnabled(on);
              if (on && audioFx.preset === 'authentic') onAudioFxPreset('modern');
            }}
          />
          <span className="settings-machine-copy">
            <strong>Modern sound</strong>
            <span className="muted">On-the-fly enhancement for CPC, C64, and other platforms</span>
          </span>
        </label>

        <label className="settings-fx-field">
          <span>Preset</span>
          <select
            value={fxLive ? (audioFx.preset === 'hall' ? 'hall' : 'modern') : 'authentic'}
            aria-label="Audio FX preset"
            onChange={(event) => {
              const value = event.target.value as FxPreset;
              if (value === 'authentic') {
                onAudioFxEnabled(false);
                onAudioFxPreset('authentic');
                return;
              }
              onAudioFxEnabled(true);
              onAudioFxPreset(value);
            }}
          >
            <option value="authentic">Authentic (dry)</option>
            <option value="modern">Modern</option>
            <option value="hall">Hall</option>
          </select>
        </label>

        <label className="settings-fx-field">
          <span>Amount · {Math.round(audioFx.amount * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(audioFx.amount * 100)}
            disabled={!fxLive}
            aria-label="Modern sound amount"
            onChange={(event) => onAudioFxAmount(Number(event.target.value) / 100)}
          />
        </label>

        <div className="settings-fx-previews" aria-labelledby="settings-fx-previews-heading">
          <h4 id="settings-fx-previews-heading">Try a sample</h4>
          <p className="muted">One track per platform — A/B Modern sound while it plays.</p>
          {previewLoading ? (
            <p className="muted settings-fx-previews-status">Loading samples…</p>
          ) : (
            <ul className="settings-fx-preview-list" aria-label="FX preview samples">
              {MACHINE_IDS.map((machine) => {
                const track = previewTracks[machine];
                if (!track) {
                  return (
                    <li key={machine} className="settings-fx-preview-missing muted">
                      <span className="platform-badge" data-platform={machine}>
                        {platformBadge(machine)}
                      </span>
                      <span>Sample unavailable</span>
                    </li>
                  );
                }
                const id = trackKey(track);
                const activeTrack = currentTrackId === id;
                const playing = activeTrack && playerStatus === 'playing';
                const action = playing ? 'Pause' : activeTrack && playerStatus === 'paused' ? 'Resume' : 'Play';
                const durationLabel = formatTitleDuration(
                  track.durationSeconds ?? (activeTrack && playbackDuration > 0 ? playbackDuration : null),
                );
                const actionLabel = durationLabel
                  ? `${action} ${track.title} (${MACHINE_LABELS[machine]}), ${durationLabel}`
                  : `${action} ${track.title} (${MACHINE_LABELS[machine]})`;
                return (
                  <li key={machine}>
                    <div className={`track-row settings-fx-preview-row${activeTrack ? ' is-active' : ''}`}>
                      <button
                        type="button"
                        className={`track-play ${playing ? 'playing' : ''}`}
                        aria-label={actionLabel}
                        aria-current={activeTrack ? 'true' : undefined}
                        onClick={() => onActivate(track)}
                      >
                        {playing ? '❚❚' : '▶'}
                      </button>
                      <span className="platform-badge" data-platform={track.platform}>
                        {platformBadge(track.platform)}
                      </span>
                      <span className="track-main">
                        <span className="track-title-line">
                          <strong className="track-title">{track.title}</strong>
                          {durationLabel ? <span className="track-duration">{durationLabel}</span> : null}
                        </span>
                        <span className="track-artist-line muted">
                          {track.artist}
                          {track.year ? ` · ${track.year}` : ''}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <h3 className="settings-section-heading" id="settings-machines-heading">
        Machines
      </h3>
      <ul className="settings-machine-list" aria-labelledby="settings-machines-heading">
        {MACHINE_IDS.map((id) => {
          const checked = machines[id];
          const lockedOn = alone === id;
          return (
            <li key={id}>
              <label className={`settings-machine-row${checked ? ' is-on' : ''}`} data-platform={id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={lockedOn}
                  aria-label={`${MACHINE_LABELS[id]}${lockedOn ? ' (at least one machine required)' : ''}`}
                  onChange={() => onToggle(id)}
                />
                <span className="settings-machine-copy">
                  <strong>{MACHINE_LABELS[id]}</strong>
                  <span className="muted">{MACHINE_BLURBS[id]}</span>
                </span>
                <span className={`platform-badge settings-machine-badge`} data-platform={id}>
                  {id.toUpperCase()}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="settings-footnote muted">
        {active.length === MACHINE_IDS.length
          ? 'All machines are enabled.'
          : `${active.map((id) => MACHINE_LABELS[id]).join(' · ')} enabled by default.`}
        {alone ? ' Keep at least one machine on.' : ''}
      </p>
    </>
  );
}
