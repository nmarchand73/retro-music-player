import type { SearchField, Track } from '../types';
import { SEARCH_FIELD_LABELS } from '../types';

interface TrackListProps {
  tracks: Track[];
  loading: boolean;
  currentTrackId: string | null;
  searchField: SearchField;
  onPlay: (track: Track) => void;
}

const sourceLabels = {
  modarchive: 'Mod Archive',
  sndh: 'SNDH',
  local: 'Local',
};

export function TrackList({ tracks, loading, currentTrackId, searchField, onPlay }: TrackListProps) {
  if (loading) {
    return (
      <section className="panel track-panel">
        <p className="muted">Searching music libraries…</p>
      </section>
    );
  }

  if (tracks.length === 0) {
    return (
      <section className="panel track-panel">
        <p className="muted">
          No tracks found for {SEARCH_FIELD_LABELS[searchField].toLowerCase()}. Try another term or search field.
        </p>
      </section>
    );
  }

  return (
    <section className="panel track-panel">
      <header className="panel-header">
        <h2>Library Results</h2>
        <p className="muted">
          {tracks.length} tracks · {SEARCH_FIELD_LABELS[searchField]}
        </p>
      </header>
      <ul className="track-list">
        {tracks.map((track) => {
          const active = currentTrackId === `${track.source}:${track.id}`;
          return (
            <li key={`${track.source}:${track.id}`} className={active ? 'active' : ''}>
              <button type="button" className="track-row" onClick={() => onPlay(track)}>
                <span className="platform-badge" data-platform={track.platform}>
                  {track.platform === 'amiga' ? 'AMIGA' : 'ATARI'}
                </span>
                <span className="track-main">
                  <strong>{track.title}</strong>
                  <span className="track-artist">{track.artist}</span>
                  {track.game && <span className="track-game">Game: {track.game}</span>}
                  {track.notes && !track.game && <span className="track-notes">{track.notes}</span>}
                </span>
                <span className="track-meta">
                  <span className="chip">{track.format}</span>
                  {track.genre && <span className="chip subtle">{track.genre}</span>}
                  <span className="chip subtle">{sourceLabels[track.source]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
