/** Classify whether a library track is original commercial game music. */

export type TrackOriginKind = 'game' | 'demo' | 'remix' | 'conversion' | 'cover';

export interface OriginClassification {
  originalGame: boolean;
  originKind: TrackOriginKind;
}

export const ORIGIN_KIND_LABELS: Record<TrackOriginKind, string> = {
  game: 'Game',
  demo: 'Demo',
  remix: 'Remix',
  conversion: 'Conversion',
  cover: 'Cover',
};

const DEMO_PATH = /(^|\/)demos?(\/|$)/i;
const HVSC_DEMOS = /(^|\/)DEMOS(\/|$)/;
const CPC_DEMO_PATH = /crack\s*intros|\/dmos\/|\/demos?\//i;
const CONVERSION_PATH = /c64-conversions/i;
const REMIX_NAME = /(^|[^a-z0-9])(re-?mix|remixes?|megamix)([^a-z0-9]|$)/i;
const KNOWN_GAME_TITLE_WITH_REMIX = /ninja[_\s-]?remix/i;
const QUARTET_CONV = /quartet/i;
const UNEXOTICA_GAME_CATEGORY = /^(\d+\.\d+\s+)?game$/i;

export function normalizeOriginTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeArtistKey(artist: string): string {
  return artist.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function artistsRelated(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

/** Path / filename / CONV heuristics (single file). */
export function classifyPathOrigin(input: {
  relativePath: string;
  title: string;
  filename?: string;
  conv?: string;
  genre?: string;
}): OriginClassification {
  const path = input.relativePath.replaceAll('\\', '/');
  const haystack = `${input.title} ${input.filename ?? ''} ${path}`;
  const underGames = /(^|\/)games?\//i.test(path);

  if (CONVERSION_PATH.test(path)) {
    return { originalGame: false, originKind: 'conversion' };
  }
  if (DEMO_PATH.test(path) || HVSC_DEMOS.test(path) || CPC_DEMO_PATH.test(path)) {
    return { originalGame: false, originKind: 'demo' };
  }
  if (input.conv && QUARTET_CONV.test(input.conv)) {
    return { originalGame: false, originKind: 'conversion' };
  }
  if (/unexotica\//i.test(path)) {
    const category = path.split('/').filter(Boolean)[1] ?? '';
    if (!UNEXOTICA_GAME_CATEGORY.test(category)) {
      return { originalGame: false, originKind: 'demo' };
    }
  }
  if (input.genre && /^demo$/i.test(input.genre.trim())) {
    return { originalGame: false, originKind: 'demo' };
  }
  if (REMIX_NAME.test(haystack)) {
    if (underGames && KNOWN_GAME_TITLE_WITH_REMIX.test(haystack)) {
      return { originalGame: true, originKind: 'game' };
    }
    return { originalGame: false, originKind: 'remix' };
  }

  return { originalGame: true, originKind: 'game' };
}

type CoverCandidate = {
  title: string;
  artist: string;
  year?: string;
  relativePath: string;
  originalGame: boolean;
  originKind: TrackOriginKind;
};

/**
 * Among same-title tracks still marked as game music, demote later covers /
 * alternate artists when a clearer original exists (Games/ folder or earlier year).
 */
export function applyCoverYearHeuristic(records: CoverCandidate[], yearGap = 3): void {
  const groups = new Map<string, CoverCandidate[]>();
  for (const record of records) {
    if (!record.originalGame) continue;
    const key = normalizeOriginTitle(record.title);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }

  for (const list of groups.values()) {
    if (list.length < 2) continue;

    const inGames = list.filter((record) => /(^|\/)games?\//i.test(record.relativePath));
    if (inGames.length > 0) {
      const keep = new Set(inGames);
      for (const record of list) {
        if (!keep.has(record)) {
          record.originalGame = false;
          record.originKind = 'cover';
        }
      }
      continue;
    }

    const dated = list
      .map((record) => ({ record, year: record.year ? Number(record.year) : Number.NaN }))
      .filter((entry) => Number.isFinite(entry.year));
    if (dated.length < 2) continue;

    const minYear = Math.min(...dated.map((entry) => entry.year));
    const earlyArtists = dated
      .filter((entry) => entry.year <= minYear + 1)
      .map((entry) => normalizeArtistKey(entry.record.artist));

    for (const { record, year } of dated) {
      if (year < minYear + yearGap) continue;
      const artist = normalizeArtistKey(record.artist);
      const related = earlyArtists.some((early) => artistsRelated(early, artist));
      if (!related) {
        record.originalGame = false;
        record.originKind = 'cover';
      }
    }
  }
}
