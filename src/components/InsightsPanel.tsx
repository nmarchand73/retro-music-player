import { useEffect, useMemo, useState } from 'react';
import { fetchInsights } from '../api';
import type { InsightRank, InsightsResponse, InsightTrackBrief, LibrarySearch, MusicPlatform } from '../types';
import { formatClock } from '../utils/formatTime';
import { enabledMachines, MACHINE_LABELS, type MachineSettings } from '../utils/machines';

interface InsightsPanelProps {
  onSearch: (search: LibrarySearch) => void;
  machines: MachineSettings;
  machinesParam: string;
}

function formatHours(seconds: number): string {
  if (!(seconds > 0)) return '—';
  const hours = seconds / 3600;
  if (hours >= 10) return `${Math.round(hours).toLocaleString('en-US')} h`;
  return `${hours.toFixed(1)} h`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function platformMix(item: InsightRank): string {
  const parts: string[] = [];
  if (item.amigaCount > 0) parts.push(`${formatCount(item.amigaCount)} Amiga`);
  if (item.atariCount > 0) parts.push(`${formatCount(item.atariCount)} Atari`);
  if (item.cpcCount > 0) parts.push(`${formatCount(item.cpcCount)} CPC`);
  if (item.c64Count > 0) parts.push(`${formatCount(item.c64Count)} C64`);
  return parts.join(' · ');
}

function briefPlatformLabel(platform: InsightTrackBrief['platform']): string {
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

function RankBars({
  items,
  onPick,
  ariaLabel,
}: {
  items: InsightRank[];
  onPick: (item: InsightRank) => void;
  ariaLabel: string;
}) {
  const max = items[0]?.count ?? 1;
  return (
    <ol className="insight-rank-list" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <li key={item.label}>
          <button type="button" className="insight-rank-row" onClick={() => onPick(item)}>
            {item.coverUrl ? (
              <img className="insight-rank-cover" src={item.coverUrl} alt="" loading="lazy" />
            ) : (
              <span className="insight-rank-index">{index + 1}</span>
            )}
            <span className="insight-rank-body">
              <span className="insight-rank-label">{item.label}</span>
              <span className="insight-rank-meta">
                {formatCount(item.count)} tracks
                {platformMix(item) ? ` · ${platformMix(item)}` : ''}
              </span>
              <span
                className="insight-rank-bar"
                style={{ width: `${Math.max(6, (item.count / max) * 100)}%` }}
                aria-hidden="true"
              />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function TrackBriefList({
  items,
  mode,
  onAuthor,
  onGame,
}: {
  items: InsightTrackBrief[];
  mode: 'longest' | 'recent';
  onAuthor: (artist: string, platform: InsightTrackBrief['platform']) => void;
  onGame: (game: string) => void;
}) {
  return (
    <ol className="insight-track-list" aria-label={mode === 'longest' ? 'Longest tracks' : 'Recently added'}>
      {items.map((item) => (
        <li key={`${item.source}:${item.id}`}>
          <div className="insight-track-row">
            <span className={`platform-badge insight-platform`} data-platform={item.platform}>
              {briefPlatformLabel(item.platform)}
            </span>
            <span className="insight-track-main">
              <strong>{item.title}</strong>
              <span className="muted">
                <button type="button" className="insight-inline-link" onClick={() => onAuthor(item.artist, item.platform)}>
                  {item.artist}
                </button>
                {item.game ? (
                  <>
                    {' · '}
                    <button type="button" className="insight-inline-link" onClick={() => onGame(item.game!)}>
                      {item.game}
                    </button>
                  </>
                ) : null}
              </span>
            </span>
            <span className="insight-track-stat">
              {mode === 'longest'
                ? item.durationSeconds
                  ? formatClock(item.durationSeconds)
                  : '—'
                : item.timestamp
                  ? item.timestamp.slice(0, 10)
                  : '—'}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function YearSpark({
  years,
  onPick,
}: {
  years: InsightRank[];
  onPick: (year: string) => void;
}) {
  const max = Math.max(1, ...years.map((item) => item.count));
  return (
    <ol className="insight-year-list" aria-label="Tracks by year">
      {years.map((item) => (
        <li key={item.label}>
          <button type="button" className="insight-year-row" onClick={() => onPick(item.label)}>
            <span>{item.label}</span>
            <span className="insight-year-bar-wrap" aria-hidden="true">
              <span
                className="insight-year-bar"
                style={{ height: `${Math.max(8, (item.count / max) * 100)}%` }}
              />
            </span>
            <span>{formatCount(item.count)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function InsightsPanel({ onSearch, machines, machinesParam }: InsightsPanelProps) {
  const [platform, setPlatform] = useState<MusicPlatform>('all');
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeMachines = useMemo(() => enabledMachines(machines), [machines]);

  useEffect(() => {
    if (platform === 'all') return;
    if (!machines[platform]) setPlatform('all');
  }, [machines, platform]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchInsights(platform, machinesParam)
      .then((insights) => {
        if (!cancelled) setData(insights);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setError('Could not load library insights.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, machinesParam]);

  const overview = data?.overview;

  return (
    <>
      <header className="panel-header insights-header">
        <div>
          <h2>Insights</h2>
          <p className="muted">
            Local archive inventory — composers, richest soundtracks, formats, and coverage
          </p>
        </div>
        <label className="search-select">
          <span>Platform</span>
          <select
            aria-label="Insights platform"
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
      </header>

      {loading && !data ? <p className="muted">Crunching the archive…</p> : null}
      {error ? <p className="empty-search">{error}</p> : null}

      {overview ? (
        <div className="insights-layout">
          <section className="insight-overview" aria-label="Library overview">
            <div className="insight-stat">
              <strong>{formatCount(overview.tracks)}</strong>
              <span>Tracks</span>
            </div>
            <div className="insight-stat">
              <strong>{formatCount(overview.composers)}</strong>
              <span>Composers</span>
            </div>
            <div className="insight-stat">
              <strong>{formatCount(overview.games)}</strong>
              <span>Games</span>
            </div>
            <div className="insight-stat">
              <strong>{formatHours(overview.totalDurationSeconds)}</strong>
              <span>Known duration</span>
            </div>
            <div className="insight-stat">
              <strong>
                {formatCount(overview.atari)}
                <span className="insight-stat-split"> / {formatCount(overview.amiga)}</span>
              </strong>
              <span>Atari / Amiga</span>
            </div>
            <div className="insight-stat">
              <strong>
                {formatCount(overview.cpc)}
                <span className="insight-stat-split"> / {formatCount(overview.c64)}</span>
              </strong>
              <span>CPC / C64</span>
            </div>
            <div className="insight-stat">
              <strong>
                {formatCount(overview.openmpt)}
                <span className="insight-stat-split"> / {formatCount(overview.exotic)}</span>
              </strong>
              <span>OpenMPT / exotic</span>
            </div>
            <div className="insight-stat">
              <strong>
                {overview.tracks ? Math.round((overview.withDuration / overview.tracks) * 100) : 0}%
              </strong>
              <span>With duration</span>
            </div>
            <div className="insight-stat">
              <strong>
                {overview.tracks ? Math.round((overview.withGame / overview.tracks) * 100) : 0}%
              </strong>
              <span>Tagged as game</span>
            </div>
          </section>

          <div className="insights-grid">
            <section className="insight-block" aria-labelledby="insight-authors">
              <header>
                <h3 id="insight-authors">Top composers</h3>
                <p className="muted">By number of tracks in the local dump</p>
              </header>
              <RankBars
                items={data?.topAuthors ?? []}
                ariaLabel="Top composers"
                onPick={(item) => {
                  const nextPlatform =
                    item.amigaCount > 0 &&
                    item.atariCount === 0 &&
                    item.cpcCount === 0 &&
                    item.c64Count === 0
                      ? 'amiga'
                      : item.atariCount > 0 &&
                          item.amigaCount === 0 &&
                          item.cpcCount === 0 &&
                          item.c64Count === 0
                        ? 'atari'
                        : item.cpcCount > 0 &&
                            item.amigaCount === 0 &&
                            item.atariCount === 0 &&
                            item.c64Count === 0
                          ? 'cpc'
                          : item.c64Count > 0 &&
                              item.amigaCount === 0 &&
                              item.atariCount === 0 &&
                              item.cpcCount === 0
                            ? 'c64'
                            : platform;
                  onSearch({ query: item.label, field: 'author', platform: nextPlatform });
                }}
              />
            </section>

            <section className="insight-block" aria-labelledby="insight-games">
              <header>
                <h3 id="insight-games">Richest soundtracks</h3>
                <p className="muted">Games with the most discrete music files</p>
              </header>
              <RankBars
                items={data?.topGames ?? []}
                ariaLabel="Top games by track count"
                onPick={(item) => onSearch({ query: item.label, field: 'game', platform })}
              />
            </section>

            <section className="insight-block" aria-labelledby="insight-formats">
              <header>
                <h3 id="insight-formats">Formats</h3>
                <p className="muted">Module / chip formats across the archive</p>
              </header>
              <RankBars
                items={data?.formats ?? []}
                ariaLabel="Formats"
                onPick={(item) => {
                  if (item.label === 'SNDH') {
                    onSearch({ query: '', field: 'any', platform: item.cpcCount > item.atariCount ? 'cpc' : 'atari' });
                    return;
                  }
                  if (item.label === 'SID') {
                    onSearch({ query: '', field: 'any', platform: 'c64' });
                    return;
                  }
                  onSearch({ query: item.label, field: 'any', platform: 'amiga' });
                }}
              />
            </section>

            <section className="insight-block" aria-labelledby="insight-years">
              <header>
                <h3 id="insight-years">SNDH by year</h3>
                <p className="muted">Atari tunes with a YEAR tag</p>
              </header>
              {(data?.years.length ?? 0) === 0 ? (
                <p className="muted">No year tags in this filter.</p>
              ) : (
                <YearSpark years={data?.years ?? []} onPick={(year) => onSearch({ query: year, field: 'any', platform: 'atari' })} />
              )}
            </section>

            <section className="insight-block" aria-labelledby="insight-longest">
              <header>
                <h3 id="insight-longest">Longest known</h3>
                <p className="muted">Tracks with a measured or estimated duration</p>
              </header>
              <TrackBriefList
                items={data?.longest ?? []}
                mode="longest"
                onAuthor={(artist, nextPlatform) =>
                  onSearch({ query: artist, field: 'author', platform: nextPlatform })
                }
                onGame={(game) => onSearch({ query: game, field: 'game', platform })}
              />
            </section>

            <section className="insight-block" aria-labelledby="insight-recent">
              <header>
                <h3 id="insight-recent">Recently indexed</h3>
                <p className="muted">Newest file timestamps on disk</p>
              </header>
              <TrackBriefList
                items={data?.recentlyAdded ?? []}
                mode="recent"
                onAuthor={(artist, nextPlatform) =>
                  onSearch({ query: artist, field: 'author', platform: nextPlatform })
                }
                onGame={(game) => onSearch({ query: game, field: 'game', platform })}
              />
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}
