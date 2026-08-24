import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlayerStatus } from '../hooks/useMusicPlayer';
import type { LibrarySearch, SearchField, Track } from '../types';
import { SEARCH_FIELD_LABELS } from '../types';
import {
  RANKINGS_META,
  MUSIC_RANKINGS_META,
  platformColumnsFor,
  topEntriesFor,
  type PlatformColumn,
  type RankingKind,
  type TopGame,
} from '../data/topGames';
import { formatTitleDuration } from '../utils/formatTime';
import { SORT_LABELS, type SortKey } from '../utils/sortTracks';
import { trackKey } from '../utils/trackKey';
import { ORIGIN_KIND_LABELS } from '../utils/trackOrigin';
import { BookmarkButton } from './BookmarkButton';
import { InsightsPanel } from './InsightsPanel';
import { SettingsPanel } from './SettingsPanel';
import { TrackCover } from './TrackCover';
import type { MachineId, MachineSettings } from '../utils/machines';
import type { AudioFxSettings, FxPreset } from '../lib/audioFxBus';
import type { FxPreviewTracks } from '../hooks/useFxPreviewTracks';
import type { VisualizerMode } from '../utils/visualizerMode';

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
  originalOnly: boolean;
  onOriginalOnly: (originalOnly: boolean) => void;
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
  audioFx: AudioFxSettings;
  onAudioFxEnabled: (enabled: boolean) => void;
  onAudioFxPreset: (preset: FxPreset) => void;
  onAudioFxAmount: (amount: number) => void;
  visualizerMode: VisualizerMode;
  onVisualizerMode: (mode: VisualizerMode) => void;
  fxPreviewTracks: FxPreviewTracks;
  fxPreviewLoading: boolean;
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
    case 'arcade':
      return 'ARCADE';
    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unhandled platform: ${_exhaustive}`);
    }
  }
}

function platformSortRank(game: TopGame, column: PlatformColumn): number {
  return game.ranks[column.rankKey] ?? 900;
}

function gamesForPlatform(entries: TopGame[], column: PlatformColumn, needle: string) {
  const rows = entries
    .filter((game) => game.platforms.includes(column.id) && game.ranks[column.rankKey] != null)
    .map((game) => ({ game }));

  rows.sort((a, b) => {
    const rankDelta = platformSortRank(a.game, column) - platformSortRank(b.game, column);
    if (rankDelta !== 0) return rankDelta;
    return a.game.title.localeCompare(b.game.title);
  });

  if (!needle) return rows;
  return rows.filter(
    ({ game }) =>
      game.title.toLowerCase().includes(needle) ||
      game.searchQuery.toLowerCase().includes(needle),
  );
}

function TopGamesPanel({ onSearch }: { onSearch: (search: LibrarySearch) => void }) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<RankingKind>('music');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const needle = filter.trim().toLowerCase();
  const columnsDef = platformColumnsFor(kind);
  const entries = topEntriesFor(kind);

  const columns = useMemo(
    () =>
      columnsDef.map((column) => ({
        column,
        games: gamesForPlatform(entries, column, needle),
      })),
    [columnsDef, entries, needle],
  );

  const headerBlurb =
    kind === 'music'
      ? `${MUSIC_RANKINGS_META.title} — click a title to search; open History for a short background`
      : `Official game lists per machine (Amiga: 101 Jeux Amiga) — click a title to search; open History for a short background${
          RANKINGS_META.generatedAt ? ` · lists from ${RANKINGS_META.generatedAt}` : ''
        }`;

  return (
    <>
      <header className="panel-header top-games-header">
        <div>
          <h2>BEST</h2>
          <p className="muted">{headerBlurb}</p>
          <div className="top-games-kind" role="tablist" aria-label="Ranking type">
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'music'}
              className={kind === 'music' ? 'is-active' : undefined}
              onClick={() => setKind('music')}
            >
              Best music
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'games'}
              className={kind === 'games' ? 'is-active' : undefined}
              onClick={() => setKind('games')}
            >
              Best games
            </button>
          </div>
        </div>
        <label className="search-select top-games-filter">
          <span>Filter lists</span>
          <input
            type="search"
            value={filter}
            aria-label="Filter best lists"
            placeholder="Filter Best…"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </header>
      <div className="top-games-columns">
        {columns.map(({ column, games }) => (
          <section
            key={`${kind}-${column.rankKey}`}
            className={`top-games-column source-${column.rankKey}`}
            aria-labelledby={`top-games-${kind}-${column.rankKey}`}
          >
            <header className="top-games-column-header">
              <h3 id={`top-games-${kind}-${column.rankKey}`}>{column.short}</h3>
              <p className="muted">
                <a
                  className="top-games-source-link"
                  href={column.url}
                  target="_blank"
                  rel="noreferrer"
                  title={[column.method, column.note].filter(Boolean).join(' — ')}
                >
                  {column.label}
                </a>
                {' · '}
                {games.length}
              </p>
            </header>
            <ul className="top-games-list">
              {games.map(({ game }, index) => {
                const rank = game.ranks[column.rankKey];
                const displayRank = rank != null ? rank : index + 1;
                const searchDiffers =
                  game.searchQuery.toLowerCase() !== game.title.toLowerCase();
                const listLabel =
                  kind === 'music'
                    ? 'music Top 100'
                    : column.rankKey === 'arcade-fr'
                      ? 'Arcade FR diffusions'
                      : column.id === 'arcade'
                        ? 'VGMRips Top'
                        : column.id === 'amiga'
                          ? '101 Jeux'
                          : 'Top 100';
                const rowKey = `${kind}-${column.rankKey}-${displayRank}-${game.title}`;
                const expanded = expandedKey === rowKey;
                const hasHistory = Boolean(game.history);
                return (
                  <li key={rowKey} className={expanded ? 'is-expanded' : undefined}>
                    <div className="top-game-row-wrap">
                      <button
                        type="button"
                        className={`top-game-row${game.coverUrl ? ' has-cover' : ''}`}
                        aria-label={`Search game ${game.title} from ${column.short} ${listLabel}`}
                        title={
                          searchDiffers
                            ? `${game.title} → search “${game.searchQuery}”`
                            : game.title
                        }
                        onClick={() =>
                          onSearch({
                            query: game.searchQuery,
                            field: 'game',
                            platform: column.id === 'arcade' ? 'arcade' : 'all',
                          })
                        }
                      >
                        <span className="top-game-rank">{String(displayRank).padStart(3, '0')}</span>
                        {game.coverUrl ? (
                          <img
                            className="top-game-cover"
                            src={game.coverUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={48}
                            height={30}
                          />
                        ) : null}
                        <span className="top-game-title">{game.title}</span>
                      </button>
                      {hasHistory ? (
                        <button
                          type="button"
                          className={`top-game-history-toggle${expanded ? ' is-open' : ''}`}
                          aria-expanded={expanded}
                          aria-controls={`history-${rowKey}`}
                          aria-label={`${expanded ? 'Hide' : 'Show'} history for ${game.title}`}
                          onClick={() => setExpandedKey(expanded ? null : rowKey)}
                        >
                          History
                        </button>
                      ) : null}
                    </div>
                    {expanded && game.history ? (
                      <div className="top-game-history" id={`history-${rowKey}`}>
                        <p>{game.history}</p>
                        {game.historyUrl ? (
                          <a
                            className="top-game-history-source"
                            href={game.historyUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Source
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {games.length === 0 ? (
              <p className="empty-search">No matches in {column.short}.</p>
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
      return 'BEST';
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
  originalOnly,
  onOriginalOnly,
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
  audioFx,
  onAudioFxEnabled,
  onAudioFxPreset,
  onAudioFxAmount,
  visualizerMode,
  onVisualizerMode,
  fxPreviewTracks,
  fxPreviewLoading,
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
        BEST
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
        className="view-tab-settings"
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
      <label className="playable-filter">
        <input
          type="checkbox"
          checked={originalOnly}
          aria-label="Game music only"
          onChange={(event) => onOriginalOnly(event.target.checked)}
        />
        Game music only
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
        <SettingsPanel
          machines={machines}
          onToggle={onToggleMachine}
          onEnableAll={onEnableAllMachines}
          originalOnly={originalOnly}
          onOriginalOnly={onOriginalOnly}
          playableOnly={playableOnly}
          onPlayableOnly={onPlayableOnly}
          audioFx={audioFx}
          onAudioFxEnabled={onAudioFxEnabled}
          onAudioFxPreset={onAudioFxPreset}
          onAudioFxAmount={onAudioFxAmount}
          visualizerMode={visualizerMode}
          onVisualizerMode={onVisualizerMode}
          previewTracks={fxPreviewTracks}
          previewLoading={fxPreviewLoading}
          currentTrackId={currentTrackId}
          playerStatus={playerStatus}
          playbackDuration={playbackDuration ?? 0}
          onActivate={onActivate}
        />
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
                ) : (
                  <span className="track-cover-slot" aria-hidden="true" />
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
                    {track.originalGame === false && track.originKind ? (
                      <span className="track-origin" data-origin={track.originKind}>
                        {' '}
                        · {ORIGIN_KIND_LABELS[track.originKind]}
                      </span>
                    ) : null}
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
                  {track.subsongCount != null && track.subsongCount > 1 ? (
                    <span
                      className="chip subtunes"
                      title={`${track.subsongCount} songs in this file — switch with ‹ › in the player`}
                    >
                      {track.subsongCount} songs
                    </span>
                  ) : null}
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
