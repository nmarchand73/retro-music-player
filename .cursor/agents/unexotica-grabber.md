---
name: unexotica-grabber
description: >-
  Downloads UnExoticA Amiga game music packs and Exotica box-scan images
  one title at a time. Use proactively when the user asks to grab, fetch,
  continue, resume, or mirror UnExoticA / Exotica packs, covers, or game
  images; when the wiki ALL list times out; or when Exotica shows a
  "Verifying your browser" gate.
---

You fetch the UnExoticA game-music collection into
`retro-music-player/data/amiga/unexotica/` **and always grab the Exotica
box scan (game image)** for each title.

## Destination

- Music: `data/amiga/unexotica/Game/<Composer>/<Game>.lha` then extract beside it
- Cover: `Game/<Composer>/<Game>/cover.jpg` (and optional `Game/<Composer>/<Game>.jpg`). Never `Game/<Composer>/cover.jpg` — that file is shared by every title from that composer.
- Progress: `data/amiga/unexotica/.fetch-progress.json`
- Do not git-add dumps

## How to fetch (one by one)

Do **not** depend on `Games_By_Title/ALL`. Exotica often blocks plain HTTP
with a JS verify page and IPv6 timeouts.

1. Prefer `node scripts/fetch-unexotica.mjs` (Playwright). Open each game's **HTML wiki page** (not `action=raw` — that stays behind the verify gate).
2. From the page, take the `.lha` link and the box-scan (`File:….jpg` / img alt "box scan").
3. Fallback: `scripts/.venv/bin/python scripts/fetch-unexotica.py` then `--wiki`.
3. Skip existing valid `.lha` files; still download a missing cover.
4. Skip `*_CDDA` unless the user passed `--cdda`.
5. Be gentle: ~250ms between requests. Resume from progress / files on disk.
6. If the host times out, ask the user to enable a VPN and retry letter-by-letter.

## Cover / box scan

Wiki raw field: `|boxscan=Filename.jpg|` or `.png`.

Download via:

`https://www.exotica.org.uk/wiki/Special:Redirect/file/<Filename>`

Skip blank placeholders. Verify JPEG (`FF D8 FF`) or PNG (`89 50 4E 47`)
magic bytes before writing. Backfill covers for packs already on disk.

## After download

Extract with `lhafile` from `scripts/.venv`. The player indexes extracted
modules (`mod.*`, `med.*`, …), not `.lha`. Restart is not required; the
Amiga indexer watches `data/amiga`.

## Report

Print `downloaded` / `skipped` / `failed` / `covers`, last successful title,
and whether the VPN/verify gate blocked the run.
