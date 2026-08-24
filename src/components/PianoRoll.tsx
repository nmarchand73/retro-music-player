import { useEffect, useRef } from 'react';
import {
  openmptNoteToMidi,
  type TrackerPlayback,
  type TrackerSong,
} from '../utils/trackerFormat';
import { detectChipPitches } from '../utils/pitchDetect';
import {
  blockBottomY,
  blockPhase,
  layoutWaterfall,
  pruneWaterfallBlocks,
  type WaterfallBlock,
  type WaterfallLayout,
} from '../utils/waterfallNotes';

const MIDI_LO = 36; // C2
const MIDI_HI = 96; // C7
const KEY_COUNT = MIDI_HI - MIDI_LO + 1;
const KEYBOARD_RATIO = 0.16;
const PITCH_GATE = 0.18;
const KEYBOARD_SPECTRUM_GATE = 0.07;
const PITCH_SAMPLE_MS = 1000 / 32;
/** Ignore brief pitch drop-outs so falling notes are not restarted mid-fall. */
const PITCH_RELEASE_HOLD_MS = 120;
const TRACKER_ROWS_AHEAD = 26;
const TRACKER_ROWS_BEHIND = 6;
const DEFAULT_ROW_DURATION_SEC = 0.05;
const CHANNEL_COLORS = ['#e2185a', '#d43aa8', '#7b4ec4', '#3d9be8', '#f0a030', '#40c080', '#c060e0', '#e07050'];

interface PianoRollProps {
  analyser: AnalyserNode | null;
  playing: boolean;
  playbackPosition?: number;
  trackerSong?: TrackerSong | null;
  trackerPlayback?: TrackerPlayback | null;
}

function spectrogramColor(midi: number, alpha: number, live: boolean): string {
  if (alpha <= 0) return 'transparent';
  const hue = 300 + ((midi - MIDI_LO) / KEY_COUNT) * 58;
  const sat = live ? 88 : 72;
  const light = live ? 48 + alpha * 22 : 36 + alpha * 18;
  return `hsla(${hue}, ${sat}%, ${light}%, ${Math.min(1, alpha * (live ? 1 : 0.72))})`;
}

