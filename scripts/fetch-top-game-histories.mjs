#!/usr/bin/env node
/**
 * Fetch short encyclopedic histories for top-chart game titles (Wikipedia).
 * Uses MediaWiki batch extracts to stay under rate limits.
 * Output: src/data/topGameHistories.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TITLES_PATH = path.join(ROOT, 'scripts', '_chart-titles.json');
const OUT_PATH = path.join(ROOT, 'src', 'data', 'topGameHistories.json');
const MAX_WORDS = 200;
const UA = 'RetroMusicPlayerHistories/1.3 (educational offline metadata; local.dev)';
const BATCH = 18;
const PAUSE_MS = 850;

const SEARCH_ALIASES = {
  'IK+': 'International Karate Plus',
  'IK+ Gold': 'International Karate Plus',
  'Turrican II: The Final Fight': 'Turrican II',
  'Turrican II: The Final Fight (2022)': 'Turrican II',
  'Turrican II - The Final Fight': 'Turrican II',
  'Speedball 2: Brutal Deluxe': 'Speedball 2',
  'Speedball II - Brutal Deluxe': 'Speedball 2',
  'Dune II: The Battle for Arrakis': 'Dune II',
  'UFO: Enemy Unknown': 'X-COM: UFO Defense',
  'UFO: Enemy Unknown (AGA)': 'X-COM: UFO Defense',
  'UFO: Enemy Unknown (OCS/ECS)': 'X-COM: UFO Defense',
  'Another World': 'Another World (video game)',
  OutRun: 'Out Run',
  'Pirates!': "Sid Meier's Pirates!",
  Elite: 'Elite (video game)',
  'Elite Plus': 'Elite (video game)',
  Commando: 'Commando (video game)',
  Delta: 'Delta (video game)',
  Parallax: 'Parallax (video game)',
  Hawkeye: 'Hawkeye (video game)',
  1942: '1942 (video game)',
  'Cannon Fodder': 'Cannon Fodder (video game)',
  Lemmings: 'Lemmings (video game)',
  Populous: 'Populous (video game)',
  'Wing Commander': 'Wing Commander (video game)',
  'Eye of the Beholder': 'Eye of the Beholder (video game)',
  Wasteland: 'Wasteland (video game)',
  'Lords of Chaos': 'Lords of Chaos (video game)',
  'Archon: The Light and the Dark': 'Archon (video game)',
  Agony: 'Agony (video game)',
  'Rainbow Islands': 'Rainbow Islands: The Story of Bubble Bobble 2',
  'Cybernoid II': 'Cybernoid II: The Revenge',
  'Alien Breed II': 'Alien Breed II: The Horror Continues',
  'Rambo: First Blood Part II': 'Rambo: First Blood Part II (video game)',
  'Turbo Outrun': 'Turbo OutRun',
  "Sensible World of Soccer '96/'97": 'Sensible World of Soccer',
  "Sensible World of Soccer '95/'96": 'Sensible World of Soccer',
  'Sensible World of Soccer v1.1': 'Sensible World of Soccer',
  'Ultima V - Warriors of Destiny': 'Ultima V: Warriors of Destiny',
  'Ultima VI - The False Prophet': 'Ultima VI: The False Prophet',
  "Bitmap Brothers' Magic Pockets": 'Magic Pockets',
  "Ghosts 'n Goblins Arcade": "Ghosts 'n Goblins",
  'Arkanoid II: Revenge of Doh': 'Arkanoid: Revenge of Doh',
  'Batman: The Movie': 'Batman: The Movie (video game)',
  Batman: 'Batman (1989 video game)',
  'Beneath a Steel Sky (CD32)': 'Beneath a Steel Sky',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function clipWords(text, max = MAX_WORDS) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  const cut = words.slice(0, max).join(' ');
  const sentence = cut.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (sentence && wordCount(sentence[0]) >= Math.min(40, max * 0.45)) {
    return sentence[0].trim();
  }
  return `${cut.replace(/[,:;–—-]\s*$/, '').trim()}…`;
}

function stripEdition(title) {
  return title
    .replace(/\s*\((?:AGA|ECS|OCS|OCS\/ECS|CD32|cartridge|\d{4})\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTokens(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !['the', 'of', 'and', 'a', 'an'].includes(t));
}

function titleOverlap(query, pageTitle) {
  const q = new Set(normalizeTokens(query));
  const p = new Set(normalizeTokens(pageTitle.replace(/\(.*?\)/g, ' ')));
  if (q.size === 0) return 0;
  let hit = 0;
  for (const t of q) if (p.has(t)) hit += 1;
  return hit / q.size;
}

function isGamePage(page, queryTitle) {
  if (!page?.extract || page.missing != null) return false;
  const title = page.title || '';
  const desc = (page.description || '').toLowerCase();
  const extract = page.extract.toLowerCase();
  const head = extract.slice(0, 360);

  const explicitGame =
    /\(video game\)/i.test(title) ||
    desc.includes('video game') ||
    desc.includes('computer game') ||
    desc.includes('arcade game') ||
    /\b(video|computer|arcade)\s+game\b/.test(head) ||
    (/\b(developed|published)\s+by\b/.test(head) &&
      /\b(amiga|commodore|atari|spectrum|amstrad|c64|nes|arcade)\b/.test(head));

  if (!explicitGame) return false;

  if (
    /\b(superhero|comic book character|film series|television series|musician|composer|band)\b/.test(
      desc,
    ) &&
    !/\(video game\)/i.test(title) &&
    !desc.includes('video game')
  ) {
    return false;
  }

  const overlap = titleOverlap(stripEdition(queryTitle), title);
  if (/\(video game\)/i.test(title) && overlap >= 0.34) return true;
  if (overlap < 0.5) return false;
  if (/asphalt:\s*urban/i.test(title) && !/asphalt:\s*urban/i.test(queryTitle)) return false;
  return true;
}

async function wikiGet(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') || 15);
    console.warn(`rate-limited, sleeping ${wait}s`);
    await sleep(wait * 1000);
    return wikiGet(url);
  }
  if (!res.ok) {
    console.warn(`HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

/**
 * Fetch extracts for a list of wiki titles; return Map(requestedTitle -> page).
 */
