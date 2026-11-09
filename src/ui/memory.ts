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
 * The version is part of the key. While the project is pre-release the
 * key stays at v1: the built-in tones may change without a migration.
 */
const STORAGE_KEY = 'thagomizer.memory.v1';

/** The shape of the stored data. */
const STORAGE_VERSION = 1;

/**
 * The tones of the Kick that are not the factory value of the engine.
 *
 * Every position of the Kick is a tone of its own: the Noise, the Tone,
 * the Bend, the Decay, the Noise/Tone and the Click are the ones below.
 * The Noise/Tone is the balance between the noise and the tone of the
 * drum, and the Click the balance between the click and the body of it.
 * The other modules keep the factory values of the engine.
 */
const KICK_TONES: Readonly<
  Record<number, ReadonlyArray<readonly [SoundParam, number]>>
> = {
  1: [
    ['noisePitch', 9000],
    ['tonePitch', 40],
    ['bend', 40],
    ['decay', 0.3],
    ['noiseTone', 0.95],
    ['clickTone', 0.5],
  ],
  2: [
    ['noisePitch', 3810],
    ['tonePitch', 35],
    ['bend', 39.7],
    ['decay', 0.3],
    ['noiseTone', 0.64],
    ['clickTone', 0.69],
  ],
  3: [
    ['noisePitch', 1448],
    ['tonePitch', 45],
    ['bend', 19],
    ['decay', 0.27],
    ['noiseTone', 0.04],
    ['clickTone', 0.17],
  ],
  4: [
    ['noisePitch', 3763],
    ['tonePitch', 39],
    ['bend', 56.3],
    ['decay', 0.52],
    ['noiseTone', 1.0],
    ['clickTone', 0.15],
  ],
};

/**
 * The tones of the Tom 1 that are not the factory value of the engine.
 */
const TOM1_TONES: Readonly<
  Record<number, ReadonlyArray<readonly [SoundParam, number]>>
> = {
  1: [
    ['noisePitch', 8377],
    ['tonePitch', 150],
    ['bend', 24],
    ['decay', 0.7],
    ['noiseTone', 0.65],
    ['clickTone', 0.75],
  ],
  2: [
    ['noisePitch', 3722],
    ['tonePitch', 174],
    ['bend', 9.3],
    ['decay', 0.7],
    ['noiseTone', 0.93],
    ['clickTone', 0.5],
  ],
  3: [
    ['noisePitch', 16000],
    ['tonePitch', 266],
    ['bend', 0],
    ['decay', 0.27],
    ['noiseTone', 0.9],
    ['clickTone', 0.8],
  ],
  4: [
    ['noisePitch', 16000],
    ['tonePitch', 118],
    ['bend', 45],
    ['decay', 2.47],
    ['noiseTone', 0.85],
    ['clickTone', 0.85],
  ],
};

/**
 * The tones of the Tom 2 that are not the factory value of the engine.
 */
const TOM2_TONES: Readonly<
  Record<number, ReadonlyArray<readonly [SoundParam, number]>>
> = {
  1: [
    ['noisePitch', 8377],
    ['tonePitch', 114],
    ['bend', 24],
    ['decay', 0.7],
    ['noiseTone', 0.65],
    ['clickTone', 0.75],
  ],
  2: [
    ['noisePitch', 3722],
    ['tonePitch', 126],
    ['bend', 9.3],
    ['decay', 0.7],
    ['noiseTone', 0.93],
    ['clickTone', 0.5],
  ],
  3: [
    ['noisePitch', 16000],
    ['tonePitch', 182],
    ['bend', 0],
    ['decay', 0.27],
    ['noiseTone', 0.9],
    ['clickTone', 0.8],
  ],
  4: [
    ['noisePitch', 16000],
    ['tonePitch', 73],
    ['bend', 45],
    ['decay', 2.22],
    ['noiseTone', 0.85],
    ['clickTone', 0.85],
  ],
};

/**
 * The tones of the Tom 3 that are not the factory value of the engine.
 */
