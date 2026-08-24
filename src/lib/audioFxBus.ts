/**
 * Post-emulation “Modern sound” FX bus.
 *
 * Algorithms drawn from chiptune/SID mastering practice and classic studio DSP:
 * - d8aBass SID modernization: bass + air, gentle low-mid scoop, bus dynamics, soft limit
 * - Battle of the Bits / ChipSounds mastering notes: HPF rumble, short plate, light glue
 * - Aphex-style aural exciter: HPF sidechain → soft-clip harmonics → low blend
 * - Mastering M/S width: keep bass mono (side HPF), widen presence; avoid Haas delays
 *
 * Signal flow (wet):
 *   HPF → soft sat → glue compressor → tone EQ → M/S width
 *     ├─ main wet
 *     ├─ parallel aural exciter
 *     └─ parallel short plate
 *   → output limiter
 * Dry path remains a hard bypass for Authentic.
 */

export type FxPreset = 'authentic' | 'modern' | 'hall';

export type FxPlatformHint = 'amiga' | 'atari' | 'cpc' | 'c64' | 'arcade' | 'generic';

export interface AudioFxSettings {
  /** Master enable; when false, always bypass. */
  enabled: boolean;
  preset: FxPreset;
  /** 0 = dry/bypass feel, 1 = full preset. */
  amount: number;
}

export const DEFAULT_AUDIO_FX_SETTINGS: AudioFxSettings = {
  enabled: false,
  preset: 'modern',
  amount: 0.55,
};

interface PlatformTone {
  rumbleHz: number;
  lowShelfHz: number;
  lowShelfDb: number;
  scoopHz: number;
  scoopDb: number;
  scoopQ: number;
  presenceHz: number;
  presenceDb: number;
  presenceQ: number;
  airHz: number;
  airDb: number;
  hissCutHz: number;
  hissCutDb: number;
  exciterHz: number;
  exciterMix: number;
  sideHpfHz: number;
  sideWidth: number;
  plateMix: number;
  plateSeconds: number;
  satDrive: number;
  glueThreshold: number;
  glueRatio: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function makeTanhCurve(samples = 2048, drive = 2.4): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const denom = Math.tanh(drive) || 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(drive * x) / denom;
  }
  return curve;
}

/** Asymmetric soft clip → even + odd harmonics (Aphex-style exciter shaper). */
function makeExciterCurve(samples = 2048, drive = 3.2): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i += 1) {
    let x = ((i * 2) / (samples - 1) - 1) * drive;
    if (x >= 0) {
      curve[i] = x <= 1 ? x - (x * x * x) / 3 : 2 / 3;
    } else {
      // Softer negative side keeps some even harmonics
      const y = -x;
      curve[i] = -(y <= 1 ? 0.9 * y - (y * y * y) / 4 : 0.62);
    }
  }
  return curve;
}

/** Decorrelated, gently low-passed noise plate (short room / plate IR). */
function makePlateImpulse(ctx: AudioContext, seconds: number, decay = 2.8, toneHz = 6200): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const dt = 1 / ctx.sampleRate;
  // One-pole LPF on the IR for less AY/SID hiss wash
  const coeff = Math.exp((-2 * Math.PI * toneHz) / ctx.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let lp = 0;
    // Offset seeds so L/R decorrelate (pseudo-stereo plate)
    let seed = channel === 0 ? 1 : 2;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647) * 2 - 1;
    };
    for (let i = 0; i < length; i += 1) {
      const t = i * dt;
      const env = Math.pow(1 - i / length, decay) * Math.exp(-t * 1.8);
      const noise = rand();
      lp = (1 - coeff) * noise + coeff * lp;
      data[i] = lp * env;
    }
  }
  return buffer;
}

