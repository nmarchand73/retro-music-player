import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchLocalCatalog, getLocalTrack } from './data/localCatalog.js';
import {
  getModArchiveTrack,
  hasModArchiveKey,
  modArchiveDownloadUrl,
  searchModArchive,
} from './services/modarchive.js';
import { getSndhTrack, searchSndh, sndhDownloadUrl, sndhReferer } from './services/sndh.js';
import type { DatabaseInfo, MusicPlatform, SearchResponse, Track } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const MODARCHIVE_API_KEY = process.env.MODARCHIVE_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, modArchiveConfigured: hasModArchiveKey(MODARCHIVE_API_KEY) });
});

app.get('/api/databases', (_req, res) => {
  const databases: DatabaseInfo[] = [
    {
      id: 'modarchive',
      name: 'The Mod Archive',
      description:
        'World\'s largest tracker module collection — Amiga MOD/MED/XM/S3M and Atari ST STM formats.',
      platform: 'both',
      url: 'https://modarchive.org/',
      apiUrl: 'https://api.modarchive.org/xml-tools.php',
      connected: hasModArchiveKey(MODARCHIVE_API_KEY),
      requiresKey: true,
      stats: '100,000+ modules',
    },
    {
      id: 'sndh',
      name: 'SNDH Archive',
      description: 'Official Atari ST/STe YM2149 chiptune archive with 5,900+ SNDH files.',
      platform: 'atari',
      url: 'https://sndh.atari.org/',
      connected: true,
      requiresKey: false,
      stats: '11,900+ subtunes',
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
      description: 'Built-in sample tracks when remote databases are unavailable.',
      platform: 'both',
      connected: true,
      requiresKey: false,
      stats: '4 demo tracks',
    },
  ];

  res.json({ databases });
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const platform = (String(req.query.platform ?? 'all') as MusicPlatform) || 'all';

  try {
    const tasks: Promise<Track[]>[] = [Promise.resolve(searchLocalCatalog(query, platform))];

    if (platform === 'all' || platform === 'amiga' || platform === 'atari') {
      if (hasModArchiveKey(MODARCHIVE_API_KEY)) {
        tasks.push(searchModArchive(query, MODARCHIVE_API_KEY, platform));
      }
    }

    if (platform === 'all' || platform === 'atari') {
      tasks.push(searchSndh(query));
    }

    const resultSets = await Promise.allSettled(tasks);
    const tracks = resultSets.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

    const unique = new Map<string, (typeof tracks)[number]>();
    for (const track of tracks) {
      unique.set(`${track.source}:${track.id}`, track);
    }

    const response: SearchResponse = {
      query,
      platform,
      total: unique.size,
      tracks: Array.from(unique.values()),
      sources: {
        modarchive: {
          connected: hasModArchiveKey(MODARCHIVE_API_KEY),
          message: hasModArchiveKey(MODARCHIVE_API_KEY)
            ? 'Connected to Mod Archive XML API'
            : 'Set MODARCHIVE_API_KEY in .env — request free key at modarchive.org/forums',
        },
        sndh: {
          connected: true,
          message: 'Connected to sndh.atari.org search',
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
    if (source === 'modarchive') track = await getModArchiveTrack(id, MODARCHIVE_API_KEY);
    else if (source === 'sndh') track = await getSndhTrack(id);
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
    if (source === 'modarchive') {
      const upstream = await fetch(modArchiveDownloadUrl(id));
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: 'Mod Archive download failed' });
        return;
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
      return;
    }

    if (source === 'sndh') {
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
      // Redirect local demos to well-known public domain / archive samples
      const demoUrls: Record<string, string> = {
        'demo-amiga-1': 'https://api.modarchive.org/downloads.php?moduleid=41529',
        'demo-amiga-2': 'https://api.modarchive.org/downloads.php?moduleid=601',
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

app.listen(PORT, () => {
  console.log(`Retro Music Player API on http://localhost:${PORT}`);
  console.log(
    hasModArchiveKey(MODARCHIVE_API_KEY)
      ? 'Mod Archive API key configured'
      : 'No Mod Archive API key — using SNDH + local catalog only',
  );
});
