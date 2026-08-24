import { absoluteStreamUrl } from '../api';
import type { Track } from '../types';

function sanitizeFilenamePart(part: string): string {
  return (
    part
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'track'
  );
}

function extensionForTrack(track: Track): string {
  const fmt = track.format.trim().replace(/^\./, '').toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(fmt)) return fmt;
  switch (track.source) {
    case 'sndh':
      return 'sndh';
    case 'c64':
      return 'sid';
    case 'cpc':
      return 'snd';
    case 'amiga':
      return 'mod';
    case 'local':
      return 'sndh';
    case 'vgm':
      return 'vgm';
    default: {
      const _exhaustive: never = track.source;
      return _exhaustive;
    }
  }
}

export function trackDownloadFilename(track: Track): string {
  const base = sanitizeFilenamePart(`${track.artist} - ${track.title}`);
  return `${base}.${extensionForTrack(track)}`;
}

/** Original chip/module file via the stream API (`?raw=1` where applicable). */
export function trackDownloadUrl(track: Track): string {
  const url = new URL(absoluteStreamUrl(track.streamUrl), window.location.origin);
  if (track.source === 'sndh' || track.source === 'amiga' || track.source === 'local' || track.source === 'vgm') {
    url.searchParams.set('raw', '1');
  }
  url.searchParams.set('download', '1');
  url.searchParams.set('filename', trackDownloadFilename(track));
  return `${url.pathname}${url.search}`;
}

async function pywebviewApi(): Promise<PywebviewApi | null> {
  if (window.pywebview?.api?.download_file) {
    return window.pywebview.api;
  }
  if (!('pywebview' in window)) return null;
  return new Promise((resolve) => {
    window.addEventListener(
      'pywebviewready',
      () => {
        resolve(window.pywebview?.api ?? null);
      },
      { once: true },
    );
  });
}

function triggerBrowserDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function downloadTrack(track: Track): Promise<void> {
  const url = trackDownloadUrl(track);
  const filename = trackDownloadFilename(track);
  const api = await pywebviewApi();

  if (api?.download_file) {
    const result = await api.download_file(url, filename);
    if (result.cancelled) return;
    if (!result.ok) {
      throw new Error(result.error ?? 'Download failed');
    }
    return;
  }

  triggerBrowserDownload(url, filename);
}
