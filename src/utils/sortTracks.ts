import type { Track } from '../types';

export type SortKey = 'match' | 'title' | 'author' | 'game' | 'year' | 'duration' | 'date';

export const SORT_LABELS: Record<SortKey, string> = {
  match: 'Best match',
  title: 'Title',
  author: 'Author',
  game: 'Game',
  year: 'Year',
  duration: 'Duration',
  date: 'Date',
};

function textKey(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function yearValue(track: Track): number | null {
  const raw = track.year?.trim();
  if (!raw) return null;
  const four = raw.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (four) return Number(four[1]);
  const two = raw.match(/(?:^|\D)(\d{2})(?:\D|$)/);
  if (!two) return null;
  const n = Number(two[1]);
  return n >= 70 ? 1900 + n : 2000 + n;
}

function dateValue(track: Track): number | null {
  if (!track.timestamp) return null;
  const time = Date.parse(track.timestamp);
  return Number.isFinite(time) ? time : null;
}

function cmpText(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function cmpDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

function matchTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

function matchScore(track: Track, query: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;

  const phrase = query.trim().toLowerCase();
  const title = track.title.toLowerCase();
  const artist = track.artist.toLowerCase();
  const game = (track.game ?? '').toLowerCase();
  const haystack = [title, artist, game, track.notes ?? '', track.format, track.year ?? '']
    .join(' ')
    .toLowerCase();

  if (!tokens.every((token) => haystack.includes(token))) return 0;
  if (title === phrase || artist === phrase || game === phrase) return 100;
  if (title.startsWith(phrase) || artist.startsWith(phrase) || game.startsWith(phrase)) return 85;
  if (title.includes(phrase) || artist.includes(phrase) || game.includes(phrase)) return 70;
  if (tokens.every((token) => title.includes(token) || game.includes(token))) return 60;
  return 40;
}

function byTitleThenArtist(left: Track, right: Track): number {
  return (
    cmpText(textKey(left.title), textKey(right.title)) ||
    cmpText(textKey(left.artist), textKey(right.artist))
  );
}

export function sortTracks(tracks: Track[], sort: SortKey, query = ''): Track[] {
  if (sort === 'match') {
    const tokens = matchTokens(query);
    if (tokens.length === 0) {
      return [...tracks].sort(byTitleThenArtist);
    }
    return [...tracks].sort((left, right) => {
      const scoreDelta = matchScore(right, query, tokens) - matchScore(left, query, tokens);
      return scoreDelta || byTitleThenArtist(left, right);
    });
  }

  return [...tracks].sort((left, right) => {
    let primary = 0;
    switch (sort) {
      case 'title':
        primary = cmpText(textKey(left.title), textKey(right.title));
        break;
      case 'author':
        primary = cmpText(textKey(left.artist), textKey(right.artist));
        break;
      case 'game':
        primary = cmpText(textKey(left.game), textKey(right.game));
        break;
      case 'year':
        primary = cmpDesc(yearValue(left), yearValue(right));
        break;
      case 'duration':
        primary = cmpDesc(left.durationSeconds ?? null, right.durationSeconds ?? null);
        break;
      case 'date':
        primary = cmpDesc(dateValue(left), dateValue(right));
        break;
      default: {
        const _exhaustive: never = sort;
        throw new Error(`Unhandled sort: ${_exhaustive}`);
      }
    }
    if (primary !== 0) return primary;
    return byTitleThenArtist(left, right);
  });
}
