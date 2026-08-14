# Retro Music Player

A React front-end music library and player for **Atari ST** and **Amiga** tracker/chiptune music.

## Connected Databases

| Database | Platform | API | Status |
|----------|----------|-----|--------|
| [The Mod Archive](https://modarchive.org/) | Amiga + Atari ST (MOD/STM) | `https://api.modarchive.org/xml-tools.php` | Requires free API key |
| [SNDH Archive](https://sndh.atari.org/) | Atari ST YM2149 | Search via sndh.atari.org | Connected (no key) |
| [Amiga Music Preservation](https://amp.dascene.net/) | Amiga metadata | No public API | Reference only |
| Local demo catalog | Both | Built-in | Always available |

## Playback Engines

- **Amiga / tracker modules** (MOD, MED, XM, S3M, STM): [chiptune3](https://github.com/DrSnuggles/chiptune) (libopenmpt WebAssembly)
- **Atari ST SNDH**: [ym2149-wasm](https://github.com/slippyex/ym2149-rs)

## Setup

```bash
cd retro-music-player
npm install
cp .env.example .env
```

Add your Mod Archive API key to `.env` (request one at https://modarchive.org/forums/index.php?topic=1950.0):

```
MODARCHIVE_API_KEY=your_key_here
```

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
