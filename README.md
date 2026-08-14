# Retro Music Player

A React front-end music library and player for **Atari ST**, **Amiga**, **Amstrad CPC**, and **Commodore 64** music.

## Connected Databases

| Database | Platform | API | Status |
|----------|----------|-----|--------|
| [SNDH Archive](https://sndh.atari.org/) | Atari ST YM2149 | Local dump in `data/sndh/sndh_lf` | Offline search + playback |
| [UnExoticA](https://www.exotica.org.uk/wiki/UnExoticA) | Amiga | Local extracts in `data/amiga/unexotica` | Offline search + playback |
| CPC Archive | Amstrad CPC YM2149 | Local `data/cpc/cpc_lf` (SNDH) + `ym_games` (YM) | Offline search + playback |
| [HVSC](https://hvsc.c64.org/) | Commodore 64 SID | Local extract in `data/c64/HVSC/C64Music` | Offline search + playback |
| [Amiga Music Preservation](https://amp.dascene.net/) | Amiga metadata | No public API | Reference only |
| Local demo catalog | Atari ST | Built-in | Always available |

## Playback Engines

- **Atari ST / CPC SNDH**: [ym2149-wasm](https://github.com/slippyex/ym2149-rs)
- **Commodore 64 SID**: [libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm) (SIDLite)
- **Amiga trackers (MOD/XM/…)**: [chiptune3](https://github.com/jsschelling/chiptune3) / libopenmpt
- **Amiga exotic formats (CUST/MDAT/RJP/AGI/…)**: [UADE](http://zakalwe.fi/uade/) via `uade123` on the server (renders to WAV)

Install UADE for full UnExoticA coverage:

```bash
brew install uade
```

Optional override: `UADE_BIN=/path/to/uade123`. Without UADE, only openmpt-compatible modules play.

## Setup

```bash
cd retro-music-player
npm install
cp .env.example .env
```

### Local SNDH archive

The player searches and streams Atari tunes from a local copy of the official dump:

1. Download [sndh2026_lf.zip](https://sndh.atari.org/files/sndh2026_lf.zip) from [sndh.atari.org/download.php](https://sndh.atari.org/download.php).
2. Extract it to `data/sndh/` so files live under `data/sndh/sndh_lf/<composer>/…`.
3. Restart the server. The SNDH card should show **5,897 local SNDH files**.

Override the folder with `SNDH_ARCHIVE_DIR` if needed. Without a local dump, search falls back to sndh.atari.org.

### Local CPC archive

Amstrad CPC tunes play via the same YM2149 engine as Atari, from two local dumps:

**SNDH (composer archive)**

1. Download [cpc_lf.zip](https://sndh.atari.org/files/cpc_lf.zip) from [sndh.atari.org](https://sndh.atari.org/).
2. Extract so files live under `data/cpc/cpc_lf/<composer>/….snd`.
3. Restart the server (~296 SNDH tracks).

**YM game music (mainstream titles)**

1. From [genesis8 CPC music](http://genesis8.free.fr/frontend/music.php), download:
   - [cpcmuseu.zip](http://www.genesis8bit.fr/frontend/music/cpcmuseu.zip) (CPCMuseum game/demo YM)
   - optionally [cpctune2.zip](http://www.genesis8bit.fr/frontend/music/cpctune2.zip) / [cpctune.zip](http://www.genesis8bit.fr/frontend/music/cpctune.zip)
2. Extract under `data/cpc/ym_games/cpcmuseum/` (and `cpctune2/`, `cpctune/` as needed). Prefer ASCII-safe folder names if unzip fails on accented paths.
3. Restart the server (~300+ YM game themes: OutRun, RoboCop, Batman, Arkanoid, …).

Override with `CPC_ARCHIVE_DIR` (parent `data/cpc` by default).

**Note:** Project AY `.ay` rips for CPC are *not* playable yet — `ym2149-wasm` only emulates ZX Spectrum AY (CPC Z80/firmware calls are rejected). Use the SNDH and YM dumps above.

### Local C64 archive (HVSC)

1. Download an HVSC release (e.g. HVSC #85) from [hvsc.c64.org](https://hvsc.c64.org/).
2. Extract so SID files live under `data/c64/HVSC/C64Music/` (`MUSICIANS/`, `GAMES/`, `DEMOS/`, plus `DOCUMENTS/Songlengths.md5`).
3. Restart the server. Indexing ~60k SID files takes a short while on first start.

Override with `C64_ARCHIVE_DIR` if needed.

### Local Amiga archive (UnExoticA)

Game music lives under `data/amiga/unexotica/`. The player indexes **extracted modules** (`mod.*`, `med.*`, `p60.*`, …), not `.lha` packs, and skips sample/instrument files. New files dropped into `data/amiga` are picked up automatically.

To download more UnExoticA game packs:

```bash
scripts/.venv/bin/python scripts/fetch-unexotica.py
```

That writes `.lha` files, extracts them beside each archive, and can be re-run; existing packs are skipped. Override the folder with `AMIGA_ARCHIVE_DIR` if needed.

## Development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API proxy: http://localhost:3001

## Production

```bash
npm run build
npm start
```

Serves the built React app and API from port 3001.

## API Endpoints

- `GET /api/databases` — list connected music libraries
- `GET /api/search?q=...&platform=all|amiga|atari|cpc|c64` — search across databases
- `GET /api/track/:source/:id` — track metadata
- `GET /api/stream/:source/:id` — audio file stream