async function fetchExtractMap(pageTitles) {
  const unique = [...new Set(pageTitles.filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH);
    const titlesParam = slice.join('|');
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&origin=*' +
      '&prop=extracts|description|info&exintro=1&explaintext=1&inprop=url' +
      `&titles=${encodeURIComponent(titlesParam)}`;
    const data = await wikiGet(url);
    await sleep(PAUSE_MS);
    if (!data?.query?.pages) continue;

    const pagesByTitle = new Map();
    for (const page of Object.values(data.query.pages)) {
      if (page?.title) pagesByTitle.set(page.title, page);
    }

    const normalizeTo = new Map();
    for (const n of data.query.normalized ?? []) normalizeTo.set(n.from, n.to);
    for (const r of data.query.redirects ?? []) normalizeTo.set(r.from, r.to);

    const resolve = (name) => {
      let cur = name;
      for (let step = 0; step < 5; step += 1) {
        const next = normalizeTo.get(cur);
        if (!next || next === cur) break;
        cur = next;
      }
      return cur;
    };

    for (const requested of slice) {
      const resolved = resolve(requested);
      const page = pagesByTitle.get(resolved);
      if (page) map.set(requested, page);
    }
  }
  return map;
}

function wikiLookupNames(chartTitle) {
  const stripped = stripEdition(chartTitle);
  const alias = SEARCH_ALIASES[chartTitle] ?? SEARCH_ALIASES[stripped];
  const names = [];
  if (alias) names.push(alias);
  if (!/\(video game\)/i.test(stripped)) names.push(`${stripped} (video game)`);
  names.push(stripped);
  return [...new Set(names)];
}

function loadExisting() {
  if (!existsSync(OUT_PATH)) return {};
  try {
    return JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function save(out) {
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
}

function toRecord(page) {
  return {
    history: clipWords(page.extract),
    source: 'wikipedia',
    page: page.title,
    url:
      page.fullurl ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
  };
}

const titles = JSON.parse(readFileSync(TITLES_PATH, 'utf8'));
const out = loadExisting();

const BAD_PAGES = new Set([
  'Batman',
  'Ben Daglish',
  'Asphalt: Urban GT',
  'List of video games based on cartoons',
]);
for (const [title, rec] of Object.entries(out)) {
  if (!rec?.history || (rec.page && BAD_PAGES.has(rec.page))) delete out[title];
}

const pending = titles.filter((t) => !out[t]?.history);
console.log(`Pass 1: preferred titles for ${pending.length} games`);

// Collect all candidate wiki names, fetch once, then assign in preference order.
const allCandidates = [];
const candidatesByChart = new Map();
for (const chartTitle of pending) {
  const names = wikiLookupNames(chartTitle);
  candidatesByChart.set(chartTitle, names);
  allCandidates.push(...names);
}

const pageMap = await fetchExtractMap(allCandidates);
let assigned = 0;
for (const chartTitle of pending) {
  for (const wikiName of candidatesByChart.get(chartTitle) ?? []) {
    const page = pageMap.get(wikiName);
    if (page && isGamePage(page, chartTitle)) {
      out[chartTitle] = toRecord(page);
      assigned += 1;
      break;
    }
  }
}
save(out);
console.log(`Pass 1 assigned ${assigned}; total with history ${Object.values(out).filter((r) => r?.history).length}`);

const stillMissing = titles.filter((t) => !out[t]?.history);
console.log(`Pass 2: search for ${stillMissing.length} misses`);

for (let i = 0; i < stillMissing.length; i += 1) {
  const chartTitle = stillMissing[i];
  const q = `${stripEdition(chartTitle)} video game`;
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&origin=*' +
    `&srsearch=${encodeURIComponent(q)}`;
  process.stdout.write(`[${i + 1}/${stillMissing.length}] ${chartTitle}… `);
  const data = await wikiGet(url);
  await sleep(PAUSE_MS);
  const hits = (data?.query?.search ?? []).map((h) => h.title);
  let resolved = false;
  if (hits.length) {
    const hitMap = await fetchExtractMap(hits);
    for (const hit of hits) {
      const page = hitMap.get(hit);
      if (page && isGamePage(page, chartTitle)) {
        out[chartTitle] = toRecord(page);
        resolved = true;
        console.log(`ok ← ${page.title}`);
        break;
      }
    }
  }
  if (!resolved) {
    out[chartTitle] = { history: null, source: null, page: null, url: null };
    console.log('MISS');
  }
  if ((i + 1) % 12 === 0) save(out);
}

save(out);
const found = Object.values(out).filter((r) => r?.history).length;
console.log(`\nWrote ${OUT_PATH}`);
console.log(`found=${found} missing=${titles.length - found} total=${titles.length}`);
