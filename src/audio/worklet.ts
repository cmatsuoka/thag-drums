import './worklet-env';
import createHiveModule, {
  type HiveModule,
  type HiveModuleOptions,
} from '../../build/hive.mjs';
import {
  FX_PARAM_COUNT,
  INSTRUMENT_COUNT,
  PARAM_COUNT,
  Q16_ONE,
  SCOPE_POINTS,
  SOUND_PARAM_COUNT,
  VOICE_COUNT,
  type EngineCommand,
  type EngineEvent,
  type FxParamInfo,
  type ParamInfo,
} from './protocol';

const BLOCK_FRAMES = 128;

/* The state is posted about twenty times a second, and right after every
 * change, so the panel always shows the engine's own values. */
const STATE_INTERVAL = Math.max(1, Math.round(sampleRate / 20));

/* While a lamp is lit the state is posted three times as often, so that
 * the fall of the lamp is a smooth one and not a step every fifty
 * milliseconds. */
const LIVE_STATE_INTERVAL = Math.max(1, Math.round(sampleRate / 60));

/* The life of the filament: the light of the lamp comes up with the level
 * of the instrument and goes out over this many seconds. */
const LAMP_FALL = 0.12;

/* Below this the lamp is off: the envelope has died out. */
const LAMP_EPSILON = 1 / 4096;

/* The scope of the effects module: the waveform of the output signal.
 * The worklet keeps the last frames of the output in a ring and draws one
 * point of the trace for every few frames of it. */