function isBlackKey(midi: number): boolean {
  const n = midi % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
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

function readKeyboardFromSpectrum(analyser: AnalyserNode, freqBuf: Uint8Array): number[] {
  analyser.getByteFrequencyData(freqBuf as Uint8Array<ArrayBuffer>);
  const nyquist = analyser.context.sampleRate / 2;
  const binCount = freqBuf.length;
  let maxNorm = 0;
  const scratch = new Float32Array(KEY_COUNT);

  for (let i = 0; i < KEY_COUNT; i += 1) {
    const midi = MIDI_LO + i;
    const loHz = 440 * Math.pow(2, (midi - 0.58 - 69) / 12);
    const hiHz = 440 * Math.pow(2, (midi + 0.58 - 69) / 12);
    const lo = Math.max(0, Math.floor((loHz / nyquist) * binCount));
    const hi = Math.min(binCount - 1, Math.ceil((hiHz / nyquist) * binCount));
    let peak = 0;
    for (let b = lo; b <= hi; b += 1) peak = Math.max(peak, freqBuf[b] ?? 0);
    const norm = peak / 255;
    scratch[i] = norm;
    maxNorm = Math.max(maxNorm, norm);
  }

  const gate = Math.max(KEYBOARD_SPECTRUM_GATE, maxNorm * 0.42);
  const midis: number[] = [];
  for (let i = 0; i < KEY_COUNT; i += 1) {
    if (scratch[i]! >= gate) midis.push(MIDI_LO + i);
  }
  return midis;
}

function syncKeyboardLights(
  activeMidi: Set<number>,
  nowMs: number,
  rollH: number,
  blocks: WaterfallBlock[],
  liveMidis: Map<number, WaterfallBlock>,
  analyser: AnalyserNode | null,
  playing: boolean,
  freqBuf: Uint8Array | null,
): void {
  for (const midi of liveMidis.keys()) activeMidi.add(midi);

  const layout = layoutWaterfall(rollH);
  for (const block of blocks) {
    const bottom = blockBottomY(block, nowMs, layout);
    const phase = blockPhase(block, nowMs, layout);
    if (phase === 'live') {
      activeMidi.add(block.midi);
      continue;
    }
    if (phase === 'falling' && bottom >= layout.playheadY - layout.rowH * 1.5) {
      activeMidi.add(block.midi);
    }
  }

  if (analyser && freqBuf && playing) {
    for (const midi of readKeyboardFromSpectrum(analyser, freqBuf)) activeMidi.add(midi);
  }
}

function readActivePitches(
  timeDomain: Float32Array,
  sampleRate: number,
): { midi: number; clarity: number }[] {
  const hits = detectChipPitches(timeDomain, sampleRate, 4, MIDI_LO, MIDI_HI);
  if (hits.length === 0) return [];

  let maxClarity = 0;
  for (const hit of hits) maxClarity = Math.max(maxClarity, hit.clarity);
  const gate = Math.max(PITCH_GATE, maxClarity - 0.18);

  return hits
    .filter((hit) => hit.clarity >= gate)
    .map((hit) => ({
      midi: hit.midi,
      clarity: Math.min(1, hit.clarity / Math.max(gate, 0.01)),
    }));
}

function drawScrollingGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  playheadY: number,
  nowMs: number,
  layout: WaterfallLayout,
): void {
  const spacing = layout.rowH;
  const offset = (nowMs % layout.fallMs) * layout.pxPerMs;
  ctx.strokeStyle = 'rgba(255, 248, 238, 0.06)';
  ctx.lineWidth = 1;
  for (let y = playheadY - offset; y > -spacing; y -= spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawWaterfallBlock(
  ctx: CanvasRenderingContext2D,
  block: WaterfallBlock,
  nowMs: number,
  layout: WaterfallLayout,
  keyW: number,
  rollH: number,
  activeMidi: Set<number>,
): void {
  const phase = blockPhase(block, nowMs, layout);
  const noteBottom = blockBottomY(block, nowMs, layout);
  const minH = layout.rowH * 0.65;
  let noteH = minH;

  if (phase === 'live') {
    const heldMs = Math.max(0, (block.releaseMs ?? nowMs) - (block.spawnMs + layout.fallMs));
    noteH = Math.max(minH, Math.min(layout.rowH * 8, heldMs * layout.pxPerMs + minH));
    activeMidi.add(block.midi);
  } else if (phase === 'past') {
    noteH = minH * 0.85;
  }

  const noteTop = noteBottom - noteH;
  if (noteTop > rollH + layout.rowH || noteBottom < -layout.rowH) return;

  const x = (block.midi - MIDI_LO) * keyW + 1;
  const alpha =
    phase === 'live'
      ? 0.58 + block.energy * 0.42
      : phase === 'falling'
        ? 0.42 + block.energy * 0.45
        : 0.18;
  ctx.fillStyle = spectrogramColor(block.midi, alpha, phase === 'live');
  fillRoundRect(
    ctx,
    x,
    Math.max(0, noteTop),
    Math.max(2, keyW - 2),
    Math.min(noteH, rollH - Math.max(0, noteTop)),
    Math.min(4, keyW * 0.25),
  );
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
    if (on) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 0.5, top + 1, keyW - 1, keyH - 2);
      ctx.strokeStyle = 'rgba(226, 24, 90, 0.85)';
      ctx.lineWidth = Math.max(1.5, keyW * 0.08);
    } else {
      ctx.fillStyle = '#efe6f8';
      ctx.fillRect(x + 0.5, top + 1, keyW - 1, keyH - 2);
      ctx.strokeStyle = 'rgba(40, 20, 60, 0.35)';
      ctx.lineWidth = 1;
    }
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
    ctx.fillStyle = on ? '#ff2d75' : '#2a1838';
    ctx.fillRect(x + (keyW - bw) / 2, top + 1, bw, keyH * 0.58);
    if (on) {
      ctx.strokeStyle = 'rgba(255, 240, 246, 0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + (keyW - bw) / 2, top + 1, bw, keyH * 0.58);
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, rollH: number): void {
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
  const waterfallBlocksRef = useRef<WaterfallBlock[]>([]);
  const liveMidisRef = useRef<Map<number, WaterfallBlock>>(new Map());
  const pendingReleaseRef = useRef<Map<number, number>>(new Map());
  const prevClarityRef = useRef<Map<number, number>>(new Map());
  const lastPitchSampleMsRef = useRef(0);
  const analyserRef = useRef(analyser);
  const trackerSongRef = useRef(trackerSong);
  const trackerPlaybackRef = useRef(trackerPlayback);
  const playbackPositionRef = useRef(playbackPosition);
  const playingRef = useRef(playing);
  analyserRef.current = analyser;
  trackerSongRef.current = trackerSong;
  trackerPlaybackRef.current = trackerPlayback;
  playbackPositionRef.current = playbackPosition;
  playingRef.current = playing;

  /** Clear pitch blocks when the track or analyser changes (not every progress tick). */
  useEffect(() => {
    waterfallBlocksRef.current.length = 0;
    liveMidisRef.current.clear();
    pendingReleaseRef.current.clear();
    prevClarityRef.current.clear();
    lastPitchSampleMsRef.current = 0;
  }, [analyser, trackerSong]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const blocks = waterfallBlocksRef.current;
    const liveMidis = liveMidisRef.current;
    const pendingRelease = pendingReleaseRef.current;
    const prevClarity = prevClarityRef.current;
    let timeDomain: Float32Array<ArrayBuffer> | null = null;
    let freqBuffer: Uint8Array | null = null;

    const ensureFreqBuffer = (): Uint8Array | null => {
      const node = analyserRef.current;
      if (!node) return null;
      if (!freqBuffer || freqBuffer.length !== node.frequencyBinCount) {
        node.fftSize = 8192;
        node.smoothingTimeConstant = 0.35;
        freqBuffer = new Uint8Array(node.frequencyBinCount);
      }
      return freqBuffer;
    };

    const ensureTimeDomain = (): Float32Array<ArrayBuffer> | null => {
      const node = analyserRef.current;
      if (!node) return null;
      if (!timeDomain || timeDomain.length !== node.fftSize) {
        node.fftSize = 8192;
        node.smoothingTimeConstant = 0.35;
        timeDomain = new Float32Array(
          new ArrayBuffer(node.fftSize * Float32Array.BYTES_PER_ELEMENT),
        );
      }
      return timeDomain;
    };

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
      rollH: number,
      activeMidi: Set<number>,
    ) => {
      const song = trackerSongRef.current;
      const playback = trackerPlaybackRef.current;
      if (!song || !playback) return false;
      const pattern = song.patterns[playback.pattern];
      if (!pattern?.rows?.length) return false;

      const channelCount = Math.min(song.channels.length || 4, 8);
      const rowH = rollH / (TRACKER_ROWS_AHEAD + TRACKER_ROWS_BEHIND + 1);
      const keyW = width / KEY_COUNT;
      const playRow = effectiveTrackerRow(now);
      const layout = layoutWaterfall(rollH);
      const playheadLine = layout.playheadY;

      drawScrollingGrid(ctx, width, playheadLine, now, layout);

      const lookBehind = TRACKER_ROWS_BEHIND;
      const lookAhead = TRACKER_ROWS_AHEAD;
      const firstRow = Math.max(0, Math.floor(playRow) - lookBehind);
      const lastRow = Math.min(pattern.rows.length - 1, Math.ceil(playRow) + lookAhead);

      for (let row = firstRow; row <= lastRow; row += 1) {
        const raw = pattern.rows[row] ?? [];
        const noteBottom = playheadLine + (playRow - row) * rowH;

        for (let ch = 0; ch < channelCount; ch += 1) {
          const commands = raw[ch] ?? [];
          const noteVal = commands[0] ?? 0;
          const midi = openmptNoteToMidi(noteVal);
          if (midi == null || midi < MIDI_LO || midi > MIDI_HI) continue;

          let hold = 1;
          for (let r = row + 1; r < pattern.rows.length && r <= row + 16; r += 1) {
            const next = (pattern.rows[r] ?? [])[ch] ?? [];
            if (next[0]) break;
            hold += 1;
          }

          const noteH = hold * rowH - 2;
          const noteTop = noteBottom - noteH;
          if (noteTop > rollH || noteBottom < 0) continue;

          const x = (midi - MIDI_LO) * keyW + 1;
          const delta = playRow - row;
          const atPlayhead = delta >= -0.08 && delta < 1.15;
          const past = delta >= 1.15;
          const alpha = atPlayhead ? 1 : past ? 0.35 : 0.82;
          ctx.fillStyle = channelColor(ch, alpha);
          fillRoundRect(
            ctx,
            x,
            Math.max(0, noteTop),
            Math.max(2, keyW - 2),
            Math.min(noteH, rollH - Math.max(0, noteTop)),
            Math.min(4, keyW * 0.25),
          );

          if (atPlayhead) activeMidi.add(midi);
        }
      }

      return true;
    };

    const samplePitches = (nowMs: number) => {
      const buf = ensureTimeDomain();
      const node = analyserRef.current;
      if (!node || !buf || !playingRef.current) return;
      if (nowMs - lastPitchSampleMsRef.current < PITCH_SAMPLE_MS) return;
      lastPitchSampleMsRef.current = nowMs;

      node.getFloatTimeDomainData(buf);
      const active = readActivePitches(buf, node.context.sampleRate);
      const activeSet = new Set(active.map((hit) => hit.midi));

      for (const hit of active) {
        pendingRelease.delete(hit.midi);
        const existing = liveMidis.get(hit.midi);
        if (existing) {
          existing.energy = Math.max(existing.energy, hit.clarity);
        } else {
          const block: WaterfallBlock = {
            midi: hit.midi,
            spawnMs: nowMs,
            releaseMs: null,
            energy: hit.clarity,
          };
          blocks.push(block);
          liveMidis.set(hit.midi, block);
        }
        prevClarity.set(hit.midi, hit.clarity);
      }

      for (const midi of liveMidis.keys()) {
        if (activeSet.has(midi)) continue;
        const pending = pendingRelease.get(midi);
        if (pending == null) {
          pendingRelease.set(midi, nowMs);
          continue;
        }
        if (nowMs - pending < PITCH_RELEASE_HOLD_MS) continue;
        const block = liveMidis.get(midi);
        if (block) block.releaseMs = nowMs;
        liveMidis.delete(midi);
        pendingRelease.delete(midi);
        prevClarity.delete(midi);
      }
    };

    const paintWaterfall = (
      nowMs: number,
      width: number,
      rollH: number,
      activeMidi: Set<number>,
    ) => {
      if (!ensureTimeDomain()) return;

      const layout = layoutWaterfall(rollH);
      const keyW = width / KEY_COUNT;
      const playheadLine = layout.playheadY;

      samplePitches(nowMs);
      pruneWaterfallBlocks(blocks, nowMs, layout);

      drawScrollingGrid(ctx, width, playheadLine, nowMs, layout);

      for (const block of blocks) {
        drawWaterfallBlock(ctx, block, nowMs, layout, keyW, rollH, activeMidi);
      }
    };

    const frame = (now: number) => {
      resize();
      const width = canvas.width;
      const height = canvas.height;
      const keyH = Math.max(28, height * KEYBOARD_RATIO);
      const rollH = height - keyH;
      const playheadLine = rollH;

      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#160c24');
      bg.addColorStop(1, '#1c1230');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      drawGrid(ctx, width, rollH);

      const activeMidi = new Set<number>();
      const usedTracker = paintTracker(now, width, rollH, activeMidi);
      if (!usedTracker) {
        paintWaterfall(now, width, rollH, activeMidi);
      }

      syncKeyboardLights(
        activeMidi,
        now,
        rollH,
        blocks,
        liveMidis,
        analyserRef.current,
        playingRef.current,
        ensureFreqBuffer(),
      );

      ctx.strokeStyle = 'rgba(255, 248, 238, 0.65)';
      ctx.lineWidth = Math.max(2, width * 0.0025);
      ctx.beginPath();
      ctx.moveTo(0, playheadLine);
      ctx.lineTo(width, playheadLine);
      ctx.stroke();
      ctx.fillStyle = 'rgba(226, 24, 90, 0.22)';
      ctx.fillRect(0, playheadLine - 4, width, 8);

      drawKeyboard(ctx, width, height, keyH, activeMidi);

      raf = window.requestAnimationFrame(frame);
    };

    raf = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="piano-roll" aria-label="Piano roll visualizer" role="img">
      <canvas ref={canvasRef} className="piano-roll-canvas" />
      <span className="piano-roll-badge">
        {trackerSong ? 'Tracker roll' : 'Waterfall'}
      </span>
    </div>
  );
}
