#!/usr/bin/env node
/**
 * Download curated VGMRips arcade packs into data/vgm/vgmrips/.
 * Slugs come from src/data/topArcadeRankings.json (top 100 arcade on VGMRips).
 *
 * Usage:
 *   node scripts/fetch-vgmrips.mjs
 *   node scripts/fetch-vgmrips.mjs --slug=out-run-arcade
 *   node scripts/fetch-vgmrips.mjs --list
 *   node scripts/discover-vgmrips-top-arcade.mjs   # refresh rankings JSON first
 */

import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'data', 'vgm', 'vgmrips');
const RANKINGS = join(ROOT, 'src', 'data', 'topArcadeRankings.json');
const CLASSICS = join(ROOT, 'src', 'data', 'arcadeClassicsSlugs.json');
const FRANCE = join(ROOT, 'src', 'data', 'topFranceArcade80s90s.json');
const PROGRESS = join(DEST, '.fetch-progress.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const BASE = 'https://vgmrips.net';

function loadCuratedSlugs() {
  const slugs = new Set();
  if (existsSync(RANKINGS)) {
    const rankings = JSON.parse(readFileSync(RANKINGS, 'utf8'));
    for (const entry of rankings.games ?? []) {
      const slug = entry.slug?.trim();
      if (slug) slugs.add(slug);
    }
  }
  if (existsSync(CLASSICS)) {
    const classics = JSON.parse(readFileSync(CLASSICS, 'utf8'));
    for (const entry of classics.games ?? []) {
      const slug = entry.slug?.trim();
      if (slug) slugs.add(slug);
    }
  }
  if (existsSync(FRANCE)) {
    const france = JSON.parse(readFileSync(FRANCE, 'utf8'));
    for (const entry of france.games ?? []) {
      const slug = entry.slug?.trim();
      if (slug) slugs.add(slug);
    }
  }
  if (slugs.size === 0) {
    throw new Error(`No slugs in ${RANKINGS}, ${CLASSICS}, or ${FRANCE}`);
  }
  return [...slugs];
}

function loadProgress() {
  if (!existsSync(PROGRESS)) return { done: {} };
  try {
    return JSON.parse(readFileSync(PROGRESS, 'utf8'));
  } catch {
    return { done: {} };
  }
}

function saveProgress(progress) {
  mkdirSync(dirname(PROGRESS), { recursive: true });
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 2));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

function zipUrlFromPackPage(html) {
  const match = html.match(/href="(https:\/\/vgmrips\.net\/files\/[^"]+\.zip)"/i);
  return match?.[1] ?? null;
}

function destDirFromZipUrl(zipUrl) {
  const pathname = decodeURIComponent(new URL(zipUrl).pathname);
  const rel = pathname.replace(/^\/files\//, '');
  const folder = rel.replace(/\.zip$/i, '');
  return join(DEST, folder);
}

async function downloadFile(url, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(destPath));
}

function hasVgmFiles(dir) {
  if (!existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (/\.(vgm|vgz)$/i.test(name) && st.size > 64) return true;
    }
  }
  return false;
}

function unzip(zipPath, outDir) {
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync('unzip', ['-o', '-q', zipPath, '-d', outDir], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`unzip failed for ${zipPath}`);
}

async function fetchPack(slug, progress) {
  if (progress.done[slug]?.ok && hasVgmFiles(progress.done[slug].dest)) {
    console.log(`skip ${slug} (already fetched)`);
    return 'skip';
  }

  const pageUrl = `${BASE}/packs/pack/${slug}`;
  console.log(`fetch ${slug}…`);
  const html = await fetchText(pageUrl);
  const zipUrl = zipUrlFromPackPage(html);
  if (!zipUrl) throw new Error(`no zip link on ${pageUrl}`);

  const destDir = destDirFromZipUrl(zipUrl);
  const zipPath = join(DEST, '.cache', `${slug}.zip`);
  mkdirSync(dirname(zipPath), { recursive: true });

  console.log(`  zip ${zipUrl}`);
  await downloadFile(zipUrl, zipPath);
  console.log(`  extract → ${destDir}`);
  unzip(zipPath, destDir);

  progress.done[slug] = {
    ok: true,
    dest: destDir,
    zipUrl,
    fetchedAt: new Date().toISOString(),
  };
  saveProgress(progress);
  return 'ok';
}

async function main() {
  const slugs = loadCuratedSlugs();

  if (process.argv.includes('--list')) {
    for (const slug of slugs) console.log(slug);
    return;
  }

  const onlySlug = process.argv.find((a) => a.startsWith('--slug='))?.slice(7)?.trim();
  const toFetch = onlySlug ? [onlySlug] : slugs;
  const progress = loadProgress();

  mkdirSync(DEST, { recursive: true });

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const slug of toFetch) {
    try {
      const result = await fetchPack(slug, progress);
      if (result === 'skip') skip += 1;
      else ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`FAIL ${slug}:`, err instanceof Error ? err.message : err);
      progress.done[slug] = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        fetchedAt: new Date().toISOString(),
      };
      saveProgress(progress);
    }
  }

  console.log(`Done. fetched=${ok} skip=${skip} fail=${fail} — VGM under ${DEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