function toneForPlatform(hint: FxPlatformHint, hall: boolean): PlatformTone {
  switch (hint) {
    case 'c64':
      // d8aBass modern SID curve: body + air, mild scoop, strong exciter/width
      return {
        rumbleHz: 35,
        lowShelfHz: 170,
        lowShelfDb: 3.6,
        scoopHz: 420,
        scoopDb: -2.4,
        scoopQ: 0.7,
        presenceHz: 3400,
        presenceDb: 2.2,
        presenceQ: 0.85,
        airHz: 9000,
        airDb: hall ? 2.0 : 1.4,
        hissCutHz: 12000,
        hissCutDb: 0,
        exciterHz: 3200,
        exciterMix: 0.22,
        sideHpfHz: 180,
        sideWidth: hall ? 1.25 : 1.15,
        plateMix: hall ? 0.42 : 0.2,
        plateSeconds: hall ? 1.45 : 0.95,
        satDrive: 2.6,
        glueThreshold: -22,
        glueRatio: 2.6,
      };
    case 'cpc':
      // AY is thin + hissy: tame top, mild body, less exciter/reverb
      return {
        rumbleHz: 40,
        lowShelfHz: 150,
        lowShelfDb: 2.4,
        scoopHz: 520,
        scoopDb: -1.6,
        scoopQ: 0.75,
        presenceHz: 2800,
        presenceDb: 1.4,
        presenceQ: 0.9,
        airHz: 7000,
        airDb: -1.8,
        hissCutHz: 7800,
        hissCutDb: -4.5,
        exciterHz: 4200,
        exciterMix: 0.1,
        sideHpfHz: 220,
        sideWidth: hall ? 1.05 : 0.85,
        plateMix: hall ? 0.28 : 0.1,
        plateSeconds: hall ? 1.1 : 0.7,
        satDrive: 2.0,
        glueThreshold: -20,
        glueRatio: 2.2,
      };
    case 'atari':
      return {
        rumbleHz: 38,
        lowShelfHz: 160,
        lowShelfDb: 2.8,
        scoopHz: 450,
        scoopDb: -2.0,
        scoopQ: 0.72,
        presenceHz: 3200,
        presenceDb: 1.8,
        presenceQ: 0.85,
        airHz: 8500,
        airDb: hall ? 1.2 : 0.4,
        hissCutHz: 10500,
        hissCutDb: -1.2,
        exciterHz: 3500,
        exciterMix: 0.16,
        sideHpfHz: 190,
        sideWidth: hall ? 1.15 : 1.0,
        plateMix: hall ? 0.36 : 0.16,
        plateSeconds: hall ? 1.25 : 0.85,
        satDrive: 2.3,
        glueThreshold: -21,
        glueRatio: 2.4,
      };
    case 'arcade':
      return {
        rumbleHz: 42,
        lowShelfHz: 140,
        lowShelfDb: 3.2,
        scoopHz: 380,
        scoopDb: -1.4,
        scoopQ: 0.68,
        presenceHz: 3600,
        presenceDb: 2.4,
        presenceQ: 0.82,
        airHz: 9200,
        airDb: hall ? 1.8 : 0.9,
        hissCutHz: 11000,
        hissCutDb: -0.8,
        exciterHz: 3800,
        exciterMix: 0.18,
        sideHpfHz: 170,
        sideWidth: hall ? 1.2 : 1.05,
        plateMix: hall ? 0.38 : 0.18,
        plateSeconds: hall ? 1.3 : 0.9,
        satDrive: 2.4,
        glueThreshold: -20,
        glueRatio: 2.5,
      };
    case 'amiga':
      // Modules already have stereo content — gentle polish, less imaging
      return {
        rumbleHz: 32,
        lowShelfHz: 130,
        lowShelfDb: 1.8,
        scoopHz: 380,
        scoopDb: -1.2,
        scoopQ: 0.65,
        presenceHz: 3600,
        presenceDb: 1.2,
        presenceQ: 0.8,
        airHz: 10000,
        airDb: hall ? 1.6 : 0.6,
        hissCutHz: 14000,
        hissCutDb: 0,
        exciterHz: 3800,
        exciterMix: 0.12,
        sideHpfHz: 160,
        sideWidth: hall ? 1.05 : 0.75,
        plateMix: hall ? 0.34 : 0.14,
        plateSeconds: hall ? 1.35 : 0.9,
        satDrive: 1.9,
        glueThreshold: -24,
        glueRatio: 2.0,
      };
    default:
      return {
        rumbleHz: 36,
        lowShelfHz: 160,
        lowShelfDb: 2.6,
        scoopHz: 430,
        scoopDb: -1.8,
        scoopQ: 0.7,
        presenceHz: 3300,
        presenceDb: 1.6,
        presenceQ: 0.85,
        airHz: 9000,
        airDb: 0.8,
        hissCutHz: 11000,
        hissCutDb: -0.8,
        exciterHz: 3500,
        exciterMix: 0.15,
        sideHpfHz: 180,
        sideWidth: 1.0,
        plateMix: hall ? 0.35 : 0.16,
        plateSeconds: hall ? 1.25 : 0.85,
        satDrive: 2.2,
        glueThreshold: -22,
        glueRatio: 2.3,
      };
  }
}

