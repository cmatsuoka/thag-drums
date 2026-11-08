/*
 * The Emscripten runtime detects its environment by probing `self`,
 * `location`, `importScripts` and `WorkerGlobalScope`. An
 * AudioWorkletGlobalScope has none of them, and the runtime trips over all
 * of them. This module runs before the engine glue and supplies the
 * stand-ins that make it take its worker path.
 *
 * `window` is deliberately not supplied. With it in place the runtime would
 * believe that it runs in a web page, and the wasm build does not enable
 * the web environment: the runtime would refuse to start.
 *
 * Older Emscripten releases recognise a worker by `importScripts`; newer
 * ones probe `WorkerGlobalScope`, which an AudioWorkletGlobalScope is not.
 * Both names are supplied, so the glue takes its worker path whichever
 * release compiled it.
 *
 * The wasm binary is handed over through processorOptions, so the runtime
 * never fetches or imports anything.
 */

interface WorkletScope {
  self?: unknown;
  location?: { href: string };
  importScripts?: (...urls: string[]) => void;
  WorkerGlobalScope?: unknown;
}

const scope = globalThis as unknown as WorkletScope;

if (scope.self === undefined) {
  scope.self = scope;
}

if (scope.location === undefined) {
  scope.location = { href: import.meta.url };
}

if (typeof scope.importScripts !== 'function') {
  scope.importScripts = () => {
    throw new Error('importScripts is not available in an AudioWorklet');
  };
}

if (scope.WorkerGlobalScope === undefined) {
  scope.WorkerGlobalScope = class WorkerGlobalScope {};
}
