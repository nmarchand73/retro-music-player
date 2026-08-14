import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchLocalCatalog, getLocalTrack } from './data/localCatalog.js';
import {
  getAmigaTrack,
  loadAmigaIndex,
  localAmigaStats,
  resolveAmigaCoverPath,
  resolveAmigaFilePath,
  searchAmiga,
} from './services/amiga.js';
import { attachGameCover, attachGameCovers, resolveGameCoverPath } from './services/covers.js';
import {
  findLocalSndhByTitle,
  getSndhTrack,
  loadSndhIndex,
  localSndhStats,
  resolveSndhFilePath,
  searchSndh,
  sndhDownloadUrl,
  sndhReferer,
} from './services/sndh.js';
import type { DatabaseInfo, MusicPlatform, SearchField, SearchResponse, Track } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json());

const COVER_HYDRATE_LIMIT = 200;

async function loadLiveTrack(source: string, id: string): Promise<Track | null> {
  if (source === 'sndh') return getSndhTrack(id);
  if (source === 'amiga') return getAmigaTrack(id);
  if (source === 'local') return getLocalTrack(id) ?? null;
  return null;
}

app.get('/api/health', async (_req, res) => {
  const [sndh, amiga] = await Promise.all([localSndhStats(), localAmigaStats()]);
  res.json({
    ok: true,
    sndhLocal: sndh,
    amigaLocal: amiga,
  });
});

