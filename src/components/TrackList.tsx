import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlayerStatus } from '../hooks/useMusicPlayer';
import type { LibrarySearch, SearchField, Track } from '../types';
import { SEARCH_FIELD_LABELS } from '../types';
import {
  TOP_GAMES,
  RANK_SOURCES,
  type RankSourceId,
  type TopGamePlatform,
} from '../data/topGames';
import { formatTitleDuration } from '../utils/formatTime';
import { SORT_LABELS, type SortKey } from '../utils/sortTracks';
import { trackKey } from '../utils/trackKey';
import { BookmarkButton } from './BookmarkButton';
import { InsightsPanel } from './InsightsPanel';
import { SettingsPanel } from './SettingsPanel';
import { TrackCover } from './TrackCover';
import type { MachineId, MachineSettings } from '../utils/machines';

export type LibraryView = 'library' | 'bookmarks' | 'top-games' | 'insights' | 'settings';

interface TrackListProps {
  tracks: Track[];
  loading: boolean;
  currentTrackId: string | null;
  playerStatus: PlayerStatus;
  playbackDuration?: number;
  searchField: SearchField;
  query: string;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  playableOnly: boolean;
  onPlayableOnly: (playableOnly: boolean) => void;
  view: LibraryView;
  bookmarkCount: number;
  onView: (view: LibraryView) => void;
  isBookmarked: (track: Track) => boolean;
  onToggleBookmark: (track: Track) => void;
  onActivate: (track: Track) => void;
  onSearch: (search: LibrarySearch) => void;
  machines: MachineSettings;
  onToggleMachine: (id: MachineId) => void;
  onEnableAllMachines: () => void;
  machinesParam: string;
}

function platformLabel(platform: Track['platform']): string {
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
      throw new Error(`Unhandled platform: ${_exhaustive}`);
    }
  }
}

function topGamePlatformLabel(platform: TopGamePlatform): string {
  switch (platform) {
    case 'amiga':
      return 'AM';
    case 'atari':
      return 'ST';
    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unhandled top-game platform: ${_exhaustive}`);
    }
  }
}

function gameInSource(game: (typeof TOP_GAMES)[number], source: RankSourceId): boolean {
  switch (source) {
    case 'lemon':
      return game.ranks.lemon != null;
    case 'atarimania':
      return game.ranks.atarimania != null;
    case 'eab':
      return game.ranks.eab != null;
    case 'taddei':
      return game.lists.includes('taddei');
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled rank source: ${_exhaustive}`);
    }
  }
}

function sourceRank(game: (typeof TOP_GAMES)[number], source: RankSourceId): number | undefined {
  switch (source) {
    case 'lemon':
      return game.ranks.lemon;
    case 'atarimania':
      return game.ranks.atarimania;
    case 'eab':
      return game.ranks.eab;
    case 'taddei':
      return undefined;
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled rank source: ${_exhaustive}`);
    }
  }
}

function gamesForSource(source: RankSourceId, needle: string) {
  const rows = TOP_GAMES.filter((game) => gameInSource(game, source)).map((game) => ({ game }));

  switch (source) {
    case 'lemon':
      rows.sort((a, b) => (a.game.ranks.lemon ?? 999) - (b.game.ranks.lemon ?? 999));
      break;
    case 'atarimania':
      rows.sort((a, b) => (a.game.ranks.atarimania ?? 999) - (b.game.ranks.atarimania ?? 999));
      break;
    case 'eab':
      rows.sort((a, b) => (a.game.ranks.eab ?? 999) - (b.game.ranks.eab ?? 999));
      break;
    case 'taddei':
      rows.sort((a, b) => a.game.title.localeCompare(b.game.title));
      break;
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled rank source: ${_exhaustive}`);
    }
  }

  if (!needle) return rows;
  return rows.filter(({ game }) => game.title.toLowerCase().includes(needle));
}

