import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type StoredPrefs = {
  machines?: unknown;
  audioFx?: unknown;
  bookmarks?: unknown;
  libraryFilters?: unknown;
  visualizer?: unknown;
};

function prefsFilePath(): string {
  const override = process.env.RETRO_MUSIC_PREFS_PATH?.trim();
  if (override) return path.resolve(override);

  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Retro Music Player',
      'prefs.json',
    );
  }
  return path.join(os.homedir(), '.config', 'retro-music-player', 'prefs.json');
}

export async function readPrefs(): Promise<StoredPrefs> {
  const file = prefsFilePath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as StoredPrefs;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    if (err instanceof SyntaxError) {
      console.warn('[prefs] ignoring corrupt prefs file:', err.message);
      return {};
    }
    throw err;
  }
}

export async function writePrefs(patch: StoredPrefs): Promise<StoredPrefs> {
  const file = prefsFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const current = await readPrefs();
  const next: StoredPrefs = { ...current };
  if ('machines' in patch) next.machines = patch.machines;
  if ('audioFx' in patch) next.audioFx = patch.audioFx;
  if ('bookmarks' in patch) next.bookmarks = patch.bookmarks;
  if ('libraryFilters' in patch) next.libraryFilters = patch.libraryFilters;
  if ('visualizer' in patch) next.visualizer = patch.visualizer;
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
