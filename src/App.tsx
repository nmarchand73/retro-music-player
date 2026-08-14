import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { fetchDatabases, searchTracks } from './api';
import { DatabasePanel } from './components/DatabasePanel';
import { PlayerBar } from './components/PlayerBar';
import { TrackerVisualizer } from './components/TrackerVisualizer';
import { TrackList } from './components/TrackList';
import { useMusicPlayer } from './hooks/useMusicPlayer';
import type { DatabaseInfo, MusicPlatform, SearchField, Track } from './types';
import { SEARCH_FIELD_LABELS, SEARCH_FIELD_PLACEHOLDERS } from './types';
import './App.css';

function App() {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<MusicPlatform>('all');
  const [field, setField] = useState<SearchField>('any');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);

  const player = useMusicPlayer();

  const runSearch = useCallback(
    async (searchQuery: string, searchPlatform: MusicPlatform, searchField: SearchField) => {
      setLoading(true);
      try {
        const result = await searchTracks(searchQuery, searchPlatform, searchField);
        setTracks(result.tracks);
      } catch {
        setTracks([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchDatabases()
      .then(setDatabases)
      .catch(() => setDatabases([]))
      .finally(() => setDbLoading(false));

    runSearch('', 'all', 'any');
  }, [runSearch]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query, platform, field);
  };

  const currentTrackId = player.currentTrack
    ? `${player.currentTrack.source}:${player.currentTrack.id}`
    : null;

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Retro Music Library</p>
          <h1>Atari ST &amp; Amiga Player</h1>
          <p className="lede">
            Browse and play tracker modules from The Mod Archive and YM2149 chiptunes from the
            official SNDH archive.
          </p>
        </div>
        <form className="search-form" onSubmit={handleSubmit}>
          <input
            type="search"
            placeholder={SEARCH_FIELD_PLACEHOLDERS[field]}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select value={field} onChange={(event) => setField(event.target.value as SearchField)}>
            {Object.entries(SEARCH_FIELD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={platform} onChange={(event) => setPlatform(event.target.value as MusicPlatform)}>
            <option value="all">All platforms</option>
            <option value="amiga">Amiga</option>
            <option value="atari">Atari ST</option>
          </select>
          <button type="submit">Search</button>
        </form>
      </header>

      <main className="content-grid">
        <TrackerVisualizer
          song={player.trackerSong}
          playback={player.trackerPlayback}
          analyser={player.analyser}
          active={player.status === 'playing' || player.status === 'paused'}
        />
        <DatabasePanel databases={databases} loading={dbLoading} />
        <TrackList
          tracks={tracks}
          loading={loading}
          currentTrackId={currentTrackId}
          searchField={field}
          onPlay={player.playTrack}
        />
      </main>

      <PlayerBar
        track={player.currentTrack}
        status={player.status}
        position={player.position}
        duration={player.duration}
        error={player.error}
        onPause={player.pause}
        onResume={player.resume}
        onStop={player.stop}
      />
    </div>
  );
}

export default App;
