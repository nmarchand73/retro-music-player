import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_MACHINE_SETTINGS,
  MACHINE_IDS,
  type MachineId,
  type MachineSettings,
  isMachineId,
} from '../utils/machines';

const STORAGE_KEY = 'retro-music-player.machines';

function loadSettings(): MachineSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MACHINE_SETTINGS };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_MACHINE_SETTINGS };
    const next = { ...DEFAULT_MACHINE_SETTINGS };
    for (const id of MACHINE_IDS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === 'boolean') next[id] = value;
    }
    if (!MACHINE_IDS.some((id) => next[id])) return { ...DEFAULT_MACHINE_SETTINGS };
    return next;
  } catch {
    return { ...DEFAULT_MACHINE_SETTINGS };
  }
}

function persist(settings: MachineSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useMachineSettings() {
  const [machines, setMachines] = useState<MachineSettings>(loadSettings);

  useEffect(() => {
    persist(machines);
  }, [machines]);

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