/**
 * ScriptProcessor / worklet → FX → analyser → destination.
 * Authentic / disabled = hard bypass (input → output).
 */
export class AudioFxBus {
  readonly context: AudioContext;
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly dryGain: GainNode;
  private readonly wetGain: GainNode;
  private readonly rumbleHpf: BiquadFilterNode;
  private readonly preGain: GainNode;
  private readonly saturator: WaveShaperNode;
  private readonly glue: DynamicsCompressorNode;
  private readonly lowShelf: BiquadFilterNode;
  private readonly midScoop: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;
  private readonly airShelf: BiquadFilterNode;
  private readonly hissCut: BiquadFilterNode;
  private readonly bodyOut: GainNode;

  // Mid / Side width
  private readonly msSplit: ChannelSplitterNode;
  private readonly midFromL: GainNode;
  private readonly midFromR: GainNode;
  private readonly midBus: GainNode;
  private readonly sideFromL: GainNode;
  private readonly sideFromR: GainNode;
  private readonly sideBus: GainNode;
  private readonly sideHpf: BiquadFilterNode;
  private readonly sideAir: BiquadFilterNode;
  private readonly sideWidth: GainNode;
  private readonly sideToL: GainNode;
  private readonly sideToR: GainNode;
  private readonly midToL: GainNode;
  private readonly midToR: GainNode;
  private readonly msMerge: ChannelMergerNode;
  private readonly imaged: GainNode;

  // Parallel aural exciter
  private readonly exciterHpf: BiquadFilterNode;
  private readonly exciterShaper: WaveShaperNode;
  private readonly exciterGain: GainNode;

  // Parallel plate
  private readonly plateSend: GainNode;
  private readonly plate: ConvolverNode;
  private readonly plateGain: GainNode;

  private readonly sum: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly makeup: GainNode;

  private disposed = false;
  private settings: AudioFxSettings = { ...DEFAULT_AUDIO_FX_SETTINGS };
  private platformHint: FxPlatformHint = 'generic';
  private plateSecondsCached = 0;
  private satDriveCached = -1;