app.get('/api/databases', async (_req, res) => {
  const [sndh, amiga] = await Promise.all([localSndhStats(), localAmigaStats()]);
  const databases: DatabaseInfo[] = [
    {
      id: 'sndh',
      name: 'SNDH Archive',
      description: sndh.connected
        ? 'Local Atari ST/STe YM2149 dump from sndh.atari.org, searched and played from disk.'
        : 'Official Atari ST/STe YM2149 chiptune archive. Download sndh2026_lf.zip into data/sndh to play offline.',
      platform: 'atari',
      url: 'https://sndh.atari.org/',
      connected: sndh.connected,
      requiresKey: false,
      stats: sndh.connected
        ? `${sndh.count.toLocaleString('en-US')} local SNDH files`
        : 'Archive missing',
    },
    {
      id: 'amiga',
      name: 'UnExoticA',
      description: amiga.connected
        ? 'Local Amiga game music from UnExoticA. New extracts under data/amiga are picked up automatically.'
        : 'Place UnExoticA extracts in data/amiga/unexotica (see scripts/fetch-unexotica.py).',
      platform: 'amiga',
      url: 'https://www.exotica.org.uk/wiki/UnExoticA',
      connected: amiga.connected,
      requiresKey: false,
      stats: amiga.connected
        ? `${amiga.count.toLocaleString('en-US')} local Amiga modules`
        : 'Archive missing',
    },
    {
      id: 'amp',
      name: 'Amiga Music Preservation',
      description:
        'Largest Amiga music database (178k+ modules). Metadata reference — no public API.',
      platform: 'amiga',
      url: 'https://amp.dascene.net/',
      connected: false,
      requiresKey: false,
      stats: '178,294 modules',
    },
    {
      id: 'local',
      name: 'Local Demo Catalog',
      description: 'Built-in Atari sample tracks from the local SNDH dump.',
      platform: 'atari',
      connected: true,
      requiresKey: false,
      stats: '2 demo tracks',
    },
  ];

  res.json({ databases });
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const platform = (String(req.query.platform ?? 'all') as MusicPlatform) || 'all';
  const field = (String(req.query.field ?? 'any') as SearchField) || 'any';
  const playableOnly = String(req.query.playable ?? '1') !== '0';

  try {
    const tasks: Promise<Track[]>[] = [Promise.resolve(searchLocalCatalog(query, platform, field))];

    if (platform === 'all' || platform === 'atari') {
      tasks.push(searchSndh(query, field));
    }
    if (platform === 'all' || platform === 'amiga') {
      tasks.push(searchAmiga(query, field, playableOnly));
    }

    const resultSets = await Promise.allSettled(tasks);
    const tracks = resultSets.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

    const unique = new Map<string, (typeof tracks)[number]>();
    for (const track of tracks) {
      unique.set(`${track.source}:${track.id}`, track);
    }
    const covered = await attachGameCovers(Array.from(unique.values()));

    const [sndh, amiga] = await Promise.all([localSndhStats(), localAmigaStats()]);
    const response: SearchResponse = {
      query,
      platform,
      field,
      total: unique.size,
      tracks: covered,
      sources: {
        sndh: {
          connected: sndh.connected,
          message: sndh.connected
            ? `Local SNDH archive (${sndh.count.toLocaleString('en-US')} files)`
            : 'No local SNDH dump — falling back to sndh.atari.org',
        },
        amiga: {
          connected: amiga.connected,
          message: amiga.connected
            ? `Local Amiga archive (${amiga.count.toLocaleString('en-US')} modules)`
            : 'No local Amiga dump — add UnExoticA extracts to data/amiga',
        },
        local: {
          connected: true,
          message: 'Local demo catalog available',
        },
      },
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Search failed' });
  }
});

app.get('/api/track/:source/:id', async (req, res) => {
  const { source, id } = req.params;

  try {
    const track = await loadLiveTrack(source, id);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    res.json(await attachGameCover(track));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Lookup failed' });
  }
});

app.post('/api/covers', async (req, res) => {
  const incoming = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
  try {
    const resolved = await Promise.all(
      incoming.slice(0, COVER_HYDRATE_LIMIT).map(async (raw: unknown) => {
        if (!raw || typeof raw !== 'object') return null;
        const stored = raw as Track;
        if (typeof stored.id !== 'string' || typeof stored.source !== 'string') return stored;
        const live = await loadLiveTrack(stored.source, stored.id);
        return live ?? stored;
      }),
    );
    const tracks = await attachGameCovers(resolved.filter((track): track is Track => track !== null));
    res.json({ tracks });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Cover hydrate failed' });
  }
});

app.get('/api/cover/:source/:id', async (req, res) => {
  const { source, id } = req.params;
  try {
    let localPath: string | null = null;
    if (source === 'amiga') {
      localPath = await resolveAmigaCoverPath(id);
    } else if (source === 'game') {
      localPath = await resolveGameCoverPath(id);
    } else {
      res.status(404).json({ error: 'No cover for this source' });
      return;
    }
    if (!localPath) {
      res.status(404).json({ error: 'Cover not found' });
      return;
    }
    const ext = path.extname(localPath).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(localPath);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Cover failed' });
  }
});

app.get('/api/stream/:source/:id', async (req, res) => {
  const { source, id } = req.params;

  try {
    if (source === 'sndh') {
      const localPath = await resolveSndhFilePath(id);
      if (localPath) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.sendFile(localPath);
        return;
      }

      const upstream = await fetch(sndhDownloadUrl(id), {
        headers: {
          Referer: sndhReferer(id),
          'User-Agent': 'RetroMusicPlayer/1.0',
        },
        redirect: 'follow',
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: 'SNDH download failed' });
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
      return;
    }

    if (source === 'amiga') {
      const localPath = await resolveAmigaFilePath(id);
      if (!localPath) {
        res.status(404).json({ error: 'Amiga track not found' });
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.sendFile(localPath);
      return;
    }

    if (source === 'local') {
      const localAtariTitles: Record<string, string> = {
        'demo-atari-1': 'Second Reality 2013',
        'demo-atari-2': 'Batman The Movie',
      };
      const localAtari = localAtariTitles[id];
      if (localAtari) {
        const match = await findLocalSndhByTitle(localAtari);
        if (match) {
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.sendFile(match.absolutePath);
          return;
        }
      }

      const demoUrls: Record<string, string> = {
        'demo-atari-1': sndhDownloadUrl('6326'),
        'demo-atari-2': sndhDownloadUrl('6324'),
      };

      const url = demoUrls[id];
      if (!url) {
        res.status(404).json({ error: 'Local demo not found' });
        return;
      }

      const headers: Record<string, string> = { 'User-Agent': 'RetroMusicPlayer/1.0' };
      if (id.startsWith('demo-atari')) {
        headers.Referer = sndhReferer(id === 'demo-atari-1' ? '6326' : '6324');
      }

      const upstream = await fetch(url, { headers, redirect: 'follow' });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: 'Demo stream failed' });
        return;
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
      return;
    }

    res.status(404).json({ error: 'Unknown source' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Stream failed' });
  }
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const [sndhIndex, amigaIndex] = await Promise.all([loadSndhIndex(), loadAmigaIndex()]);
app.listen(PORT, () => {
  console.log(`Retro Music Player API on http://localhost:${PORT}`);
  console.log(
    sndhIndex.length > 0
      ? `Local SNDH archive: ${sndhIndex.length.toLocaleString('en-US')} files`
      : 'No local SNDH archive — place sndh2026_lf.zip extract in data/sndh/sndh_lf',
  );
  console.log(
    amigaIndex.length > 0
      ? `Local Amiga archive: ${amigaIndex.length.toLocaleString('en-US')} modules`
      : 'No local Amiga archive — extract UnExoticA packs into data/amiga/unexotica',
  );
});
