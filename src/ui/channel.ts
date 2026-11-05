import {
  CHANNEL_PARAM_COUNT,
  CHANNEL_PARAMS,
  channelParamIndex,
  voiceIndex,
  type ChannelParam,
  type ParamInfo,
  type Voice,
} from '../audio/protocol';
import {
  createDebouncedWriter,
  readJson,
  type DebouncedWriter,
} from './storage';

/**
 * The channel of a module: the mixer of the voice and its effects send.
 *
 * The mixer values — the Volume, the Pan and the Sens — and the share of
 * the module that goes to the effects bus belong to the module itself and
 * not to the tone in it: they are the same for every memory position of
 * the module. They are therefore kept apart from the tones, and they are
 * written down as the user sets them.
 *
 * The values are the engine's own Q16.16 integers, read back from the
 * engine's table, so the channel never drifts from what the engine
 * accepts.
 */

/** The key the channels of the kit are kept under. */
const STORAGE_KEY = 'thagomizer.channel.v1';

/** The shape of the stored data. A change of shape changes the key. */
const STORAGE_VERSION = 1;

/**
 * The channel of every module: the mixer of the voice and its effects
 * send.
 */
export interface ChannelStore {
  /**
   * The values of the channel of a voice, in the library's own order, in
   * Q16.16.
   */
  values(voice: Voice): Int32Array;
  /** Remember a value for a control of the channel of a voice. */
  write(voice: Voice, param: ChannelParam, value: number): void;
  /** Put every channel back to the factory values of the engine. */
  resetAll(): void;
  /** Write the channels to the store of the browser. */
  flush(): void;
  /** Write the channels and let the store go. */
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
 * Build the channels of the kit.
 *
 * The factory values come from the engine's own table, and what the
 * browser kept from an earlier visit is read on top of them: a value that
 * was saved is kept, a value that was never saved stays at the factory
 * value of the engine.
 */
export function createChannelStore(
  info: readonly ParamInfo[],
  voices: readonly Voice[],
): ChannelStore {
  const values = new Map<Voice, Int32Array>();
  const factory = new Map<Voice, Int32Array>();
  const ranges = new Map<Voice, Int32Array[]>();

  for (const voice of voices) {
    const channel = new Int32Array(CHANNEL_PARAM_COUNT);
    const builtIn = new Int32Array(CHANNEL_PARAM_COUNT);
    const range: Int32Array[] = [];
    const index = voiceIndex(voice);

    for (const entry of info) {
      if (entry.voice !== index || !entry.supported) {
        continue;
      }
      const slot = channelParamIndex(entry.param);
      if (slot < 0) {
        // The parameter is not a control of the channel.
        continue;
      }
      channel[slot] = entry.default;
      builtIn[slot] = entry.default;
      range[slot] = new Int32Array([entry.min, entry.max]);
    }

    values.set(voice, channel);
    factory.set(voice, builtIn);
    ranges.set(voice, range);
  }

  const stored = readJson(STORAGE_KEY);
  if (typeof stored === 'object' && stored !== null) {
    const saved = stored as { version?: unknown; voices?: unknown };
    if (saved.version === STORAGE_VERSION && typeof saved.voices === 'object') {
      const table = saved.voices as Record<string, unknown>;
      for (const voice of voices) {
        const channel = values.get(voice);
        if (channel === undefined) {
          continue;
        }
        const entry = table[voice];
        if (!Array.isArray(entry)) {
          continue;
        }
        const range = ranges.get(voice) ?? [];
        for (let slot = 0; slot < CHANNEL_PARAM_COUNT; slot += 1) {
          const value = entry[slot];
          if (!isInteger(value)) {
            continue;
          }
          const bounds = range[slot];
          const low = bounds?.[0] ?? value;
          const high = bounds?.[1] ?? value;
          channel[slot] = clamp(value, low, high);
        }
      }
    }
  }

  const writer: DebouncedWriter = createDebouncedWriter(STORAGE_KEY);

  const snapshot = (): unknown => {
    const table: Record<string, number[]> = {};
    for (const [voice, channel] of values) {
      table[voice] = Array.from(channel);
    }
    return { version: STORAGE_VERSION, voices: table };
  };

  const save = (): void => {
    /* The picture of the channels is put together when it is written and
     * not before: a knob that is dragged reports a value for every step
     * of the drag. */
    writer.saveLater(snapshot);
  };

  return {
    values(voice: Voice): Int32Array {
      const channel = values.get(voice);
      if (channel === undefined) {
        return new Int32Array(CHANNEL_PARAM_COUNT);
      }
      return new Int32Array(channel);
    },

    write(voice: Voice, param: ChannelParam, value: number): void {
      const channel = values.get(voice);
      if (channel === undefined) {
        return;
      }
      const slot = CHANNEL_PARAMS.indexOf(param);
      if (slot < 0) {
        return;
      }
      channel[slot] = value;
      save();
    },

    resetAll(): void {
      for (const [voice, channel] of values) {
        const builtIn = factory.get(voice);
        if (builtIn === undefined) {
          continue;
        }
        channel.set(builtIn);
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