const TOM3_TONES: Readonly<
  Record<number, ReadonlyArray<readonly [SoundParam, number]>>
> = {
  1: [
    ['noisePitch', 8377],
    ['tonePitch', 71],
    ['bend', 24],
    ['decay', 0.7],
    ['noiseTone', 0.65],
    ['clickTone', 0.75],
  ],
  2: [
    ['noisePitch', 3722],
    ['tonePitch', 80],
    ['bend', 9.3],
    ['decay', 0.7],
    ['noiseTone', 0.93],
    ['clickTone', 0.5],
  ],
  3: [
    ['noisePitch', 16000],
    ['tonePitch', 126],
    ['bend', 0],
    ['decay', 0.33],
    ['noiseTone', 0.9],
    ['clickTone', 0.8],
  ],
  4: [
    ['noisePitch', 16000],
    ['tonePitch', 56],
    ['bend', 45],
    ['decay', 2.09],
    ['noiseTone', 0.85],
    ['clickTone', 0.85],
  ],
};

/**
 * The tones of the Cymbal that are not the factory value of the engine.
 */
const CYMBAL_TONES: Readonly<
  Record<number, ReadonlyArray<readonly [SoundParam, number]>>
> = {
  1: [
    ['noisePitch', 12000],
    ['tonePitch', 0.88],
    ['noiseBody', 3000],
    ['sweep', 0.3],
    ['bend', 0],
    ['decay', 2.3],
    ['noiseTone', 0.3],
    ['bellCymbal', 0],
  ],
  2: [
    ['noisePitch', 5292],
    ['tonePitch', 0.5],
    ['noiseBody', 50],
    ['sweep', 0.85],
    ['bend', 0],
    ['decay', 3],
    ['noiseTone', 0.18],
    ['bellCymbal', 0.18],
  ],
  3: [
    ['noisePitch', 11380],
    ['tonePitch', 0.9],
    ['noiseBody', 706],
    ['sweep', 0],
    ['bend', -41.8],
    ['decay', 2.6],
    ['noiseTone', 0.4],
    ['bellCymbal', 0.04],
  ],
  4: [
    ['noisePitch', 12000],
    ['tonePitch', 1.0],
    ['noiseBody', 800],
    ['sweep', 0],
    ['bend', 0],
    ['decay', 1.25],
    ['noiseTone', 0.4],
    ['bellCymbal', 0.5],
  ],
};

/**
 * The tones of the Hi-hat that are not the factory value of the engine.
 */
const HIHAT_TONES: Readonly<
  Record<number, ReadonlyArray<readonly [SoundParam, number]>>
> = {
  1: [
    ['noisePitch', 12105],
    ['tonePitch', 0.95],
    ['noiseBody', 3000],
    ['decay', 0.19],
    ['noiseTone', 0.15],
    ['bellCymbal', 0.02],
  ],
  2: [
    ['noisePitch', 10000],
    ['tonePitch', 0],
    ['noiseBody', 715],
    ['decay', 0.23],
    ['noiseTone', 0.8],
    ['bellCymbal', 0.5],
  ],
  3: [
    ['noisePitch', 9042],
    ['tonePitch', 0.79],
    ['noiseBody', 1532],
    ['decay', 0.3],
    ['noiseTone', 0.18],
    ['bellCymbal', 0.18],
  ],
  4: [
    ['noisePitch', 5179],
    ['tonePitch', 1],
    ['noiseBody', 730],
    ['decay', 0.4],
    ['noiseTone', 0],
    ['bellCymbal', 0],
  ],
};

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
    ['noiseTone', 0.33],
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
 * them and the position that is picked.
 *
 * A position holds a tone that was put into it on purpose: a short press
 * on the button of a position picks it and recalls the tone in it, a
 * long press stores the tone of the module in it.
 *
 * The tone of a module that is *live* — the one the engine plays and the
 * knobs of the module work on — belongs to no position: it is lost when
 * another position is picked, and it only becomes a tone of its own when
 * the user holds the button of a position down.
 *
 * The engine owns the live tone. The store keeps a copy of it so the kit
 * comes back the way it was left, and the panel hands the engine's own
 * values over whenever they change.
 */
