import type { Track } from '../types';

interface TrackListProps {
  tracks: Track[];
  loading: boolean;
  currentTrackId: string | null;
  onPlay: (track: Track) => void;
}

const sourceLabels = {
  modarchive: 'Mod Archive',
  sndh: 'SNDH',
  local: 'Local',
};

export function TrackList({ tracks, loading, currentTrackId, onPlay }: TrackListProps) {
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
        <p className="muted">No tracks found. Try a different search or platform filter.</p>
      </section>
    );
  }

  return (
    <section className="panel track-panel">
      <header className="panel-header">
        <h2>Library Results</h2>
        <p className="muted">{tracks.length} tracks</p>
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
                </span>
                <span className="track-meta">
                  <span className="chip">{track.format}</span>
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
