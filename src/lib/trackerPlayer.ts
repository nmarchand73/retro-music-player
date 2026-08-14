/*
  Tracker player wrapper — loads worklets from /public fixed paths so playback
  works in both Vite dev and production builds.
*/

const defaultCfg = {
  repeatCount: -1,
  stereoSeparation: 100,
  interpolationFilter: 0,
  context: false as AudioContext | false,
};

type Handler = { eventName: string; handler: (response?: unknown) => void };

export class TrackerPlayer {
  config: typeof defaultCfg;
  context: AudioContext;
  destination: AudioNode | false;
  gain: GainNode;
  handlers: Handler[] = [];
  processNode?: AudioWorkletNode;
  duration?: number;
  currentTime?: number;
  meta?: Record<string, unknown>;

  constructor(cfg: Partial<typeof defaultCfg> & { context?: AudioContext } = {}) {
    const { context, ...rest } = cfg;
    this.config = { ...defaultCfg, ...rest };

    if (context) {
      this.context = context;
      this.destination = false;
    } else {
      this.context = new AudioContext();
      this.destination = this.context.destination;
    }

    this.gain = this.context.createGain();
    this.gain.gain.value = 1;
  }

  async init(): Promise<void> {
    await this.context.audioWorklet.addModule('/chiptune3.worklet.js');
    this.processNode = new AudioWorkletNode(this.context, 'libopenmpt-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.processNode.port.onmessage = this.handleMessage.bind(this);
    const { repeatCount, stereoSeparation, interpolationFilter } = this.config;
    this.processNode.port.postMessage({
      cmd: 'config',
      val: { repeatCount, stereoSeparation, interpolationFilter },
    });
    this.processNode.connect(this.gain);
    if (this.destination) this.gain.connect(this.destination);
    this.fireEvent('onInitialized');
  }

  handleMessage(msg: MessageEvent<{ cmd: string; meta?: Record<string, unknown>; pos?: number; order?: number; pattern?: number; row?: number; val?: string }>) {
    switch (msg.data.cmd) {
      case 'meta':
        this.meta = msg.data.meta;
        this.duration = Number(msg.data.meta?.dur ?? 0);
        this.fireEvent('onMetadata', msg.data.meta);
        break;
      case 'pos':
        this.currentTime = msg.data.pos;
        this.fireEvent('onProgress', msg.data);
        break;
      case 'end':
        this.fireEvent('onEnded');
        break;
      case 'err':
        this.fireEvent('onError', { type: msg.data.val });
        break;
      default:
        break;
    }
  }

  fireEvent(eventName: string, response?: unknown) {
    for (const handler of this.handlers) {
      if (handler.eventName === eventName) handler.handler(response);
    }
  }

  addHandler(eventName: string, handler: (response?: unknown) => void) {
    this.handlers.push({ eventName, handler });
  }

  onInitialized(handler: () => void) {
    this.addHandler('onInitialized', handler);
  }

  onEnded(handler: () => void) {
    this.addHandler('onEnded', handler);
  }

  onError(handler: (error: { type?: string }) => void) {
    this.addHandler('onError', (response) => handler((response ?? {}) as { type?: string }));
  }

  onMetadata(handler: (meta: Record<string, unknown>) => void) {
    this.addHandler('onMetadata', (response) => handler((response ?? {}) as Record<string, unknown>));
  }

  onProgress(handler: (progress: { pos?: number; order?: number; pattern?: number; row?: number }) => void) {
    this.addHandler('onProgress', (response) =>
      handler((response ?? {}) as { pos?: number; order?: number; pattern?: number; row?: number }),
    );
  }

  postMsg(cmd: string, val?: unknown) {
    this.processNode?.port.postMessage({ cmd, val });
  }

  play(buffer: ArrayBuffer) {
    this.postMsg('play', buffer);
  }

  pause() {
    this.postMsg('pause');
  }

  unpause() {
    this.postMsg('unpause');
  }

  stop() {
    this.postMsg('stop');
  }

  getCurrentTime() {
    return this.currentTime;
  }
}
