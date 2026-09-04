/** Thin HTTP client for the MiniToo now-playing bridge (Python `minitoo.bridge`). */

export const DEFAULT_MINITOO_BRIDGE_URL = 'http://127.0.0.1:8766';

export type MiniTooNowPlayingPayload = {
  title: string;
  artist?: string;
  game?: string | null;
  platform?: string | null;
  format?: string | null;
  status?: string;
  position?: number | null;
  duration?: number | null;
  force?: boolean;
};

export type MiniTooHealth = {
  ok: boolean;
  daemon: boolean;
  daemon_host?: string;
  daemon_port?: number;
};

export type MiniTooPushResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  fingerprint?: string;
};

function bridgeBase(): string {
  const fromEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_MINITOO_BRIDGE_URL;
  return (fromEnv?.trim() || DEFAULT_MINITOO_BRIDGE_URL).replace(/\/$/, '');
}

export async function fetchMiniTooHealth(signal?: AbortSignal): Promise<MiniTooHealth | null> {
  try {
    const res = await fetch(`${bridgeBase()}/v1/health`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as MiniTooHealth;
  } catch {
    return null;
  }
}

export async function pushMiniTooNowPlaying(
  payload: MiniTooNowPlayingPayload,
  signal?: AbortSignal,
): Promise<MiniTooPushResult> {
  try {
    const res = await fetch(`${bridgeBase()}/v1/now-playing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    const data = (await res.json()) as MiniTooPushResult;
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
