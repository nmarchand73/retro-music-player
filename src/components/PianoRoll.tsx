import { useEffect, useRef } from 'react';
import {
  openmptNoteToMidi,
  type TrackerPlayback,
  type TrackerSong,
} from '../utils/trackerFormat';

const MIDI_LO = 36; // C2
const MIDI_HI = 96; // C7
const KEY_COUNT = MIDI_HI - MIDI_LO + 1;
const KEYBOARD_RATIO = 0.16;
/** Playhead sits on the bottom edge of the roll — notes “hit” here when they sound. */
const PLAYHEAD_INSET = 3;
const HISTORY_MS = 4200;
const SPECTRAL_HOLD_MS = 90;
const TRACKER_ROWS_AHEAD = 26;
const TRACKER_ROWS_BEHIND = 6;
const DEFAULT_ROW_DURATION_SEC = 0.05;
const CHANNEL_COLORS = ['#e2185a', '#d43aa8', '#7b4ec4', '#3d9be8', '#f0a030', '#40c080', '#c060e0', '#e07050'];

interface PianoRollProps {
  analyser: AnalyserNode | null;
  playing: boolean;
  /** Seconds — used to interpolate tracker rows between openmpt updates. */
  playbackPosition?: number;
  trackerSong?: TrackerSong | null;
  trackerPlayback?: TrackerPlayback | null;
}

type SpectralNote = {
  midi: number;
  startMs: number;
  endMs: number | null;
  energy: number;
  lastSeenMs: number;
};

function isBlackKey(midi: number): boolean {
  const n = midi % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteEnergy(
  freqData: Uint8Array,
  sampleRate: number,
  midi: number,
): number {
  const nyquist = sampleRate / 2;
  const binHz = nyquist / Math.max(1, freqData.length - 1);
  const center = midiToHz(midi);
  const halfWidth = Math.max(binHz * 1.2, center * 0.03);
  const lo = Math.max(1, Math.floor((center - halfWidth) / binHz));
  const hi = Math.min(freqData.length - 1, Math.ceil((center + halfWidth) / binHz));
  let peak = 0;
  for (let i = lo; i <= hi; i += 1) {
    const v = freqData[i] ?? 0;
    if (v > peak) peak = v;
  }
  const gate = 28 + ((MIDI_HI - midi) / KEY_COUNT) * 18;
  if (peak < gate) return 0;
  return Math.min(1, Math.pow((peak - gate * 0.4) / 255, 1.05));
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, w, h);
}

