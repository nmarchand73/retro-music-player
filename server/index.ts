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
  setAmigaTrackDuration,
} from './services/amiga.js';
import { attachGameCover, attachGameCovers, resolveGameCoverPath } from './services/covers.js';
import { wavDurationSeconds } from './services/amigaDuration.js';
import {
  getC64Track,
  loadC64Index,
  localC64Stats,
  resolveC64FilePath,
  searchC64,
} from './services/c64.js';
import {
  getCpcTrack,
  loadCpcIndex,
  localCpcStats,
  resolveCpcFilePath,
  searchCpc,
} from './services/cpc.js';
import { buildInsights } from './services/insights.js';
import {
  MACHINE_IDS,
  parseMachineList,
  type MachineId,
} from '../src/utils/machines.js';
import {
  isUadeAvailable,
  renderAmigaWithUade,
  shouldUseUade,
} from './services/uade.js';
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

function isMusicPlatform(value: string): value is MusicPlatform {
  switch (value) {
    case 'all':
    case 'amiga':
    case 'atari':
    case 'cpc':
    case 'c64':
      return true;
    default:
      return false;
  }
}

async function loadLiveTrack(source: string, id: string): Promise<Track | null> {
  switch (source) {
    case 'sndh':
      return getSndhTrack(id);
    case 'amiga':
      return getAmigaTrack(id);
    case 'cpc':
      return getCpcTrack(id);
    case 'c64':
      return getC64Track(id);
    case 'local':
      return getLocalTrack(id) ?? null;
    default:
      return null;
  }
}

app.get('/api/health', async (_req, res) => {
  const [sndh, amiga, cpc, c64, uade] = await Promise.all([
    localSndhStats(),
    localAmigaStats(),
    localCpcStats(),
    localC64Stats(),
    isUadeAvailable(),
  ]);
  res.json({
    ok: true,
    sndhLocal: sndh,
    amigaLocal: amiga,
    cpcLocal: cpc,
    c64Local: c64,
    uade,
  });
});

app.get('/api/databases', async (_req, res) => {
  const [sndh, amiga, cpc, c64, uade] = await Promise.all([
    localSndhStats(),
    localAmigaStats(),
    localCpcStats(),
    localC64Stats(),
    isUadeAvailable(),
  ]);
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
        ? uade
          ? 'Local UnExoticA music — MOD via openmpt, exotic formats via UADE.'
          : 'Local UnExoticA music — MOD via openmpt. Install UADE (brew install uade) for CUST/MDAT/RJP/…'
        : 'Place UnExoticA extracts in data/amiga/unexotica (see scripts/fetch-unexotica.py).',
      platform: 'amiga',
      url: 'https://www.exotica.org.uk/wiki/UnExoticA',
      connected: amiga.connected,
      requiresKey: false,
      stats: amiga.connected
        ? `${amiga.count.toLocaleString('en-US')} local Amiga modules${uade ? ' · UADE on' : ' · UADE off'}`
        : 'Archive missing',
    },
    {
      id: 'cpc',
      name: 'CPC Archive',
      description: cpc.connected
        ? 'Local Amstrad CPC YM2149: SNDH .snd (sndh.atari.org) plus game YM dumps (CPCMuseum / genesis8). Project AY .ay needs a CPC Z80 player.'
        : 'Place extracts under data/cpc/cpc_lf and data/cpc/ym_games to play Amstrad CPC chiptunes offline.',
      platform: 'cpc',
      url: 'https://sndh.atari.org/',
      connected: cpc.connected,
      requiresKey: false,
      stats: cpc.connected
        ? `${cpc.count.toLocaleString('en-US')} local CPC files`
        : 'Archive missing',
    },
    {
      id: 'c64',
      name: 'HVSC',
      description: c64.connected
        ? 'Local High Voltage SID Collection (HVSC) — Commodore 64 SID tunes from disk.'
        : 'Place an HVSC extract under data/c64/HVSC/C64Music to play SID tunes offline.',
      platform: 'c64',
      url: 'https://hvsc.c64.org/',
      connected: c64.connected,
      requiresKey: false,
      stats: c64.connected
        ? `${c64.count.toLocaleString('en-US')} local SID files`
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
      url: 'https://sndh.atari.org/',
      connected: true,
      requiresKey: false,
      stats: '2 demo tracks',
    },
  ];

  res.json({ databases });
});

function resolveSearchMachines(platform: MusicPlatform, machinesRaw: string): MachineId[] {
  const parsed = parseMachineList(machinesRaw) ?? [...MACHINE_IDS];
  if (platform === 'all') return parsed;
  return [platform];
}

function includesSearchMachine(
  platform: MusicPlatform,
  machines: readonly MachineId[],
  id: MachineId,
): boolean {
  if (platform === id) return true;
  if (platform === 'all') return machines.includes(id);
  return false;
}