const SCOPE_RING = 2048;
const SCOPE_BUCKET = 16;

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

  /* The values of the shared FX bus, as the engine holds them. */
  private readonly fx = new Int32Array(FX_PARAM_COUNT);

  /* The trigger lamps. The engine knows the level of every instrument
   * before it sums the voices into the mix, so a lamp follows the level
   * of its own instrument. */
  private readonly sounding = new Uint8Array(INSTRUMENT_COUNT);

  /* The level of every instrument, in Q16.16, as the engine reports it for
   * the last rendered block. */
  private readonly levels = new Int32Array(INSTRUMENT_COUNT);

  /* The brightness of every lamp, from 0 to 1: the level of the instrument
   * with the fall of a lamp. */
  private readonly lamp = new Float32Array(INSTRUMENT_COUNT);

  /* The last frames of the output signal, in a ring, and the trace the
   * scope of the effects module draws. */
  private readonly ring = new Float32Array(SCOPE_RING);
  private readonly scope = new Float32Array(SCOPE_POINTS);
  private ringPos = 0;

  private version = 0;
  private active = false;
  private peak = 0;
  private lampLit = false;
  private sinceState = 0;
  private dirty = true;

  /* How much of the light is left after one block: the fall of the lamp
   * over the life of the filament. */
  private readonly lampFall = Math.exp(-BLOCK_FRAMES / (LAMP_FALL * sampleRate));

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
          /* The signal goes into the ring of the scope: the trace is
           * drawn from the output of the engine, the way it leaves it. */
          this.ring[this.ringPos] = ((l + r) / 2) / 32768;
          this.ringPos = (this.ringPos + 1) % SCOPE_RING;
        }
        this.peak = peak;
      }


    this.sinceState += BLOCK_FRAMES;
    this.readLevels();
    if (this.dirty || this.sinceState >= this.stateInterval()) {
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

    this.emit({
      type: 'ready',
      info: this.readParamInfo(),
      fxInfo: this.readFxParamInfo(),
    });
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
      case 'fx': {
        module._hive_set_fx_param(this.context, command.param, command.value);
        break;
      }
      case 'fxSend': {
        module._hive_set_instrument_fx_send(this.context, command.instrument,
          command.value);
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
        module._hive_trigger_velocity(this.context, command.instrument,
          command.velocity);
        break;
      }
      case 'reset': {
        /* The reset restores the factory parameters, the sensitivity
         * included. */
        module._hive_reset(this.context);
        break;
      }
    }

    this.dirty = true;
    this.readState();
    this.postState();
  }

  /**
   * Read the level of every instrument from the engine.
   *
   * The engine knows the contribution of every instrument before it sums
   * the voices into the mix, so the level it reports is the level of that
   * instrument alone: the lamp of a module follows the signal of its own
   * instrument and not the mix of the whole kit.
   *
   * The engine reports the peak of a single block. The eye does not see
   * a peak, so the worklet smooths it into the fall of a lamp: the light
   * comes up at once and goes out slowly.
   */
  private readLevels(): void {
    const module = this.module;
    if (module === null) {
      return;
    }

    const pointer = module._hive_instrument_levels(this.context);
    const base = pointer >> 2;
    const heap = module.HEAP32;
    const fall = this.lampFall;
    let lit = false;

    for (let instrument = 0; instrument < INSTRUMENT_COUNT; instrument += 1) {
      const raw = heap[base + instrument] ?? 0;
      const level = Math.min(1, Math.max(0, raw / Q16_ONE));
      const envelope = this.lamp[instrument] ?? 0;
      const next = level > envelope ? level : envelope * fall;
      const brightness = next < LAMP_EPSILON ? 0 : next;

      this.levels[instrument] = raw;
      this.sounding[instrument] = raw > 0 ? 1 : 0;
      this.lamp[instrument] = brightness;

      if (brightness > 0) {
        lit = true;
      }
    }

    this.lampLit = lit;
  }

  /**
   * How many frames may pass between two states.
   *
   * The panel shows the engine's own values, so the state has to be posted
   * often enough for the panel to feel alive: about twenty times a second
   * while the kit is quiet, and three times as often while a lamp is lit.
   */
  private stateInterval(): number {
    return this.lampLit ? LIVE_STATE_INTERVAL : STATE_INTERVAL;
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

  /**
   * The FX bus table of the engine: the range and the default of every
   * shared bus parameter, probed from the engine's own setters.
   */
  private readFxParamInfo(): FxParamInfo[] {
    const module = this.module;
    if (module === null) {
      return [];
    }

    const pointer = module._hive_fx_param_info();
    const base = pointer >> 2;
    const heap = module.HEAP32;
    const count = module._hive_fx_param_count();
    const info: FxParamInfo[] = [];

    for (let param = 0; param < count; param += 1) {
      const index = param * 3;
      info.push({
        param,
        min: heap[base + index] ?? 0,
        max: heap[base + index + 1] ?? 0,
        default: heap[base + index + 2] ?? 0,
      });
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

    const fxPointer = module._hive_fx_state(this.context);
    const fxBase = fxPointer >> 2;
    for (let param = 0; param < FX_PARAM_COUNT; param += 1) {
      this.fx[param] = heap[fxBase + param] ?? 0;
    }

    this.active = module._hive_is_active(this.context) !== 0;

    // A kit that has gone quiet is not sounding any more: no instrument
    // reports a level.
    if (!this.active) {
      this.sounding.fill(0);
    }
  }

  /**
   * Read the waveform of the output signal for the scope.
   *
   * The ring holds the last frames of the output. Every point of the
   * trace takes the peak of a few frames of it, with its sign: the trace
   * is the shape of the signal and not its noise.
   */
  private readScope(): void {
    const span = SCOPE_POINTS * SCOPE_BUCKET;
    for (let point = 0; point < SCOPE_POINTS; point += 1) {
      const start = this.ringPos - span + point * SCOPE_BUCKET;
      let peak = 0;
      for (let offset = 0; offset < SCOPE_BUCKET; offset += 1) {
        const index = (start + offset + SCOPE_RING * 2) % SCOPE_RING;
        const sample = this.ring[index] ?? 0;
        if (Math.abs(sample) > Math.abs(peak)) {
          peak = sample;
        }
      }
      this.scope[point] = peak;
    }
  }

  private postState(): void {
    this.readScope();
    this.emit({
      type: 'state',
      state: {
        values: this.values,
        supported: this.supported,
        fx: this.fx,
        scope: this.scope,
        sounding: this.sounding,
        levels: this.levels,
        lamp: this.lamp,
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
