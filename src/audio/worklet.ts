import './worklet-env';
import createHiveModule, {
  type HiveModule,
  type HiveModuleOptions,
} from '../../build/hive.mjs';
import {
  PARAM_COUNT,
  SOUND_PARAM_COUNT,
  VOICE_COUNT,
  type EngineCommand,
  type EngineEvent,
  type ParamInfo,
} from './protocol';

const BLOCK_FRAMES = 128;

/* The state is posted about twenty times a second, and right after every
 * change, so the panel always shows the engine's own values. */
const STATE_INTERVAL = Math.max(1, Math.round(sampleRate / 20));

interface WorkletOptions {
  processorOptions?: {
    /**
     * The engine binary, already compiled by the main thread. It is
     * instantiated right here, and the engine is ready before the first
     * sound.
     */
    wasmModule?: WebAssembly.Module;
    /**
     * The engine binary as bytes, for the browsers that cannot hand a
     * compiled module over to the worklet. It is compiled in here, and
     * that may only happen from the first render quantum.
     */
    wasmBinary?: ArrayBuffer;
  };
}

/**
 * The module object the Emscripten runtime fills in while it starts up:
 * the exports and the heap views appear on the object that was handed in.
 */
type MutableHiveModule = Partial<HiveModule> & HiveModuleOptions;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class HiveProcessor extends AudioWorkletProcessor {
  private module: HiveModule | null = null;
  private context = 0;
  private outPtr = 0;
  private samples: Int16Array | null = null;
  private heapBuffer: ArrayBufferLike | null = null;
  private queue: EngineCommand[] = [];
  private wasmBinary: ArrayBuffer | undefined;
  private building = false;

  /* The snapshot the panel reads. The arrays are filled in place and
   * posted by reference: the structured clone copies them, so the worklet
   * never allocates a new one per message. */
  private readonly values = new Int32Array(VOICE_COUNT * PARAM_COUNT);
  private readonly supported = new Uint8Array(VOICE_COUNT * PARAM_COUNT);

  /* The trigger sensitivity of every channel. The engine has no velocity
   * input, so this is the host's own: a hit below the threshold does not
   * make the channel speak. */
  private readonly thresholds = new Int32Array(VOICE_COUNT);

  private version = 0;
  private active = false;
  private peak = 0;
  private sinceState = 0;
  private dirty = true;

  constructor(options: WorkletOptions) {
    super(options);

    this.port.onmessage = (event: MessageEvent<EngineCommand>) => {
      const command = event.data;
      if (this.module === null) {
        this.queue.push(command);
        return;
      }
      this.handle(command);
    };

    const wasmModule = options.processorOptions?.wasmModule;
    if (wasmModule !== undefined) {
      this.build(wasmModule);
      return;
    }

    this.wasmBinary = options.processorOptions?.wasmBinary;
  }

  override process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
  ): boolean {
    const module = this.module;
    const output = outputs[0];

    if (module === null || output === undefined) {
      // Without a module from the main thread the engine is built from
      // the first render quantum and not from the constructor: while the
      // worklet global scope is still initialising, the audio thread does
      // not run the tasks the WebAssembly compiler needs, and the
      // compilation never finishes.
      if (!this.building) {
        this.compile();
      }
      for (const channel of output ?? []) {
        channel.fill(0);
      }
      return true;
    }

    module._hive_process(this.context, this.outPtr, BLOCK_FRAMES);

    const left = output[0];
    const right = output[1] ?? output[0];
    const samples = this.samples;
    if (left !== undefined && right !== undefined && samples !== null) {
      let peak = 0;
      for (let frame = 0; frame < BLOCK_FRAMES; frame += 1) {
        const index = frame * 2;
        const l = samples[index] ?? 0;
        const r = samples[index + 1] ?? 0;
        left[frame] = l / 32768;
        right[frame] = r / 32768;
        const magnitude = Math.max(Math.abs(l), Math.abs(r));
        if (magnitude > peak) {
          peak = magnitude;
        }
      }
      this.peak = peak;
    }

    this.sinceState += BLOCK_FRAMES;
    if (this.dirty || this.sinceState >= STATE_INTERVAL) {
      this.sinceState = 0;
      this.dirty = false;
      this.readState();
      this.postState();
    }

    return true;
  }

  /**
   * Build the engine from the module the main thread compiled.
   *
   * The instance is created here and the runtime is started synchronously,
   * so the engine is ready as soon as the processor exists. A promise
   * would not do: in an AudioWorkletGlobalScope it is only settled while
   * the context renders, and the context does not render before the first
   * gesture.
   */
  private build(wasmModule: WebAssembly.Module): void {
    this.building = true;

    const module: MutableHiveModule = {
      instantiateWasm: (
        imports: WebAssembly.Imports,
        receiveInstance: (instance: WebAssembly.Instance) => WebAssembly.Exports,
      ) => {
        const instance = new WebAssembly.Instance(wasmModule, imports);
        // The exports have to be handed back: the runtime takes the
        // return value of this callback as the exports of the module.
        return receiveInstance(instance);
      },
      onRuntimeInitialized: () => {
        this.attach(module as HiveModule);
      },
    };

    try {
      // The runtime is already up when the call returns; the promise only
      // carries a failure that happened before the callback ran.
      void createHiveModule(module).catch((error: unknown) => {
        this.emit({ type: 'error', message: describe(error) });
      });
    } catch (error: unknown) {
      this.emit({ type: 'error', message: describe(error) });
    }
  }

  /**
   * Build the engine from the bytes.
   *
   * The wasm module must not be compiled while the worklet global scope is
   * still initialising: the audio thread cannot run the tasks the compiler
   * needs, and the compilation never finishes. The compile therefore
   * starts from the first render quantum, and `locateFile` keeps the
   * Emscripten runtime from building a `URL` for the binary: an
   * AudioWorkletGlobalScope has no `URL` constructor.
   */
  private compile(): void {
    this.building = true;

    const wasmBinary = this.wasmBinary;
    if (wasmBinary === undefined) {
      this.emit({ type: 'error', message: 'the engine binary is missing' });
      return;
    }

    createHiveModule({ wasmBinary, locateFile: (path) => path })
      .then((module) => {
        this.attach(module);
      })
      .catch((error: unknown) => {
        this.emit({ type: 'error', message: describe(error) });
      });
  }

  /**
   * Take over the engine the runtime has just started.
   */
  private attach(module: HiveModule): void {
    // The engine runs at the rate of the graph, not at its own default.
    const context = module._hive_create(sampleRate);
    if (context === 0) {
      this.queue.length = 0;
      this.emit({ type: 'error', message: 'could not allocate the engine context' });
      return;
    }

    this.context = context;
    this.module = module;
    this.outPtr = module._malloc(BLOCK_FRAMES * 2 * Int16Array.BYTES_PER_ELEMENT);
    const buffer = module.HEAPU8.buffer;
    this.samples = new Int16Array(buffer, this.outPtr, BLOCK_FRAMES * 2);
    this.heapBuffer = buffer;
    this.version = module._hive_version_number();

    this.emit({ type: 'ready', info: this.readParamInfo() });
    this.readState();
    this.postState();

    for (const command of this.queue) {
      this.handle(command);
    }
    this.queue.length = 0;
  }

  private handle(command: EngineCommand): void {
    const module = this.module;
    if (module === null) {
      return;
    }

    switch (command.type) {
      case 'param': {
        module._hive_set_param(this.context, command.voice, command.param, command.value);
        break;
      }
      case 'tone': {
        const values = command.values;
        for (let index = 0; index < SOUND_PARAM_COUNT; index += 1) {
          const value = values[index];
          if (value === undefined) {
            continue;
          }
          module._hive_set_param(this.context, command.voice, index, value);
        }
        break;
      }
      case 'trigger': {
        const threshold = this.thresholds[command.instrument] ?? 0;
        // The engine has no velocity input: the strength of the hit
        // decides whether the channel speaks, never how loud it is.
        if (command.strength < threshold) {
          break;
        }
        module._hive_trigger(this.context, command.instrument);
        break;
      }
      case 'sens': {
        this.thresholds[command.voice] = command.threshold;
        break;
      }
      case 'reset': {
        module._hive_reset(this.context);
        break;
      }
    }

    this.dirty = true;
    this.readState();
    this.postState();
  }

  /**
   * The parameter table of the engine: the range and the default of every
   * voice and parameter. The glue probes it from a scratch context, so the
   * knob scales never drift from the engine's own table.
   */
  private readParamInfo(): ParamInfo[] {
    const module = this.module;
    if (module === null) {
      return [];
    }

    const pointer = module._hive_param_info();
    const base = pointer >> 2;
    const heap = module.HEAP32;
    const info: ParamInfo[] = [];

    for (let voice = 0; voice < VOICE_COUNT; voice += 1) {
      for (let param = 0; param < PARAM_COUNT; param += 1) {
        const index = (voice * PARAM_COUNT + param) * 3;
        info.push({
          voice,
          param,
          min: heap[base + index] ?? 0,
          max: heap[base + index + 1] ?? 0,
          default: heap[base + index + 2] ?? 0,
          supported: module._hive_param_supported(voice, param) !== 0,
        });
      }
    }

    return info;
  }

  private readState(): void {
    const module = this.module;
    if (module === null) {
      return;
    }

    // The heap may have moved since the render buffer was taken.
    const buffer = module.HEAPU8.buffer;
    if (buffer !== this.heapBuffer) {
      this.heapBuffer = buffer;
      this.samples = new Int16Array(buffer, this.outPtr, BLOCK_FRAMES * 2);
    }

    const pointer = module._hive_panel_state(this.context);
    const base = pointer >> 2;
    const heap = module.HEAP32;

    for (let index = 0; index < VOICE_COUNT * PARAM_COUNT; index += 1) {
      this.values[index] = heap[base + index * 2] ?? 0;
      this.supported[index] = (heap[base + index * 2 + 1] ?? 0) !== 0 ? 1 : 0;
    }

    this.active = module._hive_is_active(this.context) !== 0;
  }

  private postState(): void {
    this.emit({
      type: 'state',
      state: {
        values: this.values,
        supported: this.supported,
        version: this.version,
        active: this.active,
        peak: this.peak,
      },
    });
  }

  private emit(event: EngineEvent): void {
    this.port.postMessage(event);
  }
}

registerProcessor('hive-processor', HiveProcessor);
