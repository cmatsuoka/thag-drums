import {
  SOUND_PARAMS,
  SOUND_PARAM_COUNT,
  soundParamIndex,
  voiceIndex,
  type ParamInfo,
  type SoundParam,
  type Voice,
} from '../audio/protocol';
import { toQ16 } from '../audio/units';
import {
  createDebouncedWriter,
  readJson,
  removeKey,
  type DebouncedWriter,
} from './storage';

/**
 * The memory positions of the modules.
 *
 * The engine has no memory storage: it holds one set of parameters per
 * voice and nothing else. The four positions of a module are therefore a
 * store of the panel itself: a snapshot of the tone of the module for
 * every position, and the position that is selected.
 *
 * A snapshot holds the tone of the module: the sound knobs the engine
 * supports on the voice. The mixer of the channel and the effects send are
 * not part of a tone — they belong to the module, not to the position —
 * and they live in the channel store of the panel.
 *
 * The values are the engine's own Q16.16 integers, so nothing drifts on
 * the way to the store of the browser and back.
 *
 * The store is kept in the browser: the kit comes back the way it was
 * left, with the same positions selected and the same tones in them.
 */

/** The number of memory positions of a module. */
export const MEMORY_POSITIONS = 4;

/**
 * The key the memories of the kit are kept under.
 *
 * The version is part of the key: a change of the built-in tones, or of
 * the shape of the data, is a change of what the store holds, and the
 * tones of an earlier version would shadow them.
 */
const STORAGE_KEY = 'thagomizer.memory.v5';

/** The keys of the memories of the earlier versions, if they are still
 * there. */
const OLD_STORAGE_KEYS = [
  'thagomizer.memory.v1',
  'thagomizer.memory.v2',
  'thagomizer.memory.v3',
  'thagomizer.memory.v4',
];

/** The shape of the stored data. A change of shape changes the key. */
const STORAGE_VERSION = 5;

/**
 * The tones of the Snare that are not the factory value of the engine.
 *
 * Every position of the Snare is a tone of its own: the Noise, the Tone,
 * the Bend, the Decay, the Noise/Tone and the Click are the ones below.
 * The Noise/Tone is the balance between the noise and the tone of the
 * drum, and the Click the balance between the click and the body of it.
 * The other modules keep the factory values of the engine.
 */
const SNARE_TONES: Readonly<
  Record<number, ReadonlyArray<readonly [SoundParam, number]>>
> = {
  1: [
    ['noisePitch', 14000],
    ['tonePitch', 96],
    ['bend', 19.4],
    ['decay', 0.61],
    ['noiseTone', 0.5],
    ['clickTone', 0.64],
  ],
  2: [
    ['noisePitch', 6044],
    ['tonePitch', 92],
    ['bend', 8.5],
    ['decay', 0.53],
    ['noiseTone', 0.77],
    ['clickTone', 0.3],
  ],
  3: [
    ['noisePitch', 2086],
    ['tonePitch', 118],
    ['bend', 2.4],
    ['decay', 0.56],
    ['noiseTone', 0.05],
    ['clickTone', 0.16],
  ],
  4: [
    ['noisePitch', 4433],
    ['tonePitch', 40],
    ['bend', 46.8],
    ['decay', 0.7],
    ['noiseTone', 0.7],
    ['clickTone', 0.82],
  ],
};

/**
 * The memories of the kit: the positions of every module, the tones in
 * them and the position that is selected.
 */
export interface MemoryStore {
  /** The position that is selected for a voice, from 1 to 4. */
  selected(voice: Voice): number;
  /**
   * The tone of a position of a voice, in the engine's own order, in
   * Q16.16. Without a position it is the selected one.
   */
  values(voice: Voice, position?: number): Int32Array;
  /** Select a position of a voice. */
  select(voice: Voice, position: number): void;
  /** Remember a value in the selected position of a voice. */
  write(voice: Voice, param: SoundParam, value: number): void;
  /** Put the selected position of a voice back to its built-in tone. */
  resetSelected(voice: Voice): void;
  /** Put every position of every voice back to its built-in tone. */
  resetAll(): void;
  /** Write the memories to the store of the browser. */
  flush(): void;
  /** Write the memories and let the store go. */
  dispose(): void;
}

/**
 * What a module holds: the four positions and the one that is selected.
 */
interface VoiceMemory {
  selected: number;
  positions: Int32Array[];
}

/**
 * The built-in tone of a voice: the factory values of the engine's own
 * table, and the range the engine accepts them in.
 */
