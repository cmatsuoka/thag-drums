import {
  FX_PARAM_COUNT,
  fxParamIndex,
  type FxParam,
  type FxParamInfo,
} from '../audio/protocol';
import { createDebouncedWriter, readJson, type DebouncedWriter } from './storage';

/**
 * The memory of the effects module.
 *
 * The nine controls of the shared FX bus — the four of the reverb and the
 * five of the gate — are kept in the browser, like the memories of the
 * modules: the kit comes back with the same effects on it.
 *
 * The values are the engine's own Q16.16 integers, read back from the
 * engine's table, so the bus never drifts from what the engine accepts.
 */

/** The key the effects of the kit are kept under. */
const STORAGE_KEY = 'thagomizer.fx.v1';

/** The shape of the stored data. A change of shape changes the key. */
const STORAGE_VERSION = 1;

/**
 * The effects of the kit: the values of the shared bus and the position
 * they are kept under.
 */
export interface FxStore {
  /** The values the engine should hold, in the engine's own order. */
  readonly values: Int32Array;
  /** Remember a value for a parameter of the bus. */
  write(param: FxParam, value: number): void;
  /** Put every value back to the factory value of the bus. */
  reset(): void;
  /** Write the effects to the store of the browser. */
  flush(): void;
  /** Write the effects and let the store go. */
  dispose(): void;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Build the memory of the effects module.
 *
 * The factory values of the bus come from the engine's own table, and
 * what the browser kept from an earlier visit is read on top of them: a
 * value that was saved is kept, a value that was never saved stays at
 * the factory value of the engine.
 */
export function createFxStore(info: readonly FxParamInfo[]): FxStore {
  const values = new Int32Array(FX_PARAM_COUNT);

  for (const entry of info) {
    values[entry.param] = entry.default;
  }

  const stored = readJson(STORAGE_KEY);
  if (typeof stored === 'object' && stored !== null) {
    const saved = stored as { version?: unknown; values?: unknown };
    if (saved.version === STORAGE_VERSION && Array.isArray(saved.values)) {
      for (const entry of info) {
        const value = saved.values[entry.param];
        if (!isInteger(value)) {
          continue;
        }
        values[entry.param] = clamp(value, entry.min, entry.max);
      }
    }
  }

  const writer: DebouncedWriter = createDebouncedWriter(STORAGE_KEY);

  const snapshot = (): unknown => ({
    version: STORAGE_VERSION,
    values: Array.from(values),
  });

  const save = (): void => {
    /* The picture of the bus is put together when it is written and not
     * before: a knob that is dragged reports a value for every step of
     * the drag. */
    writer.saveLater(snapshot);
  };

  return {
    values,

    write(param: FxParam, value: number): void {
      values[fxParamIndex(param)] = value;
      save();
    },

    reset(): void {
      for (const entry of info) {
        values[entry.param] = entry.default;
      }
      save();
    },

    flush(): void {
      writer.flush();
    },

    dispose(): void {
      writer.dispose();
    },
  };
}
