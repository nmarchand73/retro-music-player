import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { fetchDatabases, searchTracks } from './api';
import { DatabasePanel } from './components/DatabasePanel';
import { PlayerBar } from './components/PlayerBar';
import { TrackerVisualizer } from './components/TrackerVisualizer';
import { TrackList } from './components/TrackList';
import { useMusicPlayer } from './hooks/useMusicPlayer';
import type { DatabaseInfo, MusicPlatform, Track } from './types';
import './App.css';

function App() {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<MusicPlatform>('all');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);

  const player = useMusicPlayer();

  const runSearch = useCallback(async (searchQuery: string, searchPlatform: MusicPlatform) => {
    setLoading(true);
    try {
      const result = await searchTracks(searchQuery, searchPlatform);
      setTracks(result.tracks);
    } catch {
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDatabases()
      .then(setDatabases)
      .catch(() => setDatabases([]))
      .finally(() => setDbLoading(false));

    runSearch('', 'all');
  }, [runSearch]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query, platform);
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
            placeholder="Search titles, artists, composers…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
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
