export interface TrackerCell {
  note: string;
  instrument: string;
  effect: string;
  hasNote: boolean;
  empty: boolean;
}

export interface TrackerPattern {
  name: string;
  rows: number[][][];
}

export interface TrackerSong {
  channels: string[];
  patterns: TrackerPattern[];
  orders: Array<{ name: string; pat: number }>;
}

export interface TrackerPlayback {
  order: number;
  pattern: number;
  row: number;
}

export interface TrackerViewRow {
  rowIndex: number;
  cells: TrackerCell[];
  isCurrent: boolean;
  isBeat: boolean;
  distance: number;
  outside: boolean;
}

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
const EFFECT_CHARS = '0123456789ABCDEF';
const WINDOW_SIZE = 22;
const MAX_CHANNELS = 8;
const NOTE_FADE = 253;
const NOTE_CUT = 254;
const NOTE_OFF = 255;

function formatNote(value: number): string {
  if (!value) return '...';
  if (value === NOTE_FADE) return '~~~';
  if (value === NOTE_CUT) return '^^^';
  if (value === NOTE_OFF) return '===';
  if (value < 1 || value > 120) return '...';
  const index = value - 1;
  const octave = Math.floor(index / 12);
  const name = NOTE_NAMES[index % 12] ?? 'C-';
  return `${name}${octave}`;
}

function formatInstrument(value: number): string {
  if (!value) return '..';
  return value.toString(16).toUpperCase().padStart(2, '0');
}

function formatEffect(effect: number, parameter: number): string {
  if (!effect && !parameter) return '...';
  const letter = EFFECT_CHARS[effect & 0x0f] ?? '0';
  return `${letter}${parameter.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function formatHex(value: number, width = 2): string {
  return Math.max(0, value).toString(16).toUpperCase().padStart(width, '0');
}

export function trackerChannelLabel(name: string | undefined, index: number): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed) return trimmed.slice(0, 10).toUpperCase();
  return `CH ${String(index + 1).padStart(2, '0')}`;
}

export function formatTrackerCell(commands: number[]): TrackerCell {
  const [note = 0, instrument = 0, , effect = 0, , parameter = 0] = commands;
  const formattedNote = formatNote(note);
  const formattedInstrument = formatInstrument(instrument);
  const formattedEffect = formatEffect(effect, parameter);
  return {
    note: formattedNote,
    instrument: formattedInstrument,
    effect: formattedEffect,
    hasNote: formattedNote !== '...',
    empty: formattedNote === '...' && formattedInstrument === '..' && formattedEffect === '...',
  };
}

export function buildTrackerRows(
  song: TrackerSong | null,
  playback: TrackerPlayback | null,
  windowSize = WINDOW_SIZE,
): {
  rows: TrackerViewRow[];
  channelCount: number;
  totalChannels: number;
  channelNames: string[];
  patternName: string;
  patternLength: number;
  activeChannels: boolean[];
} {
  const empty = {
    rows: [] as TrackerViewRow[],
    channelCount: 4,
    totalChannels: 0,
    channelNames: [] as string[],
    patternName: '',
    patternLength: 0,
    activeChannels: [] as boolean[],
  };

  if (!song || !playback || !song.patterns[playback.pattern]) {
    return empty;
  }

  const pattern = song.patterns[playback.pattern];
  const totalChannels = song.channels.length || 4;
  const channelCount = Math.min(totalChannels, MAX_CHANNELS);
  const currentRow = playback.row;
  const radius = Math.floor(windowSize / 2);
  const emptyCell: TrackerCell = {
    note: '...',
    instrument: '..',
    effect: '...',
    hasNote: false,
    empty: true,
  };

  const currentRaw = pattern.rows[currentRow] ?? [];
  const activeChannels = Array.from({ length: channelCount }, (_, channelIndex) => {
    const commands = currentRaw[channelIndex] ?? [];
    return formatTrackerCell(commands).hasNote;
  });

  const channelNames = Array.from({ length: channelCount }, (_, index) =>
    trackerChannelLabel(song.channels[index], index),
  );

  const rows: TrackerViewRow[] = [];
  for (let rowIndex = currentRow - radius; rowIndex <= currentRow + radius; rowIndex += 1) {
    const outside = rowIndex < 0 || rowIndex >= pattern.rows.length;
    const rawRow = outside ? [] : (pattern.rows[rowIndex] ?? []);
    const cells = Array.from({ length: channelCount }, (_, channelIndex) => {
      if (outside) return emptyCell;
      const commands = rawRow[channelIndex] ?? [];
      return formatTrackerCell(commands);
    });
    rows.push({
      rowIndex,
      cells,
      isCurrent: rowIndex === currentRow,
      isBeat: !outside && rowIndex % 4 === 0,
      distance: Math.abs(rowIndex - currentRow),
      outside,
    });
  }

  return {
    rows,
    channelCount,
    totalChannels,
    channelNames,
    patternName: pattern.name?.trim() ?? '',
    patternLength: pattern.rows.length,
    activeChannels,
  };
}
