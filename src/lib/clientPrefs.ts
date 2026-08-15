import { fetchPrefs, putPrefs, type ClientPrefsPayload } from '../api';

let hydratePromise: Promise<ClientPrefsPayload> | null = null;

/** Load durable prefs once (disk via API), then merge into localStorage callers. */
export function hydrateClientPrefs(): Promise<ClientPrefsPayload> {
  if (!hydratePromise) {
    hydratePromise = fetchPrefs().catch(() => ({}));
  }
  return hydratePromise;
}

export function persistPrefsPatch(patch: ClientPrefsPayload): void {
  void putPrefs(patch).catch(() => undefined);
}
