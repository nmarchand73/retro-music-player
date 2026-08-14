#!/usr/bin/env node
/**
 * Download UnExoticA game packs and Exotica box scans one title at a time.
 * Exotica currently serves a JS "Verifying..." gate that plain HTTP clients fail.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(ROOT, "data", "amiga", "unexotica");
const PROGRESS = join(DEST, ".fetch-progress.json");
const PYTHON = join(ROOT, "scripts", ".venv", "bin", "python");
const LETTERS = ["0-9", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];
const SKIP_CDDA = !process.argv.includes("--cdda");
const FILTER = process.argv.find((arg) => arg.startsWith("--filter="))?.slice(9) ?? "";
const DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLha(buf) {
  return buf.length > 8 && buf.subarray(0, 16).includes(Buffer.from("-lh"));
}

function imageExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return ".png";
  }
  return null;
}

function coverPath(dir) {
  const jpg = join(dir, "cover.jpg");
  const png = join(dir, "cover.png");
  if (existsSync(jpg) && statSync(jpg).size > 32) return jpg;
  if (existsSync(png) && statSync(png).size > 32) return png;
  return null;
}

function coverForArchive(archive) {
  const dir = dirname(archive);
  const stem = archive.replace(/\.lha$/i, "").split("/").pop() ?? "cover";
  const extractDir = join(dir, stem);
  return (
    coverPath(extractDir) ||
    (existsSync(join(dir, `${stem}.jpg`)) ? join(dir, `${stem}.jpg`) : null) ||
    (existsSync(join(dir, `${stem}.png`)) ? join(dir, `${stem}.png`) : null)
  );
}

function loadProgress() {
  if (!existsSync(PROGRESS)) return {};
  try {
    const data = JSON.parse(readFileSync(PROGRESS, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  mkdirSync(DEST, { recursive: true });
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 0));
}

function existingLhaIndex() {
  const found = new Map();
  if (!existsSync(DEST)) return found;
  const stack = [DEST];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!name.toLowerCase().endsWith(".lha")) continue;
      const stem = name.slice(0, -4);
      found.set(stem.replaceAll("_", " ").toLowerCase(), path);
      found.set(stem.toLowerCase(), path);
    }
  }
  return found;
}

function extractLha(archive) {
  if (!existsSync(PYTHON)) return;
  const script = `
import sys
from pathlib import Path
archive = Path(sys.argv[1])
try:
    import lhafile
except ImportError:
    sys.exit(0)
out_dir = archive.parent / archive.stem
if out_dir.exists() and any(out_dir.iterdir()):
    sys.exit(0)
try:
    lha = lhafile.Lhafile(str(archive))
    for info in lha.infolist():
        relative = Path(*Path(info.filename.replace(chr(92), "/")).parts)
        target = (out_dir / relative).resolve()
        if not str(target).startswith(str(out_dir.resolve())):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if relative.parts:
            target.write_bytes(lha.read(info.filename))
except Exception as error:
    print(f"extract skip {archive.name}: {error}", flush=True)
`;
  spawnSync(PYTHON, ["-c", script, archive], { stdio: "inherit" });
}

function isVerifyPage(text) {
  return /Verifying your browser/i.test(text) || /<title>Verifying/i.test(text);
}

async function waitVerified(page, url = "https://www.exotica.org.uk/wiki/UnExoticA") {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => !/verifying/i.test(document.title), { timeout: 15000 });
}

async function requestBuffer(context, page, url) {
  let response = await context.request.get(url, { timeout: 90000 });
  let buf = Buffer.from(await response.body());
  const head = buf.toString("utf8", 0, 400);
  if (!isVerifyPage(head)) return buf;
  await waitVerified(page);
  response = await context.request.get(url, { timeout: 90000 });
  return Buffer.from(await response.body());
}

async function openWiki(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (/verifying/i.test(await page.title())) {
    await page.waitForFunction(() => !/verifying/i.test(document.title), { timeout: 15000 });
  }
}

async function listTitles(page) {
  const titles = [];
  const seen = new Set();
  for (const letter of LETTERS) {
    await sleep(DELAY_MS);
    await openWiki(page, `https://www.exotica.org.uk/wiki/UnExoticA/Games_By_Title/${letter}`);
    const found = await page.evaluate(() => {
      const content = document.querySelector("#mw-content-text");
      if (!content) return [];
      return [...content.querySelectorAll("table tr")]
        .map((row) => {
          const cell = row.querySelector("td:first-child a");
          return (cell?.getAttribute("title") || cell?.textContent || "").trim();
        })
        .filter((name) => name && !name.includes("Games By Title"));
    });
    let count = 0;
    for (const title of found) {
      if (seen.has(title)) continue;
      seen.add(title);
      titles.push(title);
      count += 1;
    }
    console.log(`letter ${letter}: ${count} titles`);
  }
  return titles;
}

function archiveUrl(filelink) {
  const params = new URLSearchParams({ file: `exotica/${filelink}` });
  return `http://files.exotica.org.uk/?${params.toString()}`;
}

async function downloadLha(context, filesPage, filelink, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size > 32 && isLha(readFileSync(dest).subarray(0, 32))) {
    return false;
  }
  const url = archiveUrl(filelink);
  try {
    const buf = await requestBuffer(context, filesPage, url);
    if (isLha(buf)) {
      writeFileSync(dest, buf);
      return true;
    }
  } catch {
    // Fall through to a real navigation, which can pass the JS gate.
  }
  const downloadPromise = filesPage.waitForEvent("download", { timeout: 60000 });
  // Always settle so a failed goto cannot leave an unhandled rejection.
  const ignoreDownload = downloadPromise.then(
    () => undefined,
    () => undefined,
  );
  try {
    await filesPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (/verifying/i.test(await filesPage.title())) {
      await filesPage.waitForFunction(() => !/verifying/i.test(document.title), { timeout: 15000 });
      await filesPage.reload({ waitUntil: "domcontentloaded" });
    }
    const download = await downloadPromise;
    await download.saveAs(dest);
  } catch (error) {
    await ignoreDownload;
    throw error;
  }
  const saved = readFileSync(dest).subarray(0, 32);
  if (!isLha(saved)) {
    throw new Error(`not an LHA archive (${statSync(dest).size} bytes)`);
  }
  return true;
}

function isDirectImageUrl(url) {
  return /\/mediawiki\/files\/.+\.(jpe?g|png)(\?|$)/i.test(url);
}

async function downloadCover(context, page, assets, archivePath) {
  if (coverForArchive(archivePath)) return false;
  let url = assets.coverHref || assets.coverSrc || null;
  if (!url || /blankboxscan/i.test(url)) return false;
  if (!isDirectImageUrl(url)) {
    await sleep(DELAY_MS);
    await openWiki(page, url);
    url = await page.evaluate(() => {
      const img = document.querySelector("#file img, .fullImageLink img, img.mw-file-element");
      return img ? img.src : null;
    });
  }
  if (!url) url = assets.coverSrc || null;
  if (!url || (!isDirectImageUrl(url) && !/\.(jpe?g|png)(\?|$)/i.test(url))) return false;
  await sleep(DELAY_MS);
  const buf = await requestBuffer(context, page, url);
  const ext = imageExt(buf);
  if (!ext) return false;
  const dir = dirname(archivePath);
  const stem = archivePath.replace(/\.lha$/i, "").split("/").pop() ?? "cover";
  const extractDir = join(dir, stem);
  mkdirSync(extractDir, { recursive: true });
  writeFileSync(join(extractDir, `cover${ext}`), buf);
  writeFileSync(join(dir, `${stem}${ext}`), buf);
  return true;
}

function readWikiAssets() {
  const lha = [...document.querySelectorAll("a")].find(
    (a) => /\.lha/i.test(a.getAttribute("href") || "") || /\.lha/i.test(a.textContent || ""),
  );
  let link = null;
  if (lha) {
    try {
      const file = new URL(lha.href).searchParams.get("file");
      if (file) link = file.replace(/^exotica\//, "");
      else if (/Game\/.+\.lha$/i.test((lha.textContent || "").trim())) {
        link = `media/audio/UnExoticA/${lha.textContent.trim()}`;
      }
    } catch {
      link = null;
    }
  }
  const box = [...document.querySelectorAll("a")].find(
    (a) =>
      /box scan/i.test(a.getAttribute("title") || "") ||
      /box scan/i.test(a.textContent || ""),
  );
  const coverImg = [...document.querySelectorAll("img")].find((img) =>
    /box scan/i.test(img.alt || ""),
  );
  const disambiguation = [...document.querySelectorAll("#mw-content-text a")].find((a) =>
    /\(game\)\s*$/i.test((a.textContent || "").trim()),
  );
  return {
    link,
    coverHref: box && !/blank/i.test(box.href) ? box.href : null,
    coverSrc: coverImg && !/blank/i.test(coverImg.src) ? coverImg.src : null,
    gameHref: disambiguation ? disambiguation.href : null,
  };
}

async function wikiAssets(page, title) {
  const slug = title.replaceAll(" ", "_");
  await openWiki(page, `https://www.exotica.org.uk/wiki/${encodeURIComponent(slug)}`);
  let assets = await page.evaluate(readWikiAssets);
  if (!assets.link && !assets.coverHref && !assets.coverSrc && assets.gameHref) {
    await openWiki(page, assets.gameHref);
    assets = await page.evaluate(readWikiAssets);
  }
  return assets;
}

function knownArchive(progress, existing, title) {
  const cached = progress[title];
  if (cached && cached !== "CDDA") return join(DEST, cached);
  const bare = title.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const keys = [title, bare].flatMap((value) => [
    value.toLowerCase(),
    value.replaceAll(" ", "_").toLowerCase(),
  ]);
  for (const key of keys) {
    const hit = existing.get(key);
    if (hit) return hit;
  }
  return undefined;
}

async function main() {
  mkdirSync(DEST, { recursive: true });
  const existing = existingLhaIndex();
  const progress = loadProgress();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const filesPage = await context.newPage();

  console.log("passing Exotica browser check…");
  await waitVerified(page, "https://www.exotica.org.uk/wiki/UnExoticA");

  let titles;
  const exact = FILTER.match(/^\^(.+)\$$/);
  if (exact) {
    titles = [exact[1].replaceAll("\\", "")];
    console.log(`UnExoticA games: 1 (${titles[0]})`);
  } else {
    titles = await listTitles(page);
    if (FILTER) {
      const filter = new RegExp(FILTER, "i");
      titles = titles.filter((title) => filter.test(title));
    }
    console.log(`UnExoticA games: ${titles.length}`);
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let covers = 0;

  for (const [index, title] of titles.entries()) {
    const n = index + 1;
    try {
      const cached = progress[title];
      if (cached === "CDDA") {
        skipped += 1;
        continue;
      }
      const known = knownArchive(progress, existing, title);
      const haveLha =
        known &&
        existsSync(known) &&
        statSync(known).size > 32 &&
        isLha(readFileSync(known).subarray(0, 32));

      if (haveLha) {
        extractLha(known);
        progress[title] = relative(DEST, known);
        skipped += 1;
        if (!coverForArchive(known)) {
          await sleep(DELAY_MS);
          const assets = await wikiAssets(page, title);
          if (await downloadCover(context, page, assets, known)) {
            covers += 1;
            console.log(`[${n}/${titles.length}] cover ${relative(DEST, dirname(known))}`);
          }
        }
        if (n % 50 === 0) console.log(`[${n}/${titles.length}] exists ${known.split("/").pop()}`);
        continue;
      }

      await sleep(DELAY_MS);
      const assets = await wikiAssets(page, title);
      const link = assets.link;
      if (!link) {
        console.log(`[${n}/${titles.length}] no file for ${title}`);
        failed += 1;
        continue;
      }
      if (SKIP_CDDA && link.includes("_CDDA")) {
        progress[title] = "CDDA";
        saveProgress(progress);
        skipped += 1;
        continue;
      }
      const dest = join(DEST, link.replace(/^media\/audio\/UnExoticA\//, ""));
      await sleep(DELAY_MS);
      const fresh = await downloadLha(context, filesPage, link, dest);
      extractLha(dest);
      if (await downloadCover(context, page, assets, dest)) covers += 1;
      progress[title] = relative(DEST, dest);
      saveProgress(progress);
      if (fresh) {
        downloaded += 1;
        console.log(`[${n}/${titles.length}] ${relative(DEST, dest)}`);
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      console.log(`[${n}/${titles.length}] FAIL ${title}: ${error.message}`);
    }
  }

  saveProgress(progress);
  await browser.close();
  console.log(
    `done downloaded=${downloaded} covers=${covers} skipped=${skipped} failed=${failed} dest=${DEST}`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
