/** Top game & music rankings across Amiga, Atari ST, CPC, C64, and Arcade VGM. */
import gameRankings from './top100Rankings.json' with { type: 'json' };
import musicRankings from './top100MusicRankings.json' with { type: 'json' };
import arcadeRankings from './topArcadeRankings.json' with { type: 'json' };
import franceArcadeRankings from './topFranceArcade80s90s.json' with { type: 'json' };
import gameHistories from './topGameHistories.json' with { type: 'json' };

export type TopGamePlatform = 'amiga' | 'atari' | 'cpc' | 'c64' | 'arcade';

export type RankingKind = 'games' | 'music';

export type RankSourceId = 'lemon' | 'atarimania' | 'cpc' | 'c64' | 'vgmrips' | 'arcade-fr';

export type RankSourceMode = 'ranked' | 'list';

export interface RankSource {
  id: RankSourceId;
  label: string;
  short: string;
  /** ranked = numbered toplist; list = curated set without order. */
  mode: RankSourceMode;
  url?: string;
  method?: string;
  note?: string;
}

/** Page columns — one official toplist per machine. */
export interface PlatformColumn {
  id: TopGamePlatform;
  short: string;
  label: string;
  /** Primary rank key used for ordering in this column. */
  rankKey: RankSourceId;
  url: string;
  method: string;
  note: string;
}

export interface TopGame {
  /** Official ranking title (shown in the list). */
  title: string;
  /** Normalized query used for library search. */
  searchQuery: string;
  platforms: TopGamePlatform[];
  /** 1-based ranks from ordered sources. */
  ranks: Partial<Record<RankSourceId, number>>;
  /** Optional cover art URL (public path or absolute). */
  coverUrl?: string;
  /** Short punchy history (≤200 characters), when available. */
  history?: string;
  /** Wikipedia (or other) page for the history blurb. */
  historyUrl?: string;
}

type GameJsonPlatformKey = keyof typeof gameRankings.platforms;
type MusicJsonPlatformKey = keyof typeof musicRankings.lists;

const MUSIC_JSON_KEY: Record<Exclude<TopGamePlatform, 'arcade'>, MusicJsonPlatformKey> = {
  amiga: 'AMIGA',
  atari: 'ATARI_ST',
  cpc: 'AMSTRAD_CPC',
  c64: 'C64',
};

const GAME_JSON_KEY: Record<Exclude<TopGamePlatform, 'arcade'>, GameJsonPlatformKey> = {
  amiga: 'AMIGA',
  atari: 'ATARI_ST',
  cpc: 'AMSTRAD_CPC',
  c64: 'C64',
};

const RANK_KEY: Record<TopGamePlatform, RankSourceId> = {
  amiga: 'lemon',
  atari: 'atarimania',
  cpc: 'cpc',
  c64: 'c64',
  arcade: 'vgmrips',
};

const COLUMN_SHORT: Record<TopGamePlatform, string> = {
  amiga: 'Amiga',
  atari: 'Atari ST',
  cpc: 'CPC',
  c64: 'C64',
  arcade: 'Arcade',
};

