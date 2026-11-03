import wasmUrl from '../../build/hive.wasm?url';
import workletUrl from './worklet.ts?worker&url';
import {
  PARAM_COUNT,
  instrumentIndex,
  paramIndex,
  voiceIndex,
  type EngineCommand,
  type EngineEvent,
  type EngineState,
  type Instrument,
  type Param,
  type ParamInfo,
  type Voice,
} from './protocol';

/**
 * The Web Audio worklet is only exposed in a secure context, and a few
 * browsers still hide it behind a flag. Check for that before the engine
 * tries to build a node, so the panel can say what is actually wrong
 * instead of failing with a bare "cannot read addModule".
 */
function workletUnavailableReason(): string | null {
  if (typeof AudioWorkletNode === 'undefined') {
    return 'this browser does not support the Web Audio worklet';
  }
  if (!window.isSecureContext) {
    return 'the Web Audio worklet needs a secure context — open the app on http://localhost:5173 or over HTTPS';
  }
  return null;
}

/**
 * The main-thread facade of the engine.
 *
 * The engine itself lives in the worklet: the C engine is not thread-safe,
 * so every call to it happens on the audio thread. This class owns the
 * AudioContext, the graph and the messages.
 */
export class HiveEngine {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private state: EngineState | null = null;
  private info: ParamInfo[] = [];
  private readonly stateListeners = new Set<(state: EngineState) => void>();
  private readonly readyListeners = new Set<(info: readonly ParamInfo[]) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly pending: EngineCommand[] = [];
  // A missing worklet is not something a retry can fix, so the failure is
  // latched and the engine stops trying to build a node.
  private fatal: Error | null = null;

  constructor() {
    const unsupported = workletUnavailableReason();
    if (unsupported !== null) {
      this.fatal = new Error(unsupported);
    }
  }

  /**
   * Why the engine cannot run at all, if that is the case. The panel shows
   * this before anything is pressed, so a browser or an address that can
   * never play is obvious right away.
   */
  get unavailable(): string | null {
    return this.fatal?.message ?? null;
  }

  /** The last state the engine reported. */
  get engineState(): EngineState | null {
    return this.state;
  }

  /** The engine's own parameter table: the ranges and the defaults. */
  get paramInfo(): ParamInfo[] {
    return this.info;
  }

  /** The rate the engine renders at. */
  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  /** Whether the audio graph is running. */
  get running(): boolean {
    return this.context?.state === 'running';
  }

