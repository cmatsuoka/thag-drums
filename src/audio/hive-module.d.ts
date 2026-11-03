declare module '*hive.mjs' {
  export interface HiveModule {
    HEAPU8: Uint8Array;
    HEAPU16: Uint16Array;
    HEAP32: Int32Array;

    _malloc(size: number): number;
    _free(ptr: number): void;
    _hive_version_number(): number;
    _hive_create(sampleRate: number): number;
    _hive_destroy(ctx: number): void;
    _hive_set_sample_rate(ctx: number, sampleRate: number): void;
    _hive_reset(ctx: number): void;
    _hive_set_param(
      ctx: number,
      voice: number,
      param: number,
      value: number,
    ): number;
    _hive_get_param(
      ctx: number,
      voice: number,
      param: number,
      out: number,
    ): number;
    _hive_param_supported(voice: number, param: number): number;
    _hive_set_instrument_volume(
      ctx: number,
      instrument: number,
      value: number,
    ): number;
    _hive_get_instrument_volume(
      ctx: number,
      instrument: number,
      out: number,
    ): number;
    _hive_set_instrument_pan(
      ctx: number,
      instrument: number,
      value: number,
    ): number;
    _hive_get_instrument_pan(
      ctx: number,
      instrument: number,
      out: number,
    ): number;
    _hive_trigger(ctx: number, instrument: number): number;
    _hive_trigger_velocity(ctx: number, instrument: number, velocity: number): number;
    _hive_process(ctx: number, out: number, frames: number): void;
    _hive_is_active(ctx: number): number;
    _hive_instrument_levels(ctx: number): number;
    _hive_panel_state(ctx: number): number;
    _hive_param_info(): number;
  }

  export interface HiveModuleOptions {
    wasmBinary?: ArrayBuffer;
    noInitialRun?: boolean;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
    locateFile?: (path: string) => string;
    /**
     * Take over the instantiation of the wasm module. The callback gets
     * the imports of the module and hands the instance back to the
     * runtime. It may be called synchronously, and the exports of the
     * instance have to be returned: the runtime takes them from there.
     */
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      receiveInstance: (instance: WebAssembly.Instance) => WebAssembly.Exports,
    ) => WebAssembly.Exports;
    /**
     * Called when the runtime is up and the C constructors have run. The
     * module object that was handed in carries the exports and the heap
     * views from that moment on.
     */
    onRuntimeInitialized?: () => void;
  }

  const createHiveModule: (
    options?: HiveModuleOptions,
  ) => Promise<HiveModule>;
  export default createHiveModule;
}