/** Exact official titles → library-friendly search strings. */
const SEARCH_ALIASES: Record<string, string> = {
  'The Secret of Monkey Island': 'Monkey Island',
  "Monkey Island 2: LeChuck's Revenge": 'Monkey Island 2',
  'Monkey Island 2': 'Monkey Island 2',
  'Turrican II: The Final Fight': 'Turrican 2',
  'Turrican II: The Final Fight (2022)': 'Turrican 2',
  'Turrican II - The Final Fight': 'Turrican 2',
  'Turrican II': 'Turrican 2',
  'Turrican 3': 'Turrican 3',
  'Speedball 2: Brutal Deluxe': 'Speedball 2',
  'Speedball II - Brutal Deluxe': 'Speedball 2',
  'Speedball 2': 'Speedball 2',
  'Dune II: The Battle for Arrakis': 'Dune 2',
  'Dune II': 'Dune 2',
  'UFO: Enemy Unknown': 'UFO Enemy Unknown',
  'UFO: Enemy Unknown (AGA)': 'UFO Enemy Unknown',
  'UFO: Enemy Unknown (OCS/ECS)': 'UFO Enemy Unknown',
  "Sensible World of Soccer '96/'97": 'Sensible World of Soccer',
  "Sensible World of Soccer '95/'96": 'Sensible World of Soccer',
  'Sensible World of Soccer v1.1': 'Sensible World of Soccer',
  'Lotus Turbo Challenge 2': 'Lotus 2',
  'Lotus Esprit Turbo Challenge': 'Lotus',
  'Lotus III: The Ultimate Challenge': 'Lotus 3',
  'Lotus III': 'Lotus 3',
  'Eye of the Beholder II: The Legend of Darkmoon': 'Eye of the Beholder 2',
  'Eye of the Beholder II': 'Eye of the Beholder 2',
  'Lemmings 2: The Tribes': 'Lemmings 2',
  'Populous II: Trials of the Olympian Gods': 'Populous 2',
  'Populous II': 'Populous 2',
  'Super Cars II': 'Super Cars 2',
  'Zak McKracken and the Alien Mindbenders': 'Zak McKracken',
  'Ultima IV: Quest of the Avatar': 'Ultima IV',
  'Ultima V: Warriors of Destiny': 'Ultima V',
  'Ultima V - Warriors of Destiny': 'Ultima V',
  'Ultima III: Exodus': 'Ultima III',
  'Ultima VI - The False Prophet': 'Ultima VI',
  'Last Ninja 2: Back with a Vengeance': 'Last Ninja 2',
  'The Last Ninja': 'Last Ninja',
  'Barbarian II: The Dungeon of Drax': 'Barbarian 2',
  'Barbarian 2': 'Barbarian 2',
  'B.A.T.': 'B.A.T.',
  'Batman the Movie': 'Batman The Movie',
  'Batman: The Movie': 'Batman The Movie',
  'Croisière pour un Cadavre': 'Cruise for a Corpse',
  'Cruise for a Corpse': 'Cruise for a Corpse',
  "Darkmere : The Nightmare's Begun": 'Darkmere',
  'Darkmere: The Nightmare’s Begun': 'Darkmere',
  'Faery Tale Adventure, The': 'Faery Tale Adventure',
  'The Faery Tale Adventure': 'Faery Tale Adventure',
  'Flashback: The Quest for Identity': 'Flashback',
  'Indiana Jones and the Last Crusade, Aventure': 'Indiana Jones and the Last Crusade',
  'Les Voyageurs du Temps': 'Les Voyageurs du Temps',
  'SimCity': 'Sim City',
  'Wizkid: The Story Of Wizball II': 'Wizkid',
  'Xenon II : Megablast': 'Xenon 2',
  'Xenon II: Megablast': 'Xenon 2',
  'Chaos Engine': 'Chaos Engine',
  'The Chaos Engine': 'Chaos Engine',
  'James Pond 2: Codename RoboCod': 'James Pond 2',
  'It came from the Desert': 'It Came from the Desert',
  'Moonstone: A Hard Days Knight': 'Moonstone',
  "Ruff 'n' Tumble": "Ruff 'n' Tumble",
  'Turrican 2': 'Turrican 2',
  'Frontier: Elite II': 'Frontier Elite 2',
  'F/A-18 Interceptor': 'FA-18 Interceptor',
  'Last Ninja 2': 'Last Ninja 2',
  'Last Ninja 3': 'Last Ninja 3',
  'Archon: The Light and the Dark': 'Archon',
  "Ghosts 'n Goblins Arcade": 'Ghosts n Goblins Arcade',
  "Ghosts 'n Goblins": 'Ghosts n Goblins',
  "Ghosts'n Goblins": 'Ghosts n Goblins',
  "Ghouls 'n Ghosts": 'Ghouls n Ghosts',
  'Metal Warrior 4: Agents of Metal': 'Metal Warrior 4',
  'Buck Rogers: Countdown to Doomsday': 'Buck Rogers',
  'Sentinel Worlds I: Future Magic': 'Sentinel Worlds',
  'World Class Leader Board': 'World Class Leaderboard',
  'Bruce Lee II': 'Bruce Lee 2',
  'Summer Games II': 'Summer Games 2',
  'The Great Giana Sisters': 'Great Giana Sisters',
  'The Legend of Blacksilver': 'Legend of Blacksilver',
  'The Magic Candle': 'Magic Candle',
  'The Way of the Exploding Fist': 'Way of the Exploding Fist',
  "The Bard's Tale: Tales of the Unknown": "Bard's Tale",
  "The Bard's Tale - Tales of the Unknown": "Bard's Tale",
  'Might and Magic: Book Two - Gates to Another World': 'Might and Magic 2',
  "Boulder Dash II: Rockford's Revenge": 'Boulder Dash 2',
  'Enforcer: Fullmetal Megablaster': 'Enforcer',
  "Knight 'n' Grail": 'Knight n Grail',
  'Creatures 2: Torture Trouble': 'Creatures 2',
  'Creatures II': 'Creatures 2',
  'Cybernoid II': 'Cybernoid 2',
  'Cybernoid II: The Revenge': 'Cybernoid 2',
  'Arkanoid: Revenge of Doh': 'Arkanoid 2',
  'Arkanoid II: Revenge of Doh': 'Arkanoid 2',
  'Bad Dudes vs. DragonNinja': 'Dragon Ninja',
  'Chase H.Q.': 'Chase HQ',
  Robocop: 'RoboCop',
  'Robocop 2': 'RoboCop 2',
  'Le Manoir de Mortevielle': 'Mortville Manor',
  'The Guild of Thieves': 'Guild of Thieves',
  'Target: Renegade': 'Target Renegade',
  'Target Renegade': 'Target Renegade',
  'North & South': 'North and South',
  "L'Arche du Captain Blood": 'Captain Blood',
  'Crafton & Xunk': 'Get Dexter',
  'Cauldron II': 'Cauldron 2',
  'Saboteur!': 'Saboteur',
  'Saboteur II': 'Saboteur 2',
  'Match Day II': 'Match Day 2',
  "Burnin' Rubber": 'Burnin Rubber',
  'Crazy Cars III': 'Crazy Cars 3',
  'Dizzy: The Ultimate Cartoon Adventure': 'Dizzy',
  'Out of this World': 'Another World',
  'Battle Squadron: The Destruction of the Barrax Empire': 'Battle Squadron',
  "Worms: The Director's Cut": 'Worms',
  'Alien Breed: Tower Assault': 'Alien Breed',
  'Alien Breed II': 'Alien Breed 2',
  "Championship Manager '93": 'Championship Manager',
  'NightHawk F-117A Stealth Fighter 2.0': 'F-117A',
  'Utopia: The Creation of a Nation': 'Utopia',
  'Ishar 2: Messengers of Doom': 'Ishar 2',
  'The Misadventures of Flink': 'Flink',
  'Oh No! More Lemmings': 'Oh No More Lemmings',
  'Die Siedler': 'The Settlers',
  'Frontier - Elite II': 'Frontier',
  "Hard Drivin' II - Drive Harder": 'Hard Drivin 2',
  'IK+ (International Karate +)': 'IK+',
  'International Karate+': 'IK+',
  'Xenon 2: Megablast': 'Xenon 2',
  'Xenon II - Megablast': 'Xenon 2',
  'R-Type II': 'R-Type 2',
  'Gobliins II - The Prince Buffoon': 'Gobliins 2',
  'Dungeon Master Expansion Set I - Chaos Strikes Back': 'Chaos Strikes Back',
  "King's Quest IV - The Perils of Rosella": "King's Quest 4",
  'Phantasie III - The Wrath of Nikademus': 'Phantasie 3',
  'Twinworld - Land of Vision': 'Twinworld',
  "Battletech - The Crescent Hawk's Inception": 'Battletech',
  'Conflict - The Middle East Simulation': 'Conflict',
  'Elvira - Mistress of the Dark': 'Elvira',
  'SDI - Strategic Defence Initiative': 'SDI',
  'Turbo Out Run': 'Turbo Out Run',
  'Turbo OutRun': 'Turbo OutRun',
  Swiv: 'SWIV',
  'Rambo: First Blood Part II': 'Rambo',
  'Rambo III': 'Rambo 3',
  'Myth: History in the Making': 'Myth',
  "Jeroen Tel's Eliminator": 'Eliminator',
  'Batman: The Caped Crusader': 'Batman Caped Crusader',
  "Bitmap Brothers' Magic Pockets": 'Magic Pockets',
  'Jim Power in Mutant Planet': 'Jim Power',
  'Mega-lo-Mania': 'Mega lo Mania',
  'Shadow of the Beast II': 'Shadow of the Beast 2',
  'Shadow of the Beast III': 'Shadow of the Beast 3',
  'Yo! Joe!': 'Yo Joe!',
  'Fire & Ice': 'Fire and Ice',
  'James Pond II: Codename RoboCod': 'James Pond 2',
  'James Pond II': 'James Pond 2',
  'Chuck Rock II': 'Chuck Rock 2',
  'Goldrunner II': 'Goldrunner 2',
  'Midwinter II': 'Midwinter 2',
  'Switchblade II': 'Switchblade 2',
  'Agent X II': 'Agent X 2',
  'Fist II': 'Fist 2',
  'Ace II': 'Ace 2',
  'Airwolf II': 'Airwolf 2',
  'Ghostbusters II': 'Ghostbusters 2',
  'Prehistorik II': 'Prehistorik 2',
  'Sacred Armour of Antiriad': 'Antiriad',
  'The Sacred Armour of Antiriad': 'Antiriad',
  'The New Zealand Story': 'New Zealand Story',
  'Cadaver: The Payoff': 'Cadaver',
  'Rod-Land': 'Rodland',
  'Bonanza Bros.': 'Bonanza Bros',
  'Dynablaster': 'Dyna Blaster',
  'Skate or Die!': 'Skate or Die',
  "Flimbo's Quest": 'Flimbos Quest',
  "Hunter's Moon": 'Hunters Moon',
  'One Man and His Droid': 'One Man and his Droid',
  'One Man & His Droid': 'One Man and his Droid',
  'The Master of Magic': 'Master of Magic',
  'Gauntlet III': 'Gauntlet 3',
  'R.I.S.K.': 'RISK',
  'Ocean Loader 3': 'Ocean Loader',
  'Yie Ar Kung Fu': 'Yie Ar Kung-Fu',
  'Robocop 3': 'RoboCop 3',
  'ACE II': 'Ace 2',
  'Crazy Comets (remix)': 'Crazy Comets',
  'R-type': 'R-Type',
  'Turbo Outrun': 'Turbo OutRun',
  'FAME (1)': 'FAME',
  'Batman (long)': 'Batman',
  'H.A.T.E.': 'HATE',
  'HeroQuest': 'Hero Quest',
  "Solomon's Key": "Solomon's Key",
  "Daley Thompson's Olympic Challenge": 'Daley Thompson Olympic Challenge',
  "Daley Thompson's Supertest": 'Daley Thompson Supertest',
  'The Seven Gates of Jambala': 'Seven Gates of Jambala',
  "Leavin' Teramis": 'Leavin Teramis',
  'Z-Out': 'Z-Out',
  'Cybercon III': 'Cybercon 3',
  'Killing Game Show': 'Killing Game Show',
  'OutRun Europa': 'OutRun Europa',
  'OutRun': 'OutRun',
  'Last V8': 'Last V8',
  'Delta Man': 'Delta',
  'Ocean Loader': 'Ocean Loader',
  'Get Dexter': 'Get Dexter',
  'Get Dexter 2': 'Get Dexter 2',
  'Sorcery+': 'Sorcery+',
  'Out Run': 'Out Run',
  'After Burner II': 'After Burner',
  'Space Harrier': 'Space Harrier',
  'Super Hang-On': 'Super Hang-On',
  'Enduro Racer': 'Enduro Racer',
  'G-LOC Air Battle': 'G-LOC',
  'Chelnov: Atomic Runner': 'Chelnov',
  'Act-Fancer: Cybernetick Hyper Weapon': 'Act-Fancer',
  'Dragon Saber: After Story of Dragon Spirit': 'Dragon Saber',
  'Armed Police Batrider': 'Batrider',
  'Battle Garegga': 'Battle Garegga',
  'Daytona USA': 'Daytona',
  'Galaxy Force II': 'Galaxy Force',
  'Hyper Duel': 'Hyper Duel',
  'Heavy Barrel': 'Heavy Barrel',
};

