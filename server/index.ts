import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchLocalCatalog, getLocalTrack } from './data/localCatalog.js';
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

app.get('/api/health', async (_req, res) => {
  const sndh = await localSndhStats();
  res.json({
    ok: true,
    sndhLocal: sndh,
  });
});

app.get('/api/databases', async (_req, res) => {
  const sndh = await localSndhStats();
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

  try {
    const tasks: Promise<Track[]>[] = [Promise.resolve(searchLocalCatalog(query, platform, field))];

    if (platform === 'all' || platform === 'atari') {
      tasks.push(searchSndh(query, field));
    }

    const resultSets = await Promise.allSettled(tasks);
    const tracks = resultSets.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

    const unique = new Map<string, (typeof tracks)[number]>();
    for (const track of tracks) {
      unique.set(`${track.source}:${track.id}`, track);
    }

    const sndh = await localSndhStats();
    const response: SearchResponse = {
      query,
      platform,
      field,
      total: unique.size,
      tracks: Array.from(unique.values()),
      sources: {
        sndh: {
          connected: sndh.connected,
          message: sndh.connected
            ? `Local SNDH archive (${sndh.count.toLocaleString('en-US')} files)`
            : 'No local SNDH dump — falling back to sndh.atari.org',
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
    let track = null;
    if (source === 'sndh') track = await getSndhTrack(id);
    else if (source === 'local') track = getLocalTrack(id) ?? null;

    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }

    res.json(track);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Lookup failed' });
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

const sndhIndex = await loadSndhIndex();
app.listen(PORT, () => {
  console.log(`Retro Music Player API on http://localhost:${PORT}`);
  console.log(
    sndhIndex.length > 0
      ? `Local SNDH archive: ${sndhIndex.length.toLocaleString('en-US')} files`
      : 'No local SNDH archive — place sndh2026_lf.zip extract in data/sndh/sndh_lf',
  );
});
