export type MachineId = 'atari' | 'amiga' | 'cpc' | 'c64';

export const MACHINE_IDS: readonly MachineId[] = ['atari', 'amiga', 'cpc', 'c64'] as const;

export const MACHINE_LABELS: Record<MachineId, string> = {
  atari: 'Atari ST',
  amiga: 'Amiga',
  cpc: 'Amstrad CPC',
  c64: 'Commodore 64',
};

export const MACHINE_BLURBS: Record<MachineId, string> = {
  atari: 'SNDH YM2149 chiptunes',
  amiga: 'UnExoticA modules (MOD, MDAT, CUST…)',
  cpc: 'CPC AY/YM dumps (SNDH + YM)',
  c64: 'HVSC SID collection',
};

export type MachineSettings = Record<MachineId, boolean>;

export const DEFAULT_MACHINE_SETTINGS: MachineSettings = {
  atari: true,
  amiga: true,
  cpc: true,
  c64: true,
};

export function isMachineId(value: string): value is MachineId {
  return (MACHINE_IDS as readonly string[]).includes(value);
}

export function enabledMachines(settings: MachineSettings): MachineId[] {
  return MACHINE_IDS.filter((id) => settings[id]);
}

export function parseMachineList(raw: string | null | undefined): MachineId[] | null {
  if (raw == null || raw.trim() === '') return null;
  const parsed = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(isMachineId);
  return parsed.length > 0 ? [...new Set(parsed)] : null;
}

export function machinesQueryValue(settings: MachineSettings): string {
  return enabledMachines(settings).join(',');
}