function stripEditionSuffix(title: string): string {
  return title
    .replace(/\s*\((?:AGA|ECS|OCS|OCS\/ECS|CD32|cartridge|\d{4})\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a library search query from an official ranking title. */
export function rankingSearchQuery(title: string): string {
  const exact = SEARCH_ALIASES[title];
  if (exact) return exact;
  const stripped = stripEditionSuffix(title);
  if (stripped !== title) {
    const alias = SEARCH_ALIASES[stripped];
    if (alias) return alias;
    return rankingSearchQuery(stripped);
  }
  return title;
}

function buildGamePlatformColumns(): PlatformColumn[] {
  return (Object.keys(GAME_JSON_KEY) as Array<Exclude<TopGamePlatform, 'arcade'>>).map((id) => {
    const block = gameRankings.platforms[GAME_JSON_KEY[id]];
    const fullName = block.source.name;
    const label = fullName.includes(' / ') ? fullName.split(' / ')[0]! : fullName;
    return {
      id,
      short: COLUMN_SHORT[id],
      label,
      rankKey: RANK_KEY[id],
      url: block.source.url,
      method: block.source.method,
      note: [fullName !== label ? fullName : null, block.source.note].filter(Boolean).join(' — '),
    };
  });
}

function buildMusicPlatformColumns(): PlatformColumn[] {
  return (Object.keys(MUSIC_JSON_KEY) as Array<Exclude<TopGamePlatform, 'arcade'>>).map((id) => {
    const block = musicRankings.lists[MUSIC_JSON_KEY[id]];
    return {
      id,
      short: COLUMN_SHORT[id],
      label: block.primary_reference,
      rankKey: RANK_KEY[id],
      url: block.source,
      method: musicRankings.methodology,
      note: `${musicRankings.title} — ${block.primary_reference}`,
    };
  });
}

function buildArcadePlatformColumn(): PlatformColumn {
  const source = arcadeRankings.source;
  return {
    id: 'arcade',
    short: COLUMN_SHORT.arcade,
    label: source.name,
    rankKey: 'vgmrips',
    url: source.url,
    method: source.method,
    note: [arcadeRankings.description, source.note].filter(Boolean).join(' — '),
  };
}

function buildFranceArcadePlatformColumn(): PlatformColumn {
  const source = franceArcadeRankings.source;
  return {
    id: 'arcade',
    short: 'Arcade FR',
    label: source.name,
    rankKey: 'arcade-fr',
    url: source.url,
    method: source.method,
    note: [franceArcadeRankings.description, source.note].filter(Boolean).join(' — '),
  };
}

export const PLATFORM_COLUMNS: PlatformColumn[] = buildGamePlatformColumns();
export const MUSIC_PLATFORM_COLUMNS: PlatformColumn[] = buildMusicPlatformColumns();
export const ARCADE_PLATFORM_COLUMN: PlatformColumn = buildArcadePlatformColumn();
export const FRANCE_ARCADE_PLATFORM_COLUMN: PlatformColumn = buildFranceArcadePlatformColumn();

const ARCADE_BEST_COLUMNS: PlatformColumn[] = [
  FRANCE_ARCADE_PLATFORM_COLUMN,
  ARCADE_PLATFORM_COLUMN,
];

export function platformColumnsFor(kind: RankingKind): PlatformColumn[] {
  switch (kind) {
    case 'games':
      return [...PLATFORM_COLUMNS, ...ARCADE_BEST_COLUMNS];
    case 'music':
      return [...MUSIC_PLATFORM_COLUMNS, ...ARCADE_BEST_COLUMNS];
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled ranking kind: ${_exhaustive}`);
    }
  }
}

export const RANK_SOURCES: RankSource[] = [
  ...PLATFORM_COLUMNS.map((column) => ({
    id: column.rankKey,
    label: column.label,
    short: column.short,
    mode: 'ranked' as const,
    url: column.url,
    method: column.method,
    note: column.note,
  })),
  {
    id: 'vgmrips',
    label: ARCADE_PLATFORM_COLUMN.label,
    short: ARCADE_PLATFORM_COLUMN.short,
    mode: 'ranked' as const,
    url: ARCADE_PLATFORM_COLUMN.url,
    method: ARCADE_PLATFORM_COLUMN.method,
    note: ARCADE_PLATFORM_COLUMN.note,
  },
  {
    id: 'arcade-fr',
    label: FRANCE_ARCADE_PLATFORM_COLUMN.label,
    short: FRANCE_ARCADE_PLATFORM_COLUMN.short,
    mode: 'ranked' as const,
    url: FRANCE_ARCADE_PLATFORM_COLUMN.url,
    method: FRANCE_ARCADE_PLATFORM_COLUMN.method,
    note: FRANCE_ARCADE_PLATFORM_COLUMN.note,
  },
];

export const RANKINGS_META = {
  generatedAt: gameRankings.generated_at,
  description: gameRankings.description,
};

export const MUSIC_RANKINGS_META = {
  title: musicRankings.title,
  methodology: musicRankings.methodology,
};

type HistoryRecord = {
  history?: string | null;
  url?: string | null;
};

function historyKeyCandidates(title: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    const v = value?.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  push(title);
  push(stripEditionSuffix(title));
  push(rankingSearchQuery(title));

  // Drop subtitle after colon / en-dash for keys like "Darkmere : The Nightmare's Begun".
  const base = title.split(/\s*[:–—]\s*/)[0]?.trim();
  if (base && base !== title) {
    push(base);
    push(rankingSearchQuery(base));
  }

  // "Title, The" → "The Title"
  const commaThe = title.match(/^(.+),\s+The$/i);
  if (commaThe?.[1]) {
    push(`The ${commaThe[1].trim()}`);
    push(commaThe[1].trim());
  }

  return out;
}

function clipHistory(text: string, maxChars = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars - 1);
  const atSpace = cut.lastIndexOf(' ');
  const base = (atSpace > maxChars * 0.6 ? cut.slice(0, atSpace) : cut).replace(/[,:;–—-]\s*$/, '');
  return `${base}…`;
}

function historyForTitle(title: string): Pick<TopGame, 'history' | 'historyUrl'> {
  const records = gameHistories as Record<string, HistoryRecord>;
  for (const key of historyKeyCandidates(title)) {
    const hit = records[key];
    if (hit?.history) {
      return { history: clipHistory(hit.history), historyUrl: hit.url ?? undefined };
    }
  }

  const needles = new Set(
    historyKeyCandidates(title).map((k) => rankingSearchQuery(k).toLowerCase()),
  );
  for (const [key, rec] of Object.entries(records)) {
    if (!rec?.history) continue;
    const keyQ = rankingSearchQuery(key).toLowerCase();
    if (needles.has(keyQ) || needles.has(key.toLowerCase())) {
      return { history: clipHistory(rec.history), historyUrl: rec.url ?? undefined };
    }
  }

  return {};
}

/** Resolve a short history blurb for a playing track's game name. */
export function lookupGameHistory(
  game: string | undefined | null,
): { title: string; history: string } | null {
  if (!game?.trim()) return null;
  const needle = game.trim();
  const direct = historyForTitle(needle);
  if (direct.history) {
    return { title: stripEditionSuffix(needle), history: direct.history };
  }

  const records = gameHistories as Record<string, HistoryRecord>;
  const q = rankingSearchQuery(needle).toLowerCase();
  const needleLower = needle.toLowerCase();

  let best: { title: string; history: string; score: number } | null = null;
  for (const [title, rec] of Object.entries(records)) {
    if (!rec.history) continue;
    const titleQ = rankingSearchQuery(title).toLowerCase();
    const titleLower = title.toLowerCase();
    let score = 0;
    if (titleQ === q || titleLower === needleLower) score = 3;
    else if (titleQ === needleLower || titleLower === q) score = 2;
    else if (titleLower.startsWith(needleLower) || needleLower.startsWith(titleLower)) score = 1;
    else continue;
    if (!best || score > best.score) {
      best = { title, history: clipHistory(rec.history), score };
    }
  }
  return best ? { title: best.title, history: best.history } : null;
}

function amiga101CoverUrl(rank: number): string {
  return `/covers/amiga101/${String(rank).padStart(3, '0')}.jpg`;
}

function buildFromGameRankings(): TopGame[] {
  const byKey = new Map<string, TopGame>();

  for (const platform of Object.keys(GAME_JSON_KEY) as Array<Exclude<TopGamePlatform, 'arcade'>>) {
    const block = gameRankings.platforms[GAME_JSON_KEY[platform]];
    const rankKey = RANK_KEY[platform];
    for (const entry of block.games) {
      const searchQuery = rankingSearchQuery(entry.title);
      const key = `${platform}::${entry.rank}::${entry.title.toLowerCase()}`;
      byKey.set(key, {
        title: entry.title,
        searchQuery,
        platforms: [platform],
        ranks: { [rankKey]: entry.rank },
        ...(platform === 'amiga' ? { coverUrl: amiga101CoverUrl(entry.rank) } : {}),
        ...historyForTitle(entry.title),
      });
    }
  }

  return [...byKey.values()];
}

function buildFromMusicRankings(): TopGame[] {
  const byKey = new Map<string, TopGame>();

  for (const platform of Object.keys(MUSIC_JSON_KEY) as Array<Exclude<TopGamePlatform, 'arcade'>>) {
    const block = musicRankings.lists[MUSIC_JSON_KEY[platform]];
    const rankKey = RANK_KEY[platform];
    for (const entry of block.games) {
      const searchQuery = rankingSearchQuery(entry.game);
      const key = `music::${platform}::${entry.rank}::${entry.game.toLowerCase()}`;
      byKey.set(key, {
        title: entry.game,
        searchQuery,
        platforms: [platform],
        ranks: { [rankKey]: entry.rank },
        ...historyForTitle(entry.game),
      });
    }
  }

  return [...byKey.values()];
}

function buildFromArcadeRankings(): TopGame[] {
  return arcadeRankings.games.map((entry) => {
    const searchQuery = entry.searchQuery ?? rankingSearchQuery(entry.title);
    return {
      title: entry.title,
      searchQuery,
      platforms: ['arcade'],
      ranks: { vgmrips: entry.rank },
      ...historyForTitle(entry.title),
    };
  });
}

function buildFromFranceArcadeRankings(): TopGame[] {
  return franceArcadeRankings.games.map((entry) => {
    const searchQuery = entry.searchQuery ?? rankingSearchQuery(entry.title);
    return {
      title: entry.title,
      searchQuery,
      platforms: ['arcade'],
      ranks: { 'arcade-fr': entry.rank },
      ...historyForTitle(entry.title),
    };
  });
}

export const TOP_GAMES: TopGame[] = buildFromGameRankings();
export const TOP_MUSIC: TopGame[] = buildFromMusicRankings();
export const TOP_ARCADE: TopGame[] = buildFromArcadeRankings();
export const TOP_FRANCE_ARCADE: TopGame[] = buildFromFranceArcadeRankings();

export function topEntriesFor(kind: RankingKind): TopGame[] {
  switch (kind) {
    case 'games':
      return [...TOP_GAMES, ...TOP_ARCADE, ...TOP_FRANCE_ARCADE];
    case 'music':
      return [...TOP_MUSIC, ...TOP_ARCADE, ...TOP_FRANCE_ARCADE];
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled ranking kind: ${_exhaustive}`);
    }
  }
}
