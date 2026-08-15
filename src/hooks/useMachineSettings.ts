import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_MACHINE_SETTINGS,
  MACHINE_IDS,
  type MachineId,
  type MachineSettings,
  isMachineId,
} from '../utils/machines';
import { hydrateClientPrefs, persistPrefsPatch } from '../lib/clientPrefs';

const STORAGE_KEY = 'retro-music-player.machines';

function parseMachines(raw: unknown): MachineSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const next = { ...DEFAULT_MACHINE_SETTINGS };
  for (const id of MACHINE_IDS) {
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value === 'boolean') next[id] = value;
  }
  if (!MACHINE_IDS.some((id) => next[id])) return null;
  return next;
}

function loadSettings(): MachineSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MACHINE_SETTINGS };
    return parseMachines(JSON.parse(raw) as unknown) ?? { ...DEFAULT_MACHINE_SETTINGS };
  } catch {
    return { ...DEFAULT_MACHINE_SETTINGS };
  }
}

function writeLocal(settings: MachineSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function persist(settings: MachineSettings): void {
  writeLocal(settings);
  persistPrefsPatch({ machines: settings });
}

export function useMachineSettings() {
  const [machines, setMachines] = useState<MachineSettings>(loadSettings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateClientPrefs().then((prefs) => {
      if (cancelled) return;
      const fromDisk = parseMachines(prefs.machines);
      if (fromDisk) {
        writeLocal(fromDisk);
        setMachines(fromDisk);
      } else {
        persist(loadSettings());
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    persist(machines);
  }, [machines, ready]);

  const setMachineEnabled = useCallback((id: MachineId, enabled: boolean) => {
    if (!isMachineId(id)) return;
    setMachines((prev) => {
      if (prev[id] === enabled) return prev;
      const next = { ...prev, [id]: enabled };
      if (!MACHINE_IDS.some((machine) => next[machine])) {
        return prev;
      }
      return next;
    });
  }, []);

  const toggleMachine = useCallback((id: MachineId) => {
    setMachines((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!MACHINE_IDS.some((machine) => next[machine])) {
        return prev;
      }
      return next;
    });
  }, []);

  const enableAll = useCallback(() => {
    setMachines({ ...DEFAULT_MACHINE_SETTINGS });
  }, []);

  return { machines, setMachineEnabled, toggleMachine, enableAll };
}