function TopGamesPanel({ onSearch }: { onSearch: (search: LibrarySearch) => void }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();

  const columns = useMemo(
    () =>
      RANK_SOURCES.map((source) => ({
        source,
        games: gamesForSource(source.id, needle),
      })),
    [needle],
  );

  return (
    <>
      <header className="panel-header top-games-header">
        <div>
          <h2>Top Games</h2>
          <p className="muted">Lemon, AtariM, Music (EAB), and Taddei — click to search by game</p>
        </div>
        <label className="search-select top-games-filter">
          <span>Filter lists</span>
          <input
            type="search"
            value={filter}
            aria-label="Filter top games"
            placeholder="Filter Top Games…"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </header>
      <div className="top-games-columns">
        {columns.map(({ source, games }) => (
          <section
            key={source.id}
            className={`top-games-column source-${source.id}`}
            aria-labelledby={`top-games-${source.id}`}
          >
            <header className="top-games-column-header">
              <h3 id={`top-games-${source.id}`}>{source.short}</h3>
              <p className="muted">
                {source.mode === 'list' ? 'A–Z list' : 'Ranked'} · {games.length}
              </p>
            </header>
            <ul className="top-games-list">
              {games.map(({ game }, index) => {
                const rank = sourceRank(game, source.id);
                const displayRank = source.mode === 'ranked' && rank != null ? rank : index + 1;
                return (
                  <li key={game.title}>
                    <button
                      type="button"
                      className="top-game-row"
                      aria-label={`Search game ${game.title} in ${source.short}`}
                      onClick={() =>
                        onSearch({
                          query: game.title,
                          field: 'game',
                          platform: 'all',
                        })
                      }
                    >
                      <span className="top-game-rank">
                        {source.mode === 'list' ? '·' : String(displayRank).padStart(3, '0')}
                      </span>
                      <span className="top-game-main">
                        <span className="top-game-title">{game.title}</span>
                        <span className="top-game-badges">
                          {game.platforms.map((entry) => (
                            <span key={entry} className="chip" data-platform={entry}>
                              {topGamePlatformLabel(entry)}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {games.length === 0 ? (
              <p className="empty-search">No matches in {source.short}.</p>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}

function SearchFacetButton({
  className,
  label,
  value,
  children,
  dataPlatform,
  onSearch,
}: {
  className: string;
  label: string;
  value: string;
  children?: ReactNode;
  dataPlatform?: Track['platform'];
  onSearch: () => void;
}) {
  return (
    <button
      type="button"
      className={`search-facet ${className}`}
      data-platform={dataPlatform}
      aria-label={`Search ${label} ${value}`}
      onClick={(event) => {
        event.stopPropagation();
        onSearch();
      }}
    >
      {children ?? value}
    </button>
  );
}

function viewHeading(view: LibraryView): string {
  switch (view) {
    case 'library':
      return 'Library Results';
    case 'bookmarks':
      return 'Bookmarks';
    case 'top-games':
      return 'Top Games';
    case 'insights':
      return 'Insights';
    case 'settings':
      return 'Settings';
    default: {
      const _exhaustive: never = view;
      throw new Error(`Unhandled library view: ${_exhaustive}`);
    }
  }
}

export function TrackList({
  tracks,
  loading,
  currentTrackId,
  playerStatus,
  playbackDuration = 0,
  searchField,
  query,
  sort,
  onSort,
  playableOnly,
  onPlayableOnly,
  view,
  bookmarkCount,
  onView,
  isBookmarked,
  onToggleBookmark,
  onActivate,
  onSearch,
  machines,
  onToggleMachine,
  onEnableAllMachines,
  machinesParam,
}: TrackListProps) {
  const activeItemRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!currentTrackId) return;
    const frame = window.requestAnimationFrame(() => {
      activeItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentTrackId]);

  const heading = viewHeading(view);
  const tabs = (
    <div className="view-tabs" role="tablist" aria-label="Library views">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'library'}
        onClick={() => onView('library')}
      >
        Library
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'top-games'}
        onClick={() => onView('top-games')}
      >
        Top Games
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'insights'}
        onClick={() => onView('insights')}
      >
        Insights
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'bookmarks'}
        onClick={() => onView('bookmarks')}
      >
        Bookmarks{bookmarkCount > 0 ? ` (${bookmarkCount})` : ''}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'settings'}
        onClick={() => onView('settings')}
      >
        Settings
      </button>
    </div>
  );

  const listTools = (
    <div className="list-tools">
      <label className="playable-filter">
        <input
          type="checkbox"
          checked={playableOnly}
          aria-label="Playable only"
          onChange={(event) => onPlayableOnly(event.target.checked)}
        />
        Playable only
      </label>
      <label className="search-select sort-select">
        <span>Sort</span>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(event) => onSort(event.target.value as SortKey)}
        >
          {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  if (view === 'top-games') {
    return (
      <section className="panel track-panel">
        {tabs}
        <TopGamesPanel onSearch={onSearch} />
      </section>
    );
  }

  if (view === 'insights') {
    return (
      <section className="panel track-panel insights-panel">
        {tabs}
        <InsightsPanel onSearch={onSearch} machines={machines} machinesParam={machinesParam} />
      </section>
    );
  }

  if (view === 'settings') {
    return (
      <section className="panel track-panel settings-panel">
        {tabs}
        <SettingsPanel machines={machines} onToggle={onToggleMachine} onEnableAll={onEnableAllMachines} />
      </section>
    );
  }

  if (loading && tracks.length === 0 && view === 'library') {
    return (
      <section className="panel track-panel">
        {tabs}
        <p className="muted">Searching the archive…</p>
      </section>
    );
  }

  if (tracks.length === 0) {
    return (
      <section className="panel track-panel">
        {tabs}
        <header className="panel-header">
          <h2>{heading}</h2>
          {listTools}
        </header>
        <p className="empty-search">
          {view === 'bookmarks'
            ? 'No bookmarks yet. Mark a title in the library to keep it here.'
            : `No tracks found for ${SEARCH_FIELD_LABELS[searchField].toLowerCase()}. Try another term, or switch the search field.`}
        </p>
      </section>
    );
  }

  const subtitle =
    view === 'bookmarks'
      ? `${tracks.length} saved ${tracks.length === 1 ? 'title' : 'titles'}`
      : query.trim()
        ? `${tracks.length} matches · ${SEARCH_FIELD_LABELS[searchField]}`
        : `${tracks.length} tracks from the archive · type above to search`;

  return (
    <section className="panel track-panel">
      {tabs}
      <header className="panel-header">
        <div>
          <h2>{heading}</h2>
          <p className="muted">{loading && view === 'library' ? 'Updating…' : subtitle}</p>
        </div>
        {listTools}
      </header>
      <ul className="track-list">
        {tracks.map((track) => {
          const id = trackKey(track);
          const active = currentTrackId === id;
          const playing = active && playerStatus === 'playing';
          const action = playing ? 'Pause' : active && playerStatus === 'paused' ? 'Resume' : 'Play';
          const durationLabel = formatTitleDuration(
            track.durationSeconds ?? (active && playbackDuration > 0 ? playbackDuration : null),
          );
          const actionLabel = durationLabel ? `${action} ${track.title}, ${durationLabel}` : `${action} ${track.title}`;
          const bookmarked = isBookmarked(track);
          return (
            <li
              key={id}
              ref={active ? activeItemRef : undefined}
              className={active ? 'active' : ''}
            >
              <div className={`track-row${active ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className={`track-play ${playing ? 'playing' : ''}`}
                  aria-label={actionLabel}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onActivate(track)}
                >
                  {playing ? '❚❚' : '▶'}
                </button>
                {track.coverUrl ? (
                  track.game ? (
                    <button
                      type="button"
                      className="track-cover-button"
                      aria-label={`Search game ${track.game}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSearch({ query: track.game ?? '', field: 'game' });
                      }}
                    >
                      <TrackCover track={track} showPlaceholder={false} />
                    </button>
                  ) : (
                    <span className="track-cover-button is-static">
                      <TrackCover track={track} showPlaceholder={false} />
                    </span>
                  )
                ) : null}
                <SearchFacetButton
                  className="platform-badge"
                  label="platform"
                  value={platformLabel(track.platform)}
                  dataPlatform={track.platform}
                  onSearch={() => onSearch({ platform: track.platform })}
                />
                <span className="track-main">
                  <span className="track-title-line">
                    <SearchFacetButton
                      className="track-title"
                      label="title"
                      value={track.title}
                      onSearch={() => onSearch({ query: track.title, field: 'title' })}
                    >
                      <strong>{track.title}</strong>
                    </SearchFacetButton>
                    {durationLabel && <span className="track-duration">{durationLabel}</span>}
                  </span>
                  <span className="track-artist-line">
                    <SearchFacetButton
                      className="track-artist"
                      label="author"
                      value={track.artist}
                      onSearch={() => onSearch({ query: track.artist, field: 'author' })}
                    />
                    {track.year ? <span className="track-year"> · {track.year}</span> : null}
                    {track.game ? (
                      <>
                        <span className="track-sep"> · </span>
                        <SearchFacetButton
                          className="track-game"
                          label="game"
                          value={track.game}
                          onSearch={() => onSearch({ query: track.game ?? '', field: 'game' })}
                        />
                      </>
                    ) : null}
                    {track.notes && !track.game ? (
                      <span className="track-notes"> · {track.notes}</span>
                    ) : null}
                  </span>
                </span>
                <span className="track-meta">
                  {active && (
                    <span className="chip now-playing">
                      {playerStatus === 'loading' ? 'Loading' : playing ? 'Playing' : 'Paused'}
                    </span>
                  )}
                  <span className="chip">{track.format}</span>
                </span>
                <BookmarkButton
                  title={track.title}
                  bookmarked={bookmarked}
                  onToggle={() => onToggleBookmark(track)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
