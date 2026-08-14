import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlayerStatus } from '../hooks/useMusicPlayer';
import type { LibrarySearch, SearchField, Track } from '../types';
import { SEARCH_FIELD_LABELS } from '../types';
import { TOP_GAMES, RANK_SOURCES, type RankSourceId, type TopGamePlatform } from '../data/topGames';
import { formatTitleDuration } from '../utils/formatTime';
import { SORT_LABELS, type SortKey } from '../utils/sortTracks';
import { trackKey } from '../utils/trackKey';
import { BookmarkButton } from './BookmarkButton';
import { TrackCover } from './TrackCover';

export type LibraryView = 'library' | 'bookmarks' | 'top-games';

interface TrackListProps {
  tracks: Track[];
  loading: boolean;
  currentTrackId: string | null;
  playerStatus: PlayerStatus;
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
}

function platformLabel(platform: Track['platform']): string {
  switch (platform) {
    case 'amiga':
      return 'AMIGA';
    case 'atari':
      return 'ATARI';
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

function rankSourceShort(source: RankSourceId): string {
  switch (source) {
    case 'lemon':
      return 'Lemon';
    case 'atarimania':
      return 'AtariM';
    case 'taddei':
      return 'Taddei';
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled rank source: ${_exhaustive}`);
    }
  }
}

function gameInSource(game: (typeof TOP_GAMES)[number], source: RankSourceId): boolean {
  switch (source) {
    case 'lemon':
      return game.ranks.lemon != null;
    case 'atarimania':
      return game.ranks.atarimania != null;
    case 'taddei':
      return game.lists.includes('taddei');
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled rank source: ${_exhaustive}`);
    }
  }
}

function sourceBadgeLabel(source: RankSourceId, rank: number | undefined): string {
  const short = rankSourceShort(source);
  switch (source) {
    case 'lemon':
    case 'atarimania':
      return rank == null ? short : `${short} #${rank}`;
    case 'taddei':
      return short;
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled rank source: ${_exhaustive}`);
    }
  }
}

type SourceFilter = 'all' | RankSourceId;

function TopGamesPanel({ onSearch }: { onSearch: (search: LibrarySearch) => void }) {
  const [filter, setFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const games = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let rows = TOP_GAMES.map((game, index) => ({ game, index }));

    if (sourceFilter !== 'all') {
      rows = rows.filter(({ game }) => gameInSource(game, sourceFilter));
      if (sourceFilter === 'lemon') {
        rows.sort((a, b) => (a.game.ranks.lemon ?? 999) - (b.game.ranks.lemon ?? 999));
      } else if (sourceFilter === 'atarimania') {
        rows.sort((a, b) => (a.game.ranks.atarimania ?? 999) - (b.game.ranks.atarimania ?? 999));
      } else if (sourceFilter === 'taddei') {
        rows.sort((a, b) => a.game.title.localeCompare(b.game.title));
      }
    }

    if (needle) {
      rows = rows.filter(({ game }) => game.title.toLowerCase().includes(needle));
    }

    return rows.map((row, displayIndex) => ({
      ...row,
      displayRank: displayIndex + 1,
    }));
  }, [filter, sourceFilter]);

  return (
    <>
      <header className="panel-header top-games-header">
        <div>
          <h2>Top Games</h2>
          <p className="muted">
            {games.length}
            {sourceFilter === 'all' ? ` of ${TOP_GAMES.length}` : ''} landmark titles — click to search by
            game
          </p>
          <div className="top-games-sources" role="group" aria-label="Filter by list origin">
            <button
              type="button"
              className={`top-games-source${sourceFilter === 'all' ? ' is-active' : ''}`}
              aria-pressed={sourceFilter === 'all'}
              onClick={() => setSourceFilter('all')}
            >
              All
            </button>
            {RANK_SOURCES.map((source) => (
              <button
                key={source.id}
                type="button"
                className={`top-games-source source-${source.id}${sourceFilter === source.id ? ' is-active' : ''}`}
                aria-pressed={sourceFilter === source.id}
                title={source.label}
                onClick={() => setSourceFilter(source.id)}
              >
                {source.short}
                {source.mode === 'list' ? ' · list' : ''}
              </button>
            ))}
          </div>
        </div>
        <label className="search-select top-games-filter">
          <span>Filter list</span>
          <input
            type="search"
            value={filter}
            aria-label="Filter top games"
            placeholder="Filter Top Games…"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </header>
      <ul className="top-games-list">
        {games.map(({ game, displayRank }) => {
          const badges = RANK_SOURCES.flatMap((source) => {
            if (!gameInSource(game, source.id)) return [];
            const rank =
              source.id === 'lemon'
                ? game.ranks.lemon
                : source.id === 'atarimania'
                  ? game.ranks.atarimania
                  : undefined;
            return [{ source: source.id, rank }];
          });
          return (
            <li key={game.title}>
              <button
                type="button"
                className="top-game-row"
                aria-label={`Search game ${game.title}`}
                onClick={() =>
                  onSearch({
                    query: game.title,
                    field: 'game',
                    platform: 'all',
                  })
                }
              >
                <span className="top-game-rank">{String(displayRank).padStart(3, '0')}</span>
                <span className="top-game-main">
                  <span className="top-game-title">{game.title}</span>
                  <span className="top-game-badges">
                    {badges.map(({ source, rank }) => (
                      <span key={source} className={`chip rank-badge source-${source}`}>
                        {sourceBadgeLabel(source, rank)}
                      </span>
                    ))}
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
        <p className="empty-search">No Top Games match that filter.</p>
      ) : null}
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
        aria-selected={view === 'bookmarks'}
        onClick={() => onView('bookmarks')}
      >
        Bookmarks{bookmarkCount > 0 ? ` (${bookmarkCount})` : ''}
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
          const durationLabel = formatTitleDuration(track.durationSeconds);
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
                {track.game ? (
                  <button
                    type="button"
                    className="track-cover-button"
                    aria-label={`Search game ${track.game}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSearch({ query: track.game ?? '', field: 'game' });
                    }}
                  >
                    <TrackCover track={track} />
                  </button>
                ) : (
                  <span className="track-cover-button is-static">
                    <TrackCover track={track} />
                  </span>
                )}
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
                  </span>
                  {track.game && (
                    <SearchFacetButton
                      className="track-game"
                      label="game"
                      value={track.game}
                      onSearch={() => onSearch({ query: track.game ?? '', field: 'game' })}
                    />
                  )}
                  {track.notes && !track.game && <span className="track-notes">{track.notes}</span>}
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