app.get('/api/insights', async (req, res) => {
  const platformRaw = String(req.query.platform ?? 'all');
  const platform = (isMusicPlatform(platformRaw) ? platformRaw : '') as MusicPlatform | '';
  if (!platform) {
    res.status(400).json({ error: 'Invalid platform' });
    return;
  }

  try {
    const machines = resolveSearchMachines(platform, String(req.query.machines ?? ''));
    const insights = await buildInsights(platform, machines);
    res.json(insights);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Insights failed' });
  }
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const platformRaw = String(req.query.platform ?? 'all');
  const platform = (isMusicPlatform(platformRaw) ? platformRaw : 'all') as MusicPlatform;
  const field = (String(req.query.field ?? 'any') as SearchField) || 'any';
  const playableOnly = String(req.query.playable ?? '1') !== '0';
  const machines = resolveSearchMachines(platform, String(req.query.machines ?? ''));

  try {
    const tasks: Promise<Track[]>[] = [];

    if (includesSearchMachine(platform, machines, 'atari')) {
      tasks.push(Promise.resolve(searchLocalCatalog(query, platform, field)));
      tasks.push(searchSndh(query, field));
    }
    if (includesSearchMachine(platform, machines, 'amiga')) {
      tasks.push(searchAmiga(query, field, playableOnly));
    }
    if (includesSearchMachine(platform, machines, 'cpc')) {
      tasks.push(searchCpc(query, field));
    }
    if (includesSearchMachine(platform, machines, 'c64')) {
      tasks.push(searchC64(query, field));
    }

    const resultSets = await Promise.allSettled(tasks);
    const tracks = resultSets.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

    const unique = new Map<string, (typeof tracks)[number]>();
    for (const track of tracks) {
      unique.set(`${track.source}:${track.id}`, track);
    }
    const covered = await attachGameCovers(Array.from(unique.values()));

    const [sndh, amiga, cpc, c64] = await Promise.all([
      localSndhStats(),
      localAmigaStats(),
      localCpcStats(),
      localC64Stats(),
    ]);
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
        cpc: {
          connected: cpc.connected,
          message: cpc.connected
            ? `Local CPC archive (${cpc.count.toLocaleString('en-US')} files)`
            : 'No local CPC dump — add cpc_lf / ym_games under data/cpc',
        },
        c64: {
          connected: c64.connected,
          message: c64.connected
            ? `Local HVSC archive (${c64.count.toLocaleString('en-US')} SID files)`
            : 'No local HVSC dump — add C64Music under data/c64/HVSC',
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

app.post('/api/track/:source/:id/duration', async (req, res) => {
  const { source, id } = req.params;
  const seconds = Number(req.body?.seconds);
  if (source !== 'amiga') {
    res.status(400).json({ error: 'Duration cache is only supported for Amiga tracks' });
    return;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    res.status(400).json({ error: 'Invalid duration' });
    return;
  }

  try {
    const track = await setAmigaTrackDuration(id, seconds);
    if (!track) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    res.json(track);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Duration save failed' });
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

    if (source === 'cpc') {
      const localPath = await resolveCpcFilePath(id);
      if (!localPath) {
        res.status(404).json({ error: 'CPC track not found' });
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.sendFile(localPath);
      return;
    }

    if (source === 'c64') {
      const localPath = await resolveC64FilePath(id);
      if (!localPath) {
        res.status(404).json({ error: 'C64 track not found' });
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Playback-Engine', 'sid');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.sendFile(localPath);
      return;
    }

    if (source === 'amiga') {
      const localPath = await resolveAmigaFilePath(id);
      if (!localPath) {
        res.status(404).json({ error: 'Amiga track not found' });
        return;
      }

      const track = await getAmigaTrack(id);
      const format = track?.format ?? '';
      const forceRaw = String(req.query.raw ?? '') === '1';
      const wantUade = !forceRaw && shouldUseUade(format) && (await isUadeAvailable());

      if (wantUade) {
        try {
          const wavPath = await renderAmigaWithUade(localPath);
          const duration = await wavDurationSeconds(wavPath);
          if (duration) {
            void setAmigaTrackDuration(id, duration);
          }
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('X-Playback-Engine', 'uade');
          if (duration) res.setHeader('X-Duration-Seconds', String(Math.round(duration * 10) / 10));
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.sendFile(wavPath);
          return;
        } catch (error) {
          console.warn(
            '[uade]',
            track?.title ?? id,
            error instanceof Error ? error.message : error,
          );
          res.status(415).json({
            error: error instanceof Error ? error.message : 'UADE could not render this module',
          });
          return;
        }
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Playback-Engine', 'openmpt');
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

const [sndhIndex, amigaIndex, cpcIndex, c64Index, uade] = await Promise.all([
  loadSndhIndex(),
  loadAmigaIndex(),
  loadCpcIndex(),
  loadC64Index(),
  isUadeAvailable(),
]);
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
  console.log(
    cpcIndex.length > 0
      ? `Local CPC archive: ${cpcIndex.length.toLocaleString('en-US')} files`
      : 'No local CPC archive — add cpc_lf and/or ym_games under data/cpc',
  );
  console.log(
    c64Index.length > 0
      ? `Local HVSC archive: ${c64Index.length.toLocaleString('en-US')} SID files`
      : 'No local HVSC archive — extract HVSC into data/c64/HVSC/C64Music',
  );
  console.log(uade ? 'UADE: available (exotic Amiga formats)' : 'UADE: not found — brew install uade');
});