export interface MemoryStore {
  /** The position that is picked for a voice, from 1 to 4. */
  selected(voice: Voice): number;
  /**
   * The tone stored in a position of a voice, in the engine's own order,
   * in Q16.16.
   */
  stored(voice: Voice, position: number): Int32Array;
  /**
   * The live tone of a voice: the configuration the module is playing
   * right now, in the engine's own order, in Q16.16.
   *
   * The live tone belongs to no position: it is lost when another
   * position is picked, and it only becomes a tone of its own when the
   * user holds the button of a position down.
   */
  live(voice: Voice): Int32Array;
  /**
   * Write a value of the engine into the live tone of a voice.
   *
   * The value is the one the panel has written to the engine, clamped to
   * the range of the engine the way the engine itself clamps it. The
   * position that is picked is not touched by it: a tone is only written
   * into a position when the user holds the button of that position
   * down.
   */
  write(voice: Voice, param: SoundParam, value: number): void;
  /**
   * Pick a position of a voice.
   *
   * The tone in the position is what the module works on from then on: a
   * live tone that was not stored is lost here. The caller writes the
   * tone of the position into the engine, so the module plays it.
   *
   * Picking the position that is picked already changes nothing, and a
   * live tone that was not stored is not thrown away by it.
   *
   * Returns whether the position changed.
   */
  select(voice: Voice, position: number): boolean;
  /**
   * Store the live tone of a voice in a position and pick that position.
   *
   * This is what the user asks for when the button of the position is
   * held down. The tone is the one the module is playing right now, and
   * the engine keeps it: the store only remembers it.
   */
  store(voice: Voice, position: number): void;
  /**
   * Whether the live tone of a voice differs from the tone in the
   * position that is picked: the configuration is not stored yet.
   */
  pending(voice: Voice): boolean;
  /**
   * Whether the tone in a position is one of its own: it is not the
   * built-in tone of that position any more.
   */
  modified(voice: Voice, position: number): boolean;
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
 * What a module holds: the four positions, the tone that is live and the
 * one that is picked.
 */
interface VoiceMemory {
  selected: number;
  positions: Int32Array[];
  live: Int32Array;
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
 * supports on the voice. The modules with tones of their own (the Kick,
 * the Snare, the Toms, the Cymbal and the Hi-hat) override those values.
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

    const tone =
      voice === 'snare'
        ? SNARE_TONES[position]
        : voice === 'kick'
        ? KICK_TONES[position]
        : voice === 'tom1'
        ? TOM1_TONES[position]
        : voice === 'tom2'
        ? TOM2_TONES[position]
        : voice === 'tom3'
        ? TOM3_TONES[position]
        : voice === 'hihat'
        ? HIHAT_TONES[position]
        : voice === 'cymbal'
        ? CYMBAL_TONES[position]
        : undefined;
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
    /* The live tone starts as the tone of the position that is picked:
     * the knobs of the module work on it. */
    const live = new Int32Array(
      positions[0] ?? new Int32Array(SOUND_PARAM_COUNT),
    );
    memories.set(voice, { selected: 1, positions, live });
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
        const savedMemory = entry as {
          selected?: unknown;
          positions?: unknown;
          live?: unknown;
        };

        if (isInteger(savedMemory.selected)) {
          memory.selected = clamp(
            savedMemory.selected,
            1,
            MEMORY_POSITIONS,
          );
        }

        const range = defaults.get(voice);
        const clampTo = (param: number, value: number): number => {
          const low = range?.min[param] ?? value;
          const high = range?.max[param] ?? value;
          return clamp(value, low, high);
        };

        if (Array.isArray(savedMemory.positions)) {
          for (
            let position = 1;
            position <= MEMORY_POSITIONS;
            position += 1
          ) {
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
              values[param] = clampTo(param, value);
            }
          }
        }

