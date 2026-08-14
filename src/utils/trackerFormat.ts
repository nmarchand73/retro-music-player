export interface TrackerCell {
  note: string;
  instrument: string;
  effect: string;
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

const NOTE_NAMES = ['C-', 'C#-', 'D-', 'D#-', 'E-', 'F-', 'F#-', 'G-', 'G#-', 'A-', 'A#-', 'B-'];
const EFFECT_CHARS = '0123456789ABCDEF';

function formatNote(value: number): string {
  if (!value) return '...';
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

export function formatTrackerCell(commands: number[]): TrackerCell {
  const [note = 0, instrument = 0, , effect = 0, , parameter = 0] = commands;
  return {
    note: formatNote(note),
    instrument: formatInstrument(instrument),
    effect: formatEffect(effect, parameter),
  };
}

export function buildTrackerRows(
  song: TrackerSong | null,
  playback: TrackerPlayback | null,
  windowSize = 16,
): { rows: Array<{ rowIndex: number; cells: TrackerCell[]; isCurrent: boolean }>; channelCount: number } {
  if (!song || !playback || !song.patterns[playback.pattern]) {
    return { rows: [], channelCount: 4 };
  }

  const pattern = song.patterns[playback.pattern];
  const channelCount = Math.min(song.channels.length || 4, 4);
  const currentRow = playback.row;
  const start = Math.max(0, currentRow - Math.floor(windowSize / 2));
  const end = Math.min(pattern.rows.length, start + windowSize);

  const rows = [];
  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const rawRow = pattern.rows[rowIndex] ?? [];
    const cells = Array.from({ length: channelCount }, (_, channelIndex) => {
      const commands = rawRow[channelIndex] ?? [];
      return formatTrackerCell(commands);
    });
    rows.push({
      rowIndex,
      cells,
      isCurrent: rowIndex === currentRow,
    });
  }

  return { rows, channelCount };
}