interface VoiceDefaults {
  values: Int32Array;
  min: Int32Array;
  max: Int32Array;
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
 * Build the memories of the kit.
 *
 * The built-in tone of every position comes from the engine's own
 * parameter table: the factory value of every sound parameter the engine
 * supports on the voice. The Snare is the exception, and its positions
 * carry the tones of their own.
 *
 * What the browser kept from an earlier visit is read afterwards: a
 * position that was saved keeps its tone, and a position that was never
 * saved keeps its built-in one.
 */
export function createMemoryStore(
  info: readonly ParamInfo[],
  voices: readonly Voice[],
): MemoryStore {
  const defaults = new Map<Voice, VoiceDefaults>();

  for (const voice of voices) {
    const values = new Int32Array(SOUND_PARAM_COUNT);
    const min = new Int32Array(SOUND_PARAM_COUNT);
    const max = new Int32Array(SOUND_PARAM_COUNT);
    const index = voiceIndex(voice);

    for (const entry of info) {
      if (entry.voice !== index || !entry.supported) {
        continue;
      }
      const slot = soundParamIndex(entry.param);
      if (slot < 0) {
        // The parameter is not a sound parameter: it is not part of a tone.
        continue;
      }
      values[slot] = entry.default;
      min[slot] = entry.min;
      max[slot] = entry.max;
    }

    defaults.set(voice, { values, min, max });
  }

  /**
   * The built-in tone of one position of a voice.
   */
  const builtIn = (voice: Voice, position: number): Int32Array => {
    const table = defaults.get(voice);
    const values = new Int32Array(SOUND_PARAM_COUNT);
    if (table === undefined) {
      return values;
    }
    values.set(table.values);

    const tone = voice === 'snare' ? SNARE_TONES[position] : undefined;
    if (tone !== undefined) {
      for (const [param, value] of tone) {
        const slot = SOUND_PARAMS.indexOf(param);
        const low = table.min[slot];
        const high = table.max[slot];
        const raw = toQ16(value);
        values[slot] =
          low === undefined || high === undefined ? raw : clamp(raw, low, high);
      }
    }

    return values;
  };

  const memories = new Map<Voice, VoiceMemory>();

  for (const voice of voices) {
    const positions: Int32Array[] = [];
    for (let position = 1; position <= MEMORY_POSITIONS; position += 1) {
      positions.push(builtIn(voice, position));
    }
    memories.set(voice, { selected: 1, positions });
  }

  /* The memories of an earlier version of the data are not read any
   * more: they are forgotten, so the built-in tones of this version are
   * the ones the kit starts from. */
  for (const key of OLD_STORAGE_KEYS) {
    removeKey(key);
  }

  /* What the browser kept from an earlier visit. */
  const stored = readJson(STORAGE_KEY);
  if (typeof stored === 'object' && stored !== null) {
    const saved = stored as {
      version?: unknown;
      voices?: unknown;
    };
    if (saved.version === STORAGE_VERSION && typeof saved.voices === 'object') {
      const table = saved.voices as Record<string, unknown>;
      for (const voice of voices) {
        const memory = memories.get(voice);
        if (memory === undefined) {
          continue;
        }
        const entry = table[voice];
        if (typeof entry !== 'object' || entry === null) {
          continue;
        }
        const savedMemory = entry as { selected?: unknown; positions?: unknown };

        if (isInteger(savedMemory.selected)) {
          memory.selected = clamp(
            savedMemory.selected,
            1,
            MEMORY_POSITIONS,
          );
        }

        if (!Array.isArray(savedMemory.positions)) {
          continue;
        }

        const range = defaults.get(voice);
        for (let position = 1; position <= MEMORY_POSITIONS; position += 1) {
          const savedValues = savedMemory.positions[position - 1];
          if (
            !Array.isArray(savedValues) ||
            savedValues.length !== SOUND_PARAM_COUNT
          ) {
            continue;
          }
          const values = memory.positions[position - 1];
          if (values === undefined) {
            continue;
          }
          for (let param = 0; param < SOUND_PARAM_COUNT; param += 1) {
            const value = savedValues[param];
            if (!isInteger(value)) {
              continue;
            }
            const low = range?.min[param] ?? value;
            const high = range?.max[param] ?? value;
            values[param] = clamp(value, low, high);
          }
        }
      }
    }
  }

  const writer: DebouncedWriter = createDebouncedWriter(STORAGE_KEY);

  /**
   * The shape that goes into the store of the browser.
   */
  const snapshot = (): unknown => {
    const table: Record<string, unknown> = {};
    for (const [voice, memory] of memories) {
      table[voice] = {
        selected: memory.selected,
        positions: memory.positions.map((values) => Array.from(values)),
      };
    }
    return { version: STORAGE_VERSION, voices: table };
  };

  const save = (): void => {
    /* The picture of the memories is put together when it is written and
     * not before: a knob that is dragged reports a value for every step
     * of the drag. */
    writer.saveLater(snapshot);
  };

  return {
    selected(voice: Voice): number {
      return memories.get(voice)?.selected ?? 1;
    },

    values(voice: Voice, position?: number): Int32Array {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return new Int32Array(SOUND_PARAM_COUNT);
      }
      const slot = position ?? memory.selected;
      const values = memory.positions[slot - 1];
      if (values === undefined) {
        return new Int32Array(SOUND_PARAM_COUNT);
      }
      return new Int32Array(values);
    },

    select(voice: Voice, position: number): void {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return;
      }
      memory.selected = clamp(
        Math.round(position),
        1,
        MEMORY_POSITIONS,
      );
      save();
    },

    write(voice: Voice, param: SoundParam, value: number): void {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return;
      }
      const values = memory.positions[memory.selected - 1];
      if (values === undefined) {
        return;
      }
      const slot = SOUND_PARAMS.indexOf(param);
      if (slot < 0) {
        return;
      }
      values[slot] = value;
      save();
    },

    resetSelected(voice: Voice): void {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return;
      }
      memory.positions[memory.selected - 1] = builtIn(voice, memory.selected);
      save();
    },

    resetAll(): void {
      for (const [voice, memory] of memories) {
        for (let position = 1; position <= MEMORY_POSITIONS; position += 1) {
          memory.positions[position - 1] = builtIn(voice, position);
        }
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
