import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** App install root (repo or `.app/Contents/Resources/app`). */
export const PROJECT_ROOT = process.env.RETRO_MUSIC_ROOT
  ? path.resolve(process.env.RETRO_MUSIC_ROOT)
  : path.resolve(__dirname, '..');

/**
 * Music dumps, UADE cache, etc.
 * Desktop .app defaults this to ~/Library/Application Support/…/data
 * via RETRO_MUSIC_DATA_DIR so rebuilds do not wipe archives.
 */
export const DATA_ROOT = process.env.RETRO_MUSIC_DATA_DIR
  ? path.resolve(process.env.RETRO_MUSIC_DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');

export function dataPath(...parts: string[]): string {
  return path.join(DATA_ROOT, ...parts);
}
