import type { TrackSource } from '../types';
import type { MachineId } from '../utils/machines';

/** Stable library refs used as FX listening samples (one per machine). */
export interface FxPreviewRef {
  machine: MachineId;
  source: TrackSource;
  id: string;
}

export const FX_PREVIEW_REFS: readonly FxPreviewRef[] = [
  {
    machine: 'atari',
    source: 'sndh',
    id: 'TWFkX01heC9MYXN0X05pbmphLnNuZGg', // Mad Max — Last Ninja
  },
  {
    machine: 'amiga',
    source: 'amiga',
    id: 'dW5leG90aWNhL0dhbWUvSm9zZXBoX1JpY2hhcmQvQ2hhb3NfRW5naW5lL0NoYW9zX0VuZ2luZS9tb2Quazg', // Chaos Engine · k8
  },
  {
    machine: 'cpc',
    source: 'cpc',
    id: 'eW1fZ2FtZXMvY3BjbXVzZXVtL0pldXgvUm9ib2NvcC55bQ', // Robocop YM
  },
  {
    machine: 'c64',
    source: 'c64',
    id: 'TVVTSUNJQU5TL0gvSHViYmFyZF9Sb2IvQ29tbWFuZG8uc2lk', // Rob Hubbard — Commando
  },
  {
    machine: 'arcade',
    source: 'vgm',
    id: 'QXJjYWRlL1NlZ2FTeXMvT3V0X1J1bl8oQXJjYWRlKS8wMSBNYWdpY2FsIFNvdW5kIFNob3dlci52Z3o', // Out Run — Magical Sound Shower
  },
] as const;