  constructor(ctx: AudioContext) {
    this.context = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.rumbleHpf = ctx.createBiquadFilter();
    this.preGain = ctx.createGain();
    this.saturator = ctx.createWaveShaper();
    this.glue = ctx.createDynamicsCompressor();
    this.lowShelf = ctx.createBiquadFilter();
    this.midScoop = ctx.createBiquadFilter();
    this.presence = ctx.createBiquadFilter();
    this.airShelf = ctx.createBiquadFilter();
    this.hissCut = ctx.createBiquadFilter();
    this.bodyOut = ctx.createGain();

    this.msSplit = ctx.createChannelSplitter(2);
    this.midFromL = ctx.createGain();
    this.midFromR = ctx.createGain();
    this.midBus = ctx.createGain();
    this.sideFromL = ctx.createGain();
    this.sideFromR = ctx.createGain();
    this.sideBus = ctx.createGain();
    this.sideHpf = ctx.createBiquadFilter();
    this.sideAir = ctx.createBiquadFilter();
    this.sideWidth = ctx.createGain();
    this.sideToL = ctx.createGain();
    this.sideToR = ctx.createGain();
    this.midToL = ctx.createGain();
    this.midToR = ctx.createGain();
    this.msMerge = ctx.createChannelMerger(2);
    this.imaged = ctx.createGain();

    this.exciterHpf = ctx.createBiquadFilter();
    this.exciterShaper = ctx.createWaveShaper();
    this.exciterGain = ctx.createGain();

    this.plateSend = ctx.createGain();
    this.plate = ctx.createConvolver();
    this.plateGain = ctx.createGain();

    this.sum = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();

    this.rumbleHpf.type = 'highpass';
    this.rumbleHpf.Q.value = 0.707;
    this.lowShelf.type = 'lowshelf';
    this.midScoop.type = 'peaking';
    this.presence.type = 'peaking';
    this.airShelf.type = 'highshelf';
    this.hissCut.type = 'peaking';
    this.sideHpf.type = 'highpass';
    this.sideHpf.Q.value = 0.707;
    this.sideAir.type = 'highshelf';
    this.exciterHpf.type = 'highpass';
    this.exciterHpf.Q.value = 0.707;

    this.saturator.curve = makeTanhCurve(2048, 2.4);
    this.saturator.oversample = '2x';
    this.exciterShaper.curve = makeExciterCurve(2048, 3.2);
    this.exciterShaper.oversample = '2x';

    this.plate.normalize = true;
    this.ensurePlate(0.95, 6200);

    this.midFromL.gain.value = 0.5;
    this.midFromR.gain.value = 0.5;
    this.sideFromL.gain.value = 0.5;
    this.sideFromR.gain.value = -0.5;
    this.midToL.gain.value = 1;
    this.midToR.gain.value = 1;
    this.sideToL.gain.value = 1;
    this.sideToR.gain.value = -1;

    // Dry bypass
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.sum);

    // Wet core: clean → sat → glue → tone
    this.input.connect(this.rumbleHpf);
    this.rumbleHpf.connect(this.preGain);
    this.preGain.connect(this.saturator);
    this.saturator.connect(this.glue);
    this.glue.connect(this.lowShelf);
    this.lowShelf.connect(this.midScoop);
    this.midScoop.connect(this.presence);
    this.presence.connect(this.airShelf);
    this.airShelf.connect(this.hissCut);
    this.hissCut.connect(this.bodyOut);

    // M/S imaging after tone
    this.bodyOut.connect(this.msSplit);
    this.msSplit.connect(this.midFromL, 0);
    this.msSplit.connect(this.midFromR, 1);
    this.msSplit.connect(this.sideFromL, 0);
    this.msSplit.connect(this.sideFromR, 1);
    this.midFromL.connect(this.midBus);
    this.midFromR.connect(this.midBus);
    this.sideFromL.connect(this.sideBus);
    this.sideFromR.connect(this.sideBus);
    this.sideBus.connect(this.sideHpf);
    this.sideHpf.connect(this.sideAir);
    this.sideAir.connect(this.sideWidth);
    this.midBus.connect(this.midToL);
    this.midBus.connect(this.midToR);
    this.sideWidth.connect(this.sideToL);
    this.sideWidth.connect(this.sideToR);
    this.midToL.connect(this.msMerge, 0, 0);
    this.sideToL.connect(this.msMerge, 0, 0);
    this.midToR.connect(this.msMerge, 0, 1);
    this.sideToR.connect(this.msMerge, 0, 1);
    this.msMerge.connect(this.imaged);
    this.imaged.connect(this.wetGain);
    this.wetGain.connect(this.sum);

