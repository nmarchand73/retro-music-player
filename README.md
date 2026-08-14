# Retro Music Player

A React front-end music library and player for **Atari ST** YM2149 chiptunes and **Amiga** tracker modules.

## Connected Databases

| Database | Platform | API | Status |
|----------|----------|-----|--------|
| [SNDH Archive](https://sndh.atari.org/) | Atari ST YM2149 | Local dump in `data/sndh/sndh_lf` | Offline search + playback |
| [UnExoticA](https://www.exotica.org.uk/wiki/UnExoticA) | Amiga | Local extracts in `data/amiga/unexotica` | Offline search + playback |
| [Amiga Music Preservation](https://amp.dascene.net/) | Amiga metadata | No public API | Reference only |
| Local demo catalog | Atari ST | Built-in | Always available |

## Playback Engines

- **Atari ST SNDH**: [ym2149-wasm](https://github.com/slippyex/ym2149-rs)
- **Amiga modules**: [chiptune3](https://github.com/jsschelling/chiptune3) / libopenmpt

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
- `GET /api/search?q=...&platform=all|amiga|atari` — search across databases
- `GET /api/track/:source/:id` — track metadata
- `GET /api/stream/:source/:id` — audio file stream
