declare module '*hivedrum.mjs' {
  export interface HivedrumModule {
    HEAPU8: Uint8Array;
    HEAPU16: Uint16Array;
    HEAP32: Int32Array;

    _malloc(size: number): number;
    _free(ptr: number): void;
    _hivedrum_version_number(): number;
    _hivedrum_create(sampleRate: number): number;
    _hivedrum_destroy(ctx: number): void;
    _hivedrum_set_sample_rate(ctx: number, sampleRate: number): void;
    _hivedrum_reset(ctx: number): void;
    _hivedrum_set_param(
      ctx: number,
      voice: number,
      param: number,
      value: number,
    ): number;
    _hivedrum_get_param(
      ctx: number,
      voice: number,
      param: number,
      out: number,
    ): number;
    _hivedrum_param_supported(voice: number, param: number): number;
    _hivedrum_fx_param_count(): number;
    _hivedrum_set_fx_param(ctx: number, param: number, value: number): number;
    _hivedrum_get_fx_param(ctx: number, param: number, out: number): number;
    _hivedrum_fx_param_info(): number;
    _hivedrum_fx_state(ctx: number): number;
    _hivedrum_set_instrument_volume(
      ctx: number,
      instrument: number,
      value: number,
    ): number;
    _hivedrum_get_instrument_volume(
      ctx: number,
      instrument: number,
      out: number,
    ): number;
    _hivedrum_set_instrument_pan(
      ctx: number,
      instrument: number,
      value: number,
    ): number;
    _hivedrum_get_instrument_pan(
      ctx: number,
      instrument: number,
      out: number,
    ): number;
    _hivedrum_set_instrument_fx_send(
      ctx: number,
      instrument: number,
      value: number,
    ): number;
    _hivedrum_get_instrument_fx_send(
      ctx: number,
      instrument: number,
      out: number,
    ): number;
    _hivedrum_trigger(ctx: number, instrument: number): number;
    _hivedrum_trigger_velocity(ctx: number, instrument: number, velocity: number): number;
    _hivedrum_process(ctx: number, out: number, frames: number): void;
    _hivedrum_is_active(ctx: number): number;
    _hivedrum_instrument_levels(ctx: number): number;
    _hivedrum_panel_state(ctx: number): number;
    _hivedrum_param_info(): number;
  }

  export interface HivedrumModuleOptions {
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

  const createHivedrumModule: (
    options?: HivedrumModuleOptions,
  ) => Promise<HivedrumModule>;
  export default createHivedrumModule;
}
