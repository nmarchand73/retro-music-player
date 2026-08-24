/** Fundamental frequency detection for chip audio (square / triangle mixes). */

export type PitchHit = {
  midi: number;
  clarity: number;
};

const DEFAULT_MIN_HZ = 62;
const DEFAULT_MAX_HZ = 2100;

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function bufferRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const v = buffer[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

/** YIN pitch estimator — good fundamental on harmonic-rich chip waves. */
export function yinDetect(
  buffer: Float32Array,
  sampleRate: number,
  minHz = DEFAULT_MIN_HZ,
  maxHz = DEFAULT_MAX_HZ,
  threshold = 0.14,
): { hz: number; clarity: number } | null {
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxTau = Math.min(buffer.length - 1, Math.ceil(sampleRate / minHz));
  if (maxTau <= minTau + 2) return null;

  const yin = new Float32Array(maxTau + 1);
  yin[0] = 1;

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let i = 0; i < buffer.length - tau; i += 1) {
      const d = (buffer[i] ?? 0) - (buffer[i + tau] ?? 0);
      sum += d * d;
    }
    yin[tau] = sum;
  }

  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += yin[tau] ?? 0;
    yin[tau] = runningSum > 0 ? ((yin[tau] ?? 0) * tau) / runningSum : 1;
  }

  let bestTau = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if ((yin[tau] ?? 1) < threshold) {
      let t = tau;
      while (t + 1 <= maxTau && (yin[t + 1] ?? 1) < (yin[t] ?? 1)) t += 1;
      bestTau = t;
      break;
    }
  }

  if (bestTau < 0) {
    let minVal = Infinity;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      const v = yin[tau] ?? 1;
      if (v < minVal) {
        minVal = v;
        bestTau = tau;
      }
    }
    if (bestTau < 0 || minVal > 0.42) return null;
  }

  const yM1 = bestTau > 0 ? (yin[bestTau - 1] ?? 0) : (yin[bestTau] ?? 0);
  const y0 = yin[bestTau] ?? 1;
  const yP1 = bestTau + 1 <= maxTau ? (yin[bestTau + 1] ?? 0) : (yin[bestTau] ?? 0);
  const denom = 2 * y0 - yP1 - yM1;
  const refinedTau = Math.abs(denom) > 1e-6 ? bestTau + (yP1 - yM1) / (2 * denom) : bestTau;

  const hz = sampleRate / refinedTau;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;

  return { hz, clarity: Math.max(0, Math.min(1, 1 - y0)) };
}

type TauPeak = { tau: number; strength: number };

function normalizedAutocorrPeaks(
  buffer: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
): TauPeak[] {
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxTau = Math.min(buffer.length - 1, Math.ceil(sampleRate / minHz));
  if (maxTau <= minTau + 2) return [];

  const peaks: TauPeak[] = [];
  let prev = 0;
  let curr = 0;

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < buffer.length - tau; i += 1) {
      const a = buffer[i] ?? 0;
      sum += a * (buffer[i + tau] ?? 0);
      norm += a * a;
    }
    const next = norm > 1e-9 ? sum / norm : 0;
    if (tau > minTau + 1 && curr > prev && curr > next && curr > 0.28) {
      peaks.push({ tau, strength: curr });
    }
    prev = curr;
    curr = next;
  }

  peaks.sort((a, b) => b.strength - a.strength);
  return peaks;
}

function isHarmonicOf(candidateMidi: number, fundamentalMidi: number): boolean {
  const diff = Math.abs(candidateMidi - fundamentalMidi);
  if (diff < 2) return true;
  const semitone = diff % 12;
  if (semitone <= 1 || semitone >= 11) return true;
  if (Math.abs(diff - 7) <= 1) return true;
  if (Math.abs(diff - 19) <= 1) return true;
  return false;
}

function addHit(hits: PitchHit[], midi: number, clarity: number, maxVoices: number): void {
  const rounded = Math.round(midi);
  if (hits.some((h) => Math.abs(h.midi - rounded) <= 1)) return;

  for (const existing of hits) {
    if (isHarmonicOf(rounded, existing.midi) && existing.clarity >= clarity * 0.85) return;
    if (isHarmonicOf(existing.midi, rounded) && clarity > existing.clarity * 1.05) {
      existing.midi = rounded;
      existing.clarity = Math.max(existing.clarity, clarity);
      return;
    }
  }

  hits.push({ midi: rounded, clarity });
  hits.sort((a, b) => b.clarity - a.clarity);
  if (hits.length > maxVoices) hits.length = maxVoices;
}

/** Up to N simultaneous chip voices via YIN + autocorrelation peaks. */
export function detectChipPitches(
  buffer: Float32Array,
  sampleRate: number,
  maxVoices = 4,
  minMidi = 36,
  maxMidi = 96,
): PitchHit[] {
  if (bufferRms(buffer) < 0.006) return [];

  const minHz = midiToHz(minMidi - 0.6);
  const maxHz = midiToHz(maxMidi + 0.6);
  const hits: PitchHit[] = [];

  const yin = yinDetect(buffer, sampleRate, minHz, maxHz);
  if (yin) {
    addHit(hits, hzToMidi(yin.hz), yin.clarity, maxVoices);
  }

  for (const peak of normalizedAutocorrPeaks(buffer, sampleRate, minHz, maxHz)) {
    const hz = sampleRate / peak.tau;
    if (hz < minHz || hz > maxHz) continue;
    addHit(hits, hzToMidi(hz), peak.strength, maxVoices);
    if (hits.length >= maxVoices) break;
  }

  return hits.filter((h) => h.midi >= minMidi && h.midi <= maxMidi);
}
