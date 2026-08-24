#!/usr/bin/env node
/**
 * Discover top arcade VGM packs on VGMRips (by global download ranking).
 * Writes src/data/topArcadeRankings.json and prints slugs for fetch-vgmrips.mjs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = join(ROOT, 'src', 'data', 'topArcadeRankings.json');
const FRANCE_JSON = join(ROOT, 'src', 'data', 'topFranceArcade80s90s.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const BASE = 'https://vgmrips.net/packs/top';
const TARGET = 100;

/** Keep local staples even if they fall outside the scraped top-100 arcade slice. */
const EXTRA_SLUGS = [
  { slug: 'double-dragon-arcade', title: 'Double Dragon', searchQuery: 'Double Dragon' },
  {
    slug: 'bad-dudes-vs-dragonninja-data-east',
    title: 'Bad Dudes vs. Dragonninja',
    searchQuery: 'Dragon Ninja',
  },
  {
    slug: 'sky-shark-toaplan-1',
    title: 'Sky Shark / Flying Shark',
    searchQuery: 'Flying Shark',
  },
  { slug: 'turbo-out-run-arcade', title: 'Turbo Out Run', searchQuery: 'Turbo Out Run' },
  { slug: 'after-burner-ii-sega-x', title: 'After Burner II', searchQuery: 'After Burner' },
  { slug: 'space-harrier-hang-on', title: 'Space Harrier', searchQuery: 'Space Harrier' },
  { slug: 'super-hang-on-arcade', title: 'Super Hang-On', searchQuery: 'Super Hang-On' },
  { slug: 'enduro-racer-arcade', title: 'Enduro Racer', searchQuery: 'Enduro Racer' },
  { slug: 'g-loc-air-battle-sega-y', title: 'G-LOC Air Battle', searchQuery: 'G-LOC' },
  {
    slug: 'robocop-the-future-of-law-enforcement-data-east',
    title: 'RoboCop',
    searchQuery: 'RoboCop',
  },
  {
    slug: 'chelnov-atomic-runner-karnov',
    title: 'Chelnov: Atomic Runner',
    searchQuery: 'Chelnov',
  },
  { slug: 'karnov-arcade', title: 'Karnov', searchQuery: 'Karnov' },
  { slug: 'heavy-barrel-data-east', title: 'Heavy Barrel', searchQuery: 'Heavy Barrel' },
  {
    slug: 'act-fancer-cybernetick-hyper-weapon-arcade',
    title: 'Act-Fancer: Cybernetick Hyper Weapon',
    searchQuery: 'Act-Fancer',
  },
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function parseArcadePacks(html) {
  const packs = [];
  const rowRe =
    /<div class="image[^"]*">[\s\S]*?<img src="([^"]*\/small\/Arcade\/[^"]+)" alt="([^"]+)"[\s\S]*?href="https:\/\/vgmrips\.net\/packs\/pack\/([^"#]+)"/gi;
  let match;
  while ((match = rowRe.exec(html)) !== null) {
    packs.push({ title: match[2].trim(), slug: match[3].trim() });
  }
  return packs;
}

function searchQueryFromTitle(title) {
  const stripped = title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\/\s*[^/]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const first = stripped.split(' / ')[0]?.trim() ?? stripped;
  if (first.length <= 32) return first;
  const words = first.split(' ');
  return words.slice(0, Math.min(4, words.length)).join(' ');
}

async function discoverTopArcade(limit = TARGET) {
  const seen = new Set();
  const results = [];

  for (let page = 0; results.length < limit && page < 400; page += 1) {
    const url = page === 0 ? BASE : `${BASE}?p=${page}`;
    const html = await fetchText(url);
    const packs = parseArcadePacks(html);
    if (packs.length === 0) break;

    for (const pack of packs) {
      if (seen.has(pack.slug)) continue;
      seen.add(pack.slug);
      results.push(pack);
      if (results.length >= limit) break;
    }
    process.stderr.write(`page ${page + 1}: ${results.length} arcade packs\n`);
  }

  return results;
}

function mergeExtras(top) {
  const extraSlugSet = new Set(EXTRA_SLUGS.map((entry) => entry.slug));
  const slugs = new Set(top.map((entry) => entry.slug));
  const merged = [...top];

  for (const extra of EXTRA_SLUGS) {
    if (!slugs.has(extra.slug)) {
      merged.push({ title: extra.title, slug: extra.slug, searchQuery: extra.searchQuery });
      slugs.add(extra.slug);
    }
  }

  while (merged.length > TARGET) {
    let removed = false;
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      if (!extraSlugSet.has(merged[i].slug)) {
        merged.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed) merged.pop();
  }

  return merged.slice(0, TARGET);
}

function normKey(entry) {
  return (entry.searchQuery || entry.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** France café/forain staples first, then VGMRips / extras to fill 100. */
function mergeFranceFirst(vgmripsTop) {
  let franceGames = [];
  try {
    const france = JSON.parse(readFileSync(FRANCE_JSON, 'utf8'));
    franceGames = (france.games ?? []).map((entry) => ({
      title: entry.title,
      slug: entry.slug,
      searchQuery: entry.searchQuery,
    }));
  } catch {
    process.stderr.write(`Warning: could not read ${FRANCE_JSON}\n`);
  }

  const bySlug = new Set();
  const byQuery = new Set();
  const merged = [];

  for (const entry of franceGames) {
    if (!entry.slug || bySlug.has(entry.slug)) continue;
    merged.push(entry);
    bySlug.add(entry.slug);
    byQuery.add(normKey(entry));
  }

  for (const entry of vgmripsTop) {
    if (bySlug.has(entry.slug) || byQuery.has(normKey(entry))) continue;
    merged.push({
      title: entry.title,
      slug: entry.slug,
      searchQuery: entry.searchQuery ?? searchQueryFromTitle(entry.title),
    });
    bySlug.add(entry.slug);
    byQuery.add(normKey(entry));
    if (merged.length >= TARGET) break;
  }

  return merged.slice(0, TARGET);
}

function buildRankingsJson(games) {
  return {
    generated_at: new Date().toISOString().slice(0, 10),
    description:
      'Top 100 arcade for Retro Music Player: French café/forain staples (late 80s–90s) first, then VGMRips global top-download packs.',
    source: {
      name: 'Arcade Top 100 (France + VGMRips)',
      url: 'https://vgmrips.net/packs/top',
      method:
        'France diffusions (reconstituted) prepended; remaining slots filled from VGMRips Arcade top downloads + curated staples',
      note:
        'No official French installation chart exists. France list from Play Meter/RePlay proxies + French oral history; rest from VGMRips.',
    },
    games: games.map((entry, index) => ({
      rank: index + 1,
      title: entry.title,
      searchQuery: entry.searchQuery ?? searchQueryFromTitle(entry.title),
      slug: entry.slug,
    })),
  };
}

async function main() {
  const writeJson = !process.argv.includes('--slugs-only');
  let top = await discoverTopArcade(TARGET);

  if (top.length < TARGET) {
    console.error(`Warning: only found ${top.length} arcade packs in top pages`);
  }

  top = mergeFranceFirst(mergeExtras(top));

  if (writeJson) {
    writeFileSync(OUT_JSON, `${JSON.stringify(buildRankingsJson(top), null, 2)}\n`);
    console.error(`Wrote ${OUT_JSON} (${top.length} games)`);
  }

  for (const entry of top) {
    console.log(entry.slug);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
