import type { Track } from '../types';

/** Formats libopenmpt / chiptune3 can actually decode. */
const OPENMPT_FORMATS = new Set([
  '669',
  'AMF',
  'DBM',
  'DIGI',
  'DSM',
  'DTM',
  'FAR',
  'IT',
  'M15',
  'MED',
  'MMD',
  'MMD0',
  'MMD1',
  'MMD2',
  'MMD3',
  'MMDC',
  'MO3',
  'MOD',
  'MPTM',
  'MTM',
  'NP',
  'NP1',
  'NP2',
  'NP3',
  'NST',
  'OKT',
  'P31',
  'P40',
  'P41',
  'P4X',
  'P5X',
  'P60',
  'P61',
  'P81',
  'PM',
  'PM01',
  'PM10',
  'PM20',
  'PP',
  'PP10',
  'PP20',
  'PP21',
  'PP30',
  'PRU',
  'PRU1',
  'PRU2',
  'PTM',
  'S3M',
  'SFX',
  'SFX13',
  'SFX20',
  'STK',
  'STM',
  'ULT',
  'WOW',
  'XM',
]);

export function isOpenmptFormat(format: string): boolean {
  return OPENMPT_FORMATS.has(format.trim().toUpperCase());
}

/** @deprecated Prefer isOpenmptFormat; kept for call sites during hybrid UADE rollout. */
export function isAmigaFormatPlayable(format: string, uadeAvailable = false): boolean {
  if (isOpenmptFormat(format)) return true;
  return uadeAvailable;
}

export function isTrackPlayable(track: Track, uadeAvailable = false): boolean {
  if (track.platform !== 'amiga') return true;
  return isAmigaFormatPlayable(track.format, uadeAvailable);
}
