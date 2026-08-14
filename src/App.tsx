import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDatabases, reportAmigaDuration, searchTracks } from './api';
import { DatabasePanel } from './components/DatabasePanel';
import { PlayerBar } from './components/PlayerBar';
import { TrackerVisualizer } from './components/TrackerVisualizer';
import { TrackList, type LibraryView } from './components/TrackList';
import { useMusicPlayer } from './hooks/useMusicPlayer';
import { useBookmarks } from './hooks/useBookmarks';
import { useMachineSettings } from './hooks/useMachineSettings';
import type { DatabaseInfo, LibrarySearch, MusicPlatform, SearchField, Track } from './types';
import { SEARCH_FIELD_LABELS, SEARCH_FIELD_PLACEHOLDERS } from './types';
import { sortTracks, type SortKey } from './utils/sortTracks';
import { isTrackPlayable } from './utils/amigaPlayable';
import { enabledMachines, MACHINE_LABELS, machinesQueryValue, type MachineId } from './utils/machines';
import { trackKey } from './utils/trackKey';
import './App.css';

function App() {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<MusicPlatform>('all');
  const [field, setField] = useState<SearchField>('any');
  const [sort, setSort] = useState<SortKey>('match');
  const [playableOnly, setPlayableOnly] = useState(true);
  const [uadeAvailable, setUadeAvailable] = useState(false);
  const [view, setView] = useState<LibraryView>('library');
  const [playerMinimized, setPlayerMinimized] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);
  const { machines, toggleMachine, enableAll } = useMachineSettings();
  const activeMachines = useMemo(() => enabledMachines(machines), [machines]);
  const machinesParam = useMemo(() => machinesQueryValue(machines), [machines]);

  const player = useMusicPlayer();
  const { bookmarks, isBookmarked, toggleBookmark, patchBookmark } = useBookmarks();
  const tracksRef = useRef(tracks);
  const currentRef = useRef(player.currentTrack);
  const playRef = useRef(player.playTrack);
  const reportedDurationRef = useRef<string | null>(null);
  const visibleTracks = useMemo(() => {
    const source = view === 'bookmarks' ? bookmarks : tracks;
    const sorted =
      view === 'bookmarks' && sort === 'match' ? source : sortTracks(source, sort, query);
    return playableOnly ? sorted.filter((track) => isTrackPlayable(track, uadeAvailable)) : sorted;
  }, [bookmarks, playableOnly, query, sort, tracks, uadeAvailable, view]);
  tracksRef.current = visibleTracks;
  currentRef.current = player.currentTrack;
  playRef.current = player.playTrack;

  const runSearch = useCallback(
    async (
      searchQuery: string,
      searchPlatform: MusicPlatform,
      searchField: SearchField,
      searchPlayableOnly: boolean,
      searchMachines: string,
    ) => {
      setLoading(true);
      try {
        const result = await searchTracks(
          searchQuery,
          searchPlatform,
          searchField,
          searchPlayableOnly,
          searchMachines,
        );
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

    fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { uade?: boolean } | null) => {
        if (data && typeof data.uade === 'boolean') setUadeAvailable(data.uade);
      })
      .catch(() => setUadeAvailable(false));
  }, []);

  useEffect(() => {
    if (platform !== 'all' && !machines[platform as MachineId]) {
      setPlatform('all');
    }
  }, [machines, platform]);

  useEffect(() => {
    const delay = query.trim() ? 280 : 0;
    const timer = window.setTimeout(() => {
      void runSearch(query, platform, field, playableOnly, machinesParam);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [query, platform, field, playableOnly, machinesParam, runSearch]);

  const currentTrackId = player.currentTrack ? trackKey(player.currentTrack) : null;

  useEffect(() => {
    reportedDurationRef.current = null;
  }, [currentTrackId]);

  useEffect(() => {
    const track = player.currentTrack;
    const duration = player.duration;
    if (!track || track.source !== 'amiga' || !(duration > 0.5)) return;

    const key = `${trackKey(track)}:${Math.round(duration)}`;
    if (reportedDurationRef.current === key) return;
    if (track.durationSeconds != null && Math.abs(track.durationSeconds - duration) < 1) {
      reportedDurationRef.current = key;
      return;
    }

    reportedDurationRef.current = key;
    setTracks((prev) =>
      prev.map((entry) =>
        trackKey(entry) === trackKey(track) ? { ...entry, durationSeconds: duration } : entry,
      ),
    );
    patchBookmark(track, { durationSeconds: duration });
    void reportAmigaDuration(track.id, duration);
  }, [patchBookmark, player.currentTrack, player.duration]);

  const displayTrack = useMemo(() => {
    const current = player.currentTrack;
    if (!current) return null;
    const match = bookmarks.find((entry) => trackKey(entry) === currentTrackId);
    if (!match) return current;
    if (match.coverUrl === current.coverUrl && match.game === current.game) return current;
    return {
      ...current,
      coverUrl: match.coverUrl ?? current.coverUrl,
      game: current.game ?? match.game,
    };
  }, [bookmarks, currentTrackId, player.currentTrack]);
  const currentIndex = useMemo(() => {
    if (!player.currentTrack) return -1;
    return visibleTracks.findIndex((track) => trackKey(track) === currentTrackId);
  }, [currentTrackId, player.currentTrack, visibleTracks]);
  const previousTrack = currentIndex > 0 ? visibleTracks[currentIndex - 1] : undefined;
  const nextTrack = currentIndex >= 0 ? visibleTracks[currentIndex + 1] : undefined;

  const playTrack = player.playTrack;
  const pause = player.pause;
  const resume = player.resume;
  const seek = player.seek;
  const setOnEnded = player.setOnEnded;

  const playAdjacent = useCallback((track: Track | undefined) => {
    if (track) playTrack(track);
  }, [playTrack]);

  useEffect(() => {
    setOnEnded(() => {
      const list = tracksRef.current;
      const current = currentRef.current;
      if (!current) return;
      const index = list.findIndex((track) => trackKey(track) === trackKey(current));
      const following = index >= 0 ? list[index + 1] : undefined;
      if (following) playRef.current(following);
    });
    return () => setOnEnded(null);
  }, [setOnEnded]);

  const handleFacetSearch = useCallback((search: LibrarySearch) => {
    setView('library');
    if (search.query !== undefined) setQuery(search.query);
    if (search.field !== undefined) setField(search.field);
    if (search.platform !== undefined) setPlatform(search.platform);
    // Amiga UnExoticA often uses custom formats; show them when browsing by game.
    if (search.field === 'game') setPlayableOnly(false);
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query, platform, field, playableOnly, machinesParam);
  };

  const handleActivate = useCallback(
    (track: Track) => {
      if (currentTrackId === trackKey(track)) {
        if (player.status === 'playing') {
          pause();
          return;
        }
        if (player.status === 'paused') {
          resume();
          return;
        }
      }
      void playTrack(track);
    },
    [currentTrackId, pause, playTrack, player.status, resume],
  );

  const handlePlayPause = useCallback(() => {
    if (player.status === 'playing') {
      pause();
      return;
    }
    if (player.status === 'paused') {
      resume();
      return;
    }
    if (player.currentTrack) void playTrack(player.currentTrack);
  }, [pause, playTrack, player.currentTrack, player.status, resume]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (event.code === 'Space') {
        event.preventDefault();
        handlePlayPause();
        return;
      }
      if (event.code === 'ArrowLeft' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        playAdjacent(previousTrack);
        return;
      }
      if (event.code === 'ArrowRight' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        playAdjacent(nextTrack);
        return;
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        seek(Math.max(0, player.position - 5));
        return;
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        const max = player.duration > 0 ? player.duration : player.position + 5;
        seek(Math.min(max, player.position + 5));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlayPause, nextTrack, playAdjacent, player.duration, player.position, previousTrack, seek]);

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-top">
          <div className="hero-copy">
            <p className="eyebrow">Retro Music Library</p>
            <h1>Atari · Amiga · CPC · C64</h1>
          </div>
          <DatabasePanel databases={databases} loading={dbLoading} />
        </div>
        <form className="search-form" onSubmit={handleSubmit}>
          <label className="search-select search-query">
            <span>Search</span>
            <input
              type="search"
              name="q"
              autoFocus
              autoComplete="off"
              aria-label="Search music"
              placeholder={SEARCH_FIELD_PLACEHOLDERS[field]}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="search-select">
            <span>In</span>
            <select
              aria-label="Search field"
              value={field}
              onChange={(event) => setField(event.target.value as SearchField)}
            >
              {Object.entries(SEARCH_FIELD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="search-select">
            <span>Platform</span>
            <select
              aria-label="Platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as MusicPlatform)}
            >
              <option value="all">
                {activeMachines.length === 4 ? 'All platforms' : `Enabled (${activeMachines.length})`}
              </option>
              {activeMachines.map((id) => (
                <option key={id} value={id}>
                  {MACHINE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Search</button>
        </form>
      </header>

      <main className="content-grid">
        <TrackList
          tracks={visibleTracks}
          loading={loading}
          currentTrackId={currentTrackId}
          playerStatus={player.status}
          playbackDuration={player.duration}
          searchField={field}
          query={query}
          sort={sort}
          onSort={setSort}
          playableOnly={playableOnly}
          onPlayableOnly={setPlayableOnly}
          view={view}
          bookmarkCount={bookmarks.length}
          onView={setView}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggleBookmark}
          onActivate={handleActivate}
          onSearch={handleFacetSearch}
          machines={machines}
          onToggleMachine={toggleMachine}
          onEnableAllMachines={enableAll}
          machinesParam={machinesParam}
        />
      </main>

      <div className={`player-dock${playerMinimized ? ' is-minimized' : ''}`}>
        <div className="player-dock-toolbar">
          <button
            type="button"
            className="player-dock-toggle"
            aria-label={playerMinimized ? 'Expand player' : 'Collapse player'}
            aria-expanded={!playerMinimized}
            onClick={() => setPlayerMinimized((value) => !value)}
          >
            <span className="player-dock-grip" aria-hidden="true" />
            <span className="player-dock-toggle-label">
              <svg className="player-dock-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {playerMinimized ? (
                  <path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
                ) : (
                  <path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                )}
              </svg>
              <span>{playerMinimized ? 'Expand' : 'Collapse'}</span>
            </span>
          </button>
        </div>
        {!playerMinimized ? (
          <TrackerVisualizer
            song={player.trackerSong}
            playback={player.trackerPlayback}
            analyser={player.analyser}
            active={player.status === 'playing' || player.status === 'paused'}
            playing={player.status === 'playing'}
          />
        ) : null}
        <PlayerBar
          track={displayTrack}
          status={player.status}
          position={player.position}
          duration={player.duration}
          error={player.error}
          hasPrevious={Boolean(previousTrack)}
          hasNext={Boolean(nextTrack)}
          bookmarked={player.currentTrack ? isBookmarked(player.currentTrack) : false}
          onToggleBookmark={() => {
            if (player.currentTrack) toggleBookmark(player.currentTrack);
          }}
          minimized={playerMinimized}
          analyser={player.analyser}
          onPlayPause={handlePlayPause}
          onStop={player.stop}
          onSeek={player.seek}
          onPrevious={() => playAdjacent(previousTrack)}
          onNext={() => playAdjacent(nextTrack)}
        />
      </div>
    </div>
  );
}

export default App;