function channelColor(channel: number, alpha = 1): string {
  const base = CHANNEL_COLORS[channel % CHANNEL_COLORS.length] ?? CHANNEL_COLORS[0]!;
  if (alpha >= 1) return base;
  const r = Number.parseInt(base.slice(1, 3), 16);
  const g = Number.parseInt(base.slice(3, 5), 16);
  const b = Number.parseInt(base.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  keyH: number,
  activeMidi: Set<number>,
): void {
  const top = height - keyH;
  const keyW = width / KEY_COUNT;
  ctx.fillStyle = '#120a1c';
  ctx.fillRect(0, top, width, keyH);

  for (let midi = MIDI_LO; midi <= MIDI_HI; midi += 1) {
    if (isBlackKey(midi)) continue;
    const x = (midi - MIDI_LO) * keyW;
    const on = activeMidi.has(midi);
    ctx.fillStyle = on ? '#fff0f6' : '#efe6f8';
    ctx.fillRect(x + 0.5, top + 1, keyW - 1, keyH - 2);
    ctx.strokeStyle = 'rgba(40, 20, 60, 0.35)';
    ctx.strokeRect(x + 0.5, top + 1, keyW - 1, keyH - 2);
    if (midi % 12 === 0) {
      ctx.fillStyle = 'rgba(60, 30, 90, 0.55)';
      ctx.font = `${Math.max(8, Math.floor(keyH * 0.28))}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`C${Math.floor(midi / 12) - 1}`, x + keyW / 2, height - 4);
    }
  }

  for (let midi = MIDI_LO; midi <= MIDI_HI; midi += 1) {
    if (!isBlackKey(midi)) continue;
    const x = (midi - MIDI_LO) * keyW;
    const on = activeMidi.has(midi);
    const bw = keyW * 0.62;
    ctx.fillStyle = on ? '#e2185a' : '#2a1838';
    ctx.fillRect(x + (keyW - bw) / 2, top + 1, bw, keyH * 0.58);
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  rollH: number,
): void {
  const keyW = width / KEY_COUNT;
  for (let midi = MIDI_LO; midi <= MIDI_HI; midi += 1) {
    const x = (midi - MIDI_LO) * keyW;
    if (midi % 12 === 0) {
      ctx.fillStyle = 'rgba(255, 248, 238, 0.045)';
      ctx.fillRect(x, 0, keyW, rollH);
    }
    if (isBlackKey(midi)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(x, 0, keyW, rollH);
    }
  }
}

export function PianoRoll({
  analyser,
  playing,
  playbackPosition = 0,
  trackerSong = null,
  trackerPlayback = null,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectralNotesRef = useRef<Map<number, SpectralNote>>(new Map());
  const trackerPlaybackRef = useRef(trackerPlayback);
  const playbackPositionRef = useRef(playbackPosition);
  const playingRef = useRef(playing);
  trackerPlaybackRef.current = trackerPlayback;
  playbackPositionRef.current = playbackPosition;
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const spectralNotes = spectralNotesRef.current;
    const freqData =
      analyser != null ? new Uint8Array(analyser.frequencyBinCount) : null;

    let lastTrackerRow = -1;
    let rowAnchorPos = 0;
    let rowAnchorTime = 0;
    let rowDurationSec = DEFAULT_ROW_DURATION_SEC;

    const effectiveTrackerRow = (now: number): number => {
      const playback = trackerPlaybackRef.current;
      if (!playback) return 0;
      const row = playback.row;
      const position = playbackPositionRef.current;

      if (row !== lastTrackerRow) {
        if (lastTrackerRow >= 0 && position > rowAnchorPos) {
          const rowDelta = row - lastTrackerRow;
          if (rowDelta > 0) {
            rowDurationSec = Math.max(0.012, (position - rowAnchorPos) / rowDelta);
          }
        }
        lastTrackerRow = row;
        rowAnchorPos = position;
        rowAnchorTime = now;
      }

      if (!playingRef.current) return row;
      const elapsedSec = (now - rowAnchorTime) / 1000;
      const frac = Math.min(0.98, elapsedSec / rowDurationSec);
      return row + frac;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const paintTracker = (
      now: number,
      width: number,
      playheadY: number,
      rollH: number,
      activeMidi: Set<number>,
    ) => {
      const song = trackerSong;
      const playback = trackerPlaybackRef.current;
      if (!song || !playback) return false;
      const pattern = song.patterns[playback.pattern];
      if (!pattern?.rows?.length) return false;

      const channelCount = Math.min(song.channels.length || 4, 8);
      const rowH = rollH / (TRACKER_ROWS_AHEAD + 1);
      const keyW = width / KEY_COUNT;
      const playRow = effectiveTrackerRow(now);

      const lookBehind = TRACKER_ROWS_BEHIND;
      const lookAhead = TRACKER_ROWS_AHEAD;
      const firstRow = Math.max(0, Math.floor(playRow) - lookBehind);
      const lastRow = Math.min(pattern.rows.length - 1, Math.ceil(playRow) + lookAhead);

      for (let row = firstRow; row <= lastRow; row += 1) {
        const raw = pattern.rows[row] ?? [];
        /** Bottom of the note bar: aligns with playhead when the row fires. */
        const noteBottom = playheadY + (playRow - row) * rowH;

        for (let ch = 0; ch < channelCount; ch += 1) {
          const commands = raw[ch] ?? [];
          const noteVal = commands[0] ?? 0;
          const midi = openmptNoteToMidi(noteVal);
          if (midi == null || midi < MIDI_LO || midi > MIDI_HI) continue;

          let hold = 1;
          for (let r = row + 1; r < pattern.rows.length && r <= row + 16; r += 1) {
            const next = (pattern.rows[r] ?? [])[ch] ?? [];
            const nextNote = next[0] ?? 0;
            if (nextNote) break;
            hold += 1;
          }

          const noteH = hold * rowH - 2;
          const noteTop = noteBottom - noteH;
          if (noteTop > rollH || noteBottom < 0) continue;

          const x = (midi - MIDI_LO) * keyW + 1;
          const delta = playRow - row;
          const current = delta >= 0 && delta < 1;
          const past = delta >= 1;
          const alpha = current ? 1 : past ? 0.35 : 0.82;
          ctx.fillStyle = channelColor(ch, alpha);
          fillRoundRect(
            ctx,
            x,
            Math.max(0, noteTop),
            Math.max(2, keyW - 2),
            Math.min(noteH, rollH - Math.max(0, noteTop)),
            Math.min(4, keyW * 0.25),
          );

          if (current) activeMidi.add(midi);
        }
      }

      return true;
    };

    const paintSpectral = (
      now: number,
      width: number,
      playheadY: number,
      rollH: number,
      activeMidi: Set<number>,
      pxPerMs: number,
    ) => {
      if (!analyser || !freqData) return;
      analyser.getByteFrequencyData(freqData);
      const sampleRate = analyser.context.sampleRate;
      const notes = spectralNotes;
      const keyW = width / KEY_COUNT;
      const isPlaying = playingRef.current;

      if (isPlaying) {
        for (let midi = MIDI_LO; midi <= MIDI_HI; midi += 1) {
          const energy = noteEnergy(freqData, sampleRate, midi);
          const existing = notes.get(midi);
          if (energy > 0.12) {
            if (!existing || existing.endMs != null) {
              notes.set(midi, {
                midi,
                startMs: now,
                endMs: null,
                energy,
                lastSeenMs: now,
              });
            } else {
              existing.energy = Math.max(existing.energy * 0.7, energy);
              existing.lastSeenMs = now;
            }
          } else if (existing && existing.endMs == null) {
            if (now - existing.lastSeenMs > SPECTRAL_HOLD_MS) {
              existing.endMs = now;
            }
          }
        }
      } else {
        for (const note of notes.values()) {
          if (note.endMs == null) note.endMs = now;
        }
      }

      for (const [midi, note] of [...notes.entries()]) {
        const end = note.endMs ?? now;
        if (now - end > HISTORY_MS) {
          notes.delete(midi);
          continue;
        }

        const durationMs = Math.max(40, end - note.startMs);
        const noteBottom = playheadY + (now - note.startMs) * pxPerMs;
        const noteH = Math.max(4, durationMs * pxPerMs);
        const noteTop = noteBottom - noteH;
        if (noteTop > rollH || noteBottom < 0) continue;

        const live = note.endMs == null;
        if (live) activeMidi.add(midi);
        const alpha = live ? 0.55 + note.energy * 0.45 : 0.28;
        const x = (midi - MIDI_LO) * keyW + 1;
        ctx.fillStyle = channelColor(midi % 12, alpha);
        fillRoundRect(
          ctx,
          x,
          Math.max(0, noteTop),
          Math.max(2, keyW - 2),
          Math.min(noteH, rollH - Math.max(0, noteTop)),
          Math.min(4, keyW * 0.25),
        );
      }
    };

    const frame = (now: number) => {
      resize();
      const width = canvas.width;
      const height = canvas.height;
      const keyH = Math.max(28, height * KEYBOARD_RATIO);
      const rollH = height - keyH;
      const playheadY = rollH - PLAYHEAD_INSET;

      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#160c24');
      bg.addColorStop(1, '#1c1230');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      drawGrid(ctx, width, rollH);

      const activeMidi = new Set<number>();
      const usedTracker = paintTracker(now, width, playheadY, rollH, activeMidi);
      if (!usedTracker) {
        const pxPerMs = rollH / HISTORY_MS;
        paintSpectral(now, width, playheadY, rollH, activeMidi, pxPerMs);
      }

      ctx.strokeStyle = 'rgba(255, 248, 238, 0.65)';
      ctx.lineWidth = Math.max(2, width * 0.0025);
      ctx.beginPath();
      ctx.moveTo(0, playheadY);
      ctx.lineTo(width, playheadY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(226, 24, 90, 0.22)';
      ctx.fillRect(0, playheadY - 5, width, 10);

      drawKeyboard(ctx, width, height, keyH, activeMidi);

      raf = window.requestAnimationFrame(frame);
    };

    raf = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(raf);
      spectralNotes.clear();
      lastTrackerRow = -1;
    };
  }, [analyser, playing, playbackPosition, trackerSong, trackerPlayback]);

  return (
    <div className="piano-roll" aria-label="Piano roll visualizer" role="img">
      <canvas ref={canvasRef} className="piano-roll-canvas" />
      <span className="piano-roll-badge">Piano roll</span>
    </div>
  );
}