    // Parallel aural exciter (from pre-image body for mono-stable harmonics)
    this.bodyOut.connect(this.exciterHpf);
    this.exciterHpf.connect(this.exciterShaper);
    this.exciterShaper.connect(this.exciterGain);
    this.exciterGain.connect(this.sum);

    // Parallel short plate
    this.imaged.connect(this.plateSend);
    this.plateSend.connect(this.plate);
    this.plate.connect(this.plateGain);
    this.plateGain.connect(this.sum);

    // Output ceiling
    this.sum.connect(this.limiter);
    this.limiter.connect(this.makeup);
    this.makeup.connect(this.output);

    this.applySettings(this.settings);
  }

  private ensurePlate(seconds: number, toneHz: number): void {
    if (Math.abs(seconds - this.plateSecondsCached) < 0.05 && this.plate.buffer) return;
    this.plate.buffer = makePlateImpulse(this.context, seconds, 2.8, toneHz);
    this.plateSecondsCached = seconds;
  }

  setPlatformHint(hint: FxPlatformHint): void {
    this.platformHint = hint;
    this.applySettings(this.settings);
  }

  applySettings(settings: AudioFxSettings): void {
    if (this.disposed) return;
    this.settings = {
      enabled: settings.enabled,
      preset: settings.preset,
      amount: clamp01(settings.amount),
    };
    this.reconfigure();
  }

  setEnabled(enabled: boolean): void {
    this.applySettings({ ...this.settings, enabled });
  }

  setPreset(preset: FxPreset): void {
    this.applySettings({ ...this.settings, preset });
  }

  setAmount(amount: number): void {
    this.applySettings({ ...this.settings, amount });
  }

  private reconfigure(): void {
    const now = this.context.currentTime;
    const bypass = !this.settings.enabled || this.settings.preset === 'authentic';
    const amount = bypass ? 0 : this.settings.amount;
    const hall = this.settings.preset === 'hall';
    const tone = toneForPlatform(this.platformHint, hall);
    const a = amount;

    // Authentic = full dry; Modern blends processed wet under dry for A/B friendliness
    this.dryGain.gain.setTargetAtTime(1 - a * 0.92, now, 0.03);
    this.wetGain.gain.setTargetAtTime(a * 0.98, now, 0.03);

    this.rumbleHpf.frequency.setTargetAtTime(tone.rumbleHz, now, 0.05);

    // Drive into soft sat (more harmonics as amount rises)
    this.preGain.gain.setTargetAtTime(1 + a * 0.35 * (tone.satDrive / 2.4), now, 0.03);
    const satDrive = 1.4 + a * (tone.satDrive - 1.4);
    if (Math.abs(satDrive - this.satDriveCached) > 0.05) {
      this.saturator.curve = makeTanhCurve(2048, satDrive);
      this.satDriveCached = satDrive;
    }

    // Glue bus
    this.glue.threshold.setTargetAtTime(tone.glueThreshold - a * 6, now, 0.05);
    this.glue.knee.setTargetAtTime(16, now, 0.05);
    this.glue.ratio.setTargetAtTime(1 + (tone.glueRatio - 1) * a, now, 0.05);
    this.glue.attack.setTargetAtTime(0.01, now, 0.05);
    this.glue.release.setTargetAtTime(hall ? 0.28 : 0.16, now, 0.05);

    // Modern tone curve
    this.lowShelf.frequency.setTargetAtTime(tone.lowShelfHz, now, 0.05);
    this.lowShelf.gain.setTargetAtTime(tone.lowShelfDb * a, now, 0.05);
    this.midScoop.frequency.setTargetAtTime(tone.scoopHz, now, 0.05);
    this.midScoop.Q.setTargetAtTime(tone.scoopQ, now, 0.05);
    this.midScoop.gain.setTargetAtTime(tone.scoopDb * a, now, 0.05);
    this.presence.frequency.setTargetAtTime(tone.presenceHz, now, 0.05);
    this.presence.Q.setTargetAtTime(tone.presenceQ, now, 0.05);
    this.presence.gain.setTargetAtTime(tone.presenceDb * a, now, 0.05);
    this.airShelf.frequency.setTargetAtTime(tone.airHz, now, 0.05);
    this.airShelf.gain.setTargetAtTime(tone.airDb * a, now, 0.05);
    this.hissCut.frequency.setTargetAtTime(tone.hissCutHz, now, 0.05);
    this.hissCut.Q.setTargetAtTime(0.9, now, 0.05);
    this.hissCut.gain.setTargetAtTime(tone.hissCutDb * a, now, 0.05);

    // M/S: mono bass, widen presence band on sides
    this.sideHpf.frequency.setTargetAtTime(tone.sideHpfHz, now, 0.05);
    this.sideAir.frequency.setTargetAtTime(6500, now, 0.05);
    this.sideAir.gain.setTargetAtTime(a * (hall ? 2.4 : 1.6), now, 0.05);
    this.sideWidth.gain.setTargetAtTime(a * tone.sideWidth, now, 0.05);

    // Aural exciter blend (typically ~−14 to −20 dB of harmonics)
    this.exciterHpf.frequency.setTargetAtTime(tone.exciterHz, now, 0.05);
    this.exciterGain.gain.setTargetAtTime(a * tone.exciterMix, now, 0.05);

    // Plate send (parallel — does not replace the dry-ish wet path)
    const plateSecs = tone.plateSeconds;
    this.ensurePlate(plateSecs, this.platformHint === 'cpc' ? 4800 : 6200);
    this.plateSend.gain.setTargetAtTime(1, now, 0.05);
    this.plateGain.gain.setTargetAtTime(a * tone.plateMix, now, 0.05);

    // Soft ceiling — transparent when bypassed so Authentic stays bit-identical-ish
    if (bypass) {
      this.limiter.threshold.setTargetAtTime(0, now, 0.05);
      this.limiter.knee.setTargetAtTime(0, now, 0.05);
      this.limiter.ratio.setTargetAtTime(1, now, 0.05);
      this.makeup.gain.setTargetAtTime(1, now, 0.05);
    } else {
      this.limiter.threshold.setTargetAtTime(-2.5 - a * 1.5, now, 0.05);
      this.limiter.knee.setTargetAtTime(4, now, 0.05);
      this.limiter.ratio.setTargetAtTime(12 + a * 8, now, 0.05);
      this.limiter.attack.setTargetAtTime(0.002, now, 0.05);
      this.limiter.release.setTargetAtTime(0.08, now, 0.05);
      this.makeup.gain.setTargetAtTime(1 + a * 0.08, now, 0.05);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const nodes: AudioNode[] = [
      this.input,
      this.output,
      this.dryGain,
      this.wetGain,
      this.rumbleHpf,
      this.preGain,
      this.saturator,
      this.glue,
      this.lowShelf,
      this.midScoop,
      this.presence,
      this.airShelf,
      this.hissCut,
      this.bodyOut,
      this.msSplit,
      this.midFromL,
      this.midFromR,
      this.midBus,
      this.sideFromL,
      this.sideFromR,
      this.sideBus,
      this.sideHpf,
      this.sideAir,
      this.sideWidth,
      this.sideToL,
      this.sideToR,
      this.midToL,
      this.midToR,
      this.msMerge,
      this.imaged,
      this.exciterHpf,
      this.exciterShaper,
      this.exciterGain,
      this.plateSend,
      this.plate,
      this.plateGain,
      this.sum,
      this.limiter,
      this.makeup,
    ];
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}

export function createAnalyser(ctx: AudioContext): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.22;
  analyser.minDecibels = -92;
  analyser.maxDecibels = -18;
  return analyser;
}

/** source → fx.input ; fx.output → analyser → destination */
export function wirePlaybackGraph(
  source: AudioNode,
  fx: AudioFxBus,
  analyser: AnalyserNode,
  destination: AudioDestinationNode,
): void {
  source.connect(fx.input);
  fx.output.connect(analyser);
  analyser.connect(destination);
}