  onState(listener: (state: EngineState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * The engine's parameter table has arrived.
   *
   * The panel is built from that table: the ranges of the knobs and the
   * pairs the engine supports. A listener that subscribes after the engine
   * is up is called right away.
   */
  onReady(listener: (info: readonly ParamInfo[]) => void): () => void {
    this.readyListeners.add(listener);
    if (this.info.length > 0) {
      listener(this.info);
    }
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /**
   * Build the audio graph while the page is loading.
   *
   * Creating the context, loading the worklet and compiling the engine
   * binary takes a moment, and none of it has to wait for the user: the
   * first press then only has to wake the context up. The engine still
   * works without this call, the first command would just build everything
   * first.
   */
  async init(): Promise<void> {
    try {
      await this.ensure();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.emitError(reason.message);
    }
  }

  /**
   * Play an instrument. The velocity is the MIDI strike level, in the
   * range 0..127.
   */
  trigger(instrument: Instrument, velocity: number = 127): void {
    this.post({
      type: 'trigger',
      instrument: instrumentIndex(instrument),
      velocity: Math.max(0, Math.min(127, Math.round(velocity))),
    });
    this.poke();
  }

  /** Set one parameter of one voice. The value is in Q16.16. */
  setParam(voice: Voice, param: Param, value: number): void {
    this.post({
      type: 'param',
      voice: voiceIndex(voice),
      param: paramIndex(param),
      value,
    });
    this.poke();
  }

  /** Write a whole tone: the six sound parameters of a voice, in the
   * library's order, in Q16.16. */
  setTone(voice: Voice, values: number[]): void {
    this.post({ type: 'tone', voice: voiceIndex(voice), values });
    this.poke();
  }

  /** Restore the factory parameters and the mixer defaults. */
  reset(): void {
    this.post({ type: 'reset' });
    this.poke();
  }

  /**
   * Bring the audio graph up: build it if it is not built yet, and resume
   * the context. A user gesture may bring a suspended context back to
   * life, so the panel calls this on the first gesture.
   */
  async wake(): Promise<void> {
    try {
      await this.ensure();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.emitError(reason.message);
      return;
    }
    await this.resumeContext();
  }

  /**
   * The value the engine holds for a voice and a parameter, in Q16.16.
   * It comes from the engine's own snapshot, never from a local copy.
   */
  value(voice: Voice, param: Param): number | null {
    const state = this.state;
    if (state === null) {
      return null;
    }
    const index = voiceIndex(voice) * PARAM_COUNT + paramIndex(param);
    return state.values[index] ?? null;
  }

  async dispose(): Promise<void> {
    this.node?.disconnect();
    this.node = null;
    const context = this.context;
    this.context = null;
    if (context !== null) {
      await context.close();
    }
  }

  private async ensure(): Promise<void> {
    if (this.fatal !== null) {
      throw this.fatal;
    }

    if (this.node !== null) {
      return;
    }

    if (this.starting !== null) {
      return this.starting;
    }

    this.starting = this.createNode();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async createNode(): Promise<void> {
    const unsupported = workletUnavailableReason();
    if (unsupported !== null) {
      this.fatal = new Error(unsupported);
      throw this.fatal;
    }

    const context = new AudioContext({ latencyHint: 'interactive' });
    const worklet: AudioWorklet | undefined = context.audioWorklet;
    if (worklet === undefined) {
      await context.close();
      this.fatal = new Error('this browser does not expose the Web Audio worklet');
      throw this.fatal;
    }

    try {
      const [bytes] = await Promise.all([
        fetch(wasmUrl).then(async (response) => {
          if (!response.ok) {
            throw new Error(`wasm request failed (${response.status})`);
          }
          return response.arrayBuffer();
        }),
        worklet.addModule(workletUrl),
      ]);

      // The binary is compiled here, in the main thread. A worklet may not
      // compile a module while its global scope is still initialising, and
      // a compiled module can be handed over to it as it is.
      const wasmModule = await WebAssembly.compile(bytes);

      const node = this.createWorkletNode(context, wasmModule, bytes);

      node.port.onmessage = (event: MessageEvent<EngineEvent>) => {
        this.handleEvent(event.data);
      };
      node.addEventListener('processorerror', () => {
        this.emitError('the audio processor stopped unexpectedly');
      });

      node.connect(context.destination);
      this.context = context;
      this.node = node;
      for (const command of this.pending) {
        node.port.postMessage(command);
      }
      this.pending.length = 0;
      // The context starts on its own once the page has been activated. The
      // resume is not awaited: the autoplay policy may hold it back until a
      // gesture happens, and the engine has to stay usable in the meantime.
      void this.resumeContext();
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  /**
   * Build the worklet node.
   *
   * The compiled module is the fast way in: the worklet only has to
   * instantiate it, and the engine is ready right away. Browsers that
   * cannot hand a compiled module over to the worklet get the bytes
   * instead, and the worklet compiles them itself.
   */
  private createWorkletNode(
    context: AudioContext,
    wasmModule: WebAssembly.Module,
    bytes: ArrayBuffer,
  ): AudioWorkletNode {
    const options: AudioWorkletNodeOptions = {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    };

    try {
      return new AudioWorkletNode(context, 'hive-processor', {
        ...options,
        processorOptions: { wasmModule },
      });
    } catch {
      return new AudioWorkletNode(context, 'hive-processor', {
        ...options,
        processorOptions: { wasmBinary: bytes.slice(0) },
      });
    }
  }

  private async resumeContext(): Promise<void> {
    const context = this.context;
    if (context === null || context.state === 'running') {
      return;
    }
    try {
      await context.resume();
    } catch {
      // A closed context cannot be resumed; the kit stays silent.
    }
  }

  private post(command: EngineCommand): void {
    if (this.node !== null) {
      this.node.port.postMessage(command);
      return;
    }
    this.pending.push(command);
  }

  private poke(): void {
    void this.ensure().catch((error: unknown) => {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.emitError(reason.message);
    });
    // A control that is moved is a user gesture: it may bring a context
    // that the browser suspended back to life.
    void this.resumeContext();
  }

  private handleEvent(event: EngineEvent): void {
    switch (event.type) {
      case 'ready': {
        this.info = event.info;
        for (const listener of this.readyListeners) {
          listener(this.info);
        }
        break;
      }
      case 'state': {
        this.state = event.state;
        for (const listener of this.stateListeners) {
          listener(this.state);
        }
        break;
      }
      case 'error': {
        this.emitError(event.message);
        break;
      }
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener(message);
    }
  }
}