        /* The live tone is the configuration the module is playing: it is
         * kept apart from the positions, so it is restored on its own. A
         * store that has no live tone of its own starts as the tone of the
         * position that is picked. */
        if (Array.isArray(savedMemory.live)) {
          const savedLive = savedMemory.live;
          for (let param = 0; param < SOUND_PARAM_COUNT; param += 1) {
            const value = savedLive[param];
            if (!isInteger(value)) {
              continue;
            }
            memory.live[param] = clampTo(param, value);
          }
        } else {
          const values = memory.positions[memory.selected - 1];
          if (values !== undefined) {
            memory.live.set(values);
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
        live: Array.from(memory.live),
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

    stored(voice: Voice, position: number): Int32Array {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return new Int32Array(SOUND_PARAM_COUNT);
      }
      const values = memory.positions[position - 1];
      if (values === undefined) {
        return new Int32Array(SOUND_PARAM_COUNT);
      }
      return new Int32Array(values);
    },

    live(voice: Voice): Int32Array {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return new Int32Array(SOUND_PARAM_COUNT);
      }
      return new Int32Array(memory.live);
    },

    write(voice: Voice, param: SoundParam, value: number): void {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return;
      }
      const slot = SOUND_PARAMS.indexOf(param);
      if (slot < 0) {
        return;
      }
      /* The value is clamped to the range of the engine the way the
       * engine itself clamps it, so the live tone is what the engine
       * holds. The position that is picked is not touched by it: a tone is
       * only written into a position when the user holds the button of
       * that position down. */
      const table = defaults.get(voice);
      const low = table?.min[slot] ?? value;
      const high = table?.max[slot] ?? value;
      memory.live[slot] = clamp(value, low, high);
      save();
    },

    select(voice: Voice, position: number): boolean {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return false;
      }
      const slot = clamp(Math.round(position), 1, MEMORY_POSITIONS);
      if (slot === memory.selected) {
        /* The position that is picked is picked already: the selection
         * does not change, and a live tone that was not stored is not
         * thrown away by it. */
        return false;
      }
      memory.selected = slot;
      /* Picking another position brings the tone it holds back into the
       * module: a live tone that was not stored is lost here. */
      const values = memory.positions[slot - 1];
      if (values !== undefined) {
        memory.live.set(values);
      }
      save();
      return true;
    },

    store(voice: Voice, position: number): void {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return;
      }
      const slot = clamp(Math.round(position), 1, MEMORY_POSITIONS);
      /* The tone the module is playing is written into the position, and
       * the position becomes the one that is picked: the tone in the
       * module is the tone of the position from now on. */
      memory.positions[slot - 1] = new Int32Array(memory.live);
      memory.selected = slot;
      save();
    },

    pending(voice: Voice): boolean {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return false;
      }
      const values = memory.positions[memory.selected - 1];
      if (values === undefined) {
        return false;
      }
      for (let slot = 0; slot < SOUND_PARAM_COUNT; slot += 1) {
        if (memory.live[slot] !== values[slot]) {
          return true;
        }
      }
      return false;
    },

    modified(voice: Voice, position: number): boolean {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return false;
      }
      const slot = clamp(Math.round(position), 1, MEMORY_POSITIONS);
      const values = memory.positions[slot - 1];
      if (values === undefined) {
        return false;
      }
      const built = builtIn(voice, slot);
      for (let param = 0; param < SOUND_PARAM_COUNT; param += 1) {
        if (values[param] !== built[param]) {
          return true;
        }
      }
      return false;
    },

    resetSelected(voice: Voice): void {
      const memory = memories.get(voice);
      if (memory === undefined) {
        return;
      }
      const built = builtIn(voice, memory.selected);
      memory.positions[memory.selected - 1] = built;
      memory.live.set(built);
      save();
    },

    resetAll(): void {
      for (const [voice, memory] of memories) {
        memory.selected = 1;
        for (let position = 1; position <= MEMORY_POSITIONS; position += 1) {
          memory.positions[position - 1] = builtIn(voice, position);
        }
        memory.live.set(
          memory.positions[0] ?? new Int32Array(SOUND_PARAM_COUNT),
        );
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
