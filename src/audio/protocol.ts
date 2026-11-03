/**
 * The messages between the engine (main thread) and the worklet (audio
 * thread), and the shape of the engine's own data.
 *
 * Everything on this boundary is the engine's own: Q16.16 physical units
 * (Hz, seconds, signed semitones, 0..1 balances) for the values, and the
 * library's own integers for the enums.
 */

/** The Q16.16 unit: 1.0 is this integer. */
export const Q16_ONE = 65536;

/**
 * The five voices of the kit, in the library's own order. A voice and its
 * instrument are the same thing here: the library maps the five voices to
 * the five instruments one to one.
 */
export const VOICES = ['kick', 'snare', 'tom1', 'tom2', 'tom3'] as const;
export type Voice = (typeof VOICES)[number];
export const VOICE_COUNT = VOICES.length;

/**
 * The nine parameters of a voice, in the library's own order. The first
 * six are the sound parameters a tone holds; the last three are the
 * mixer values of the channel.
 */
export const PARAMS = [
  'noisePitch',
  'tonePitch',
  'bend',
  'decay',
  'noiseTone',
  'clickTone',
  'volume',
  'pan',
  'sensitivity',
] as const;
export type Param = (typeof PARAMS)[number];
export const PARAM_COUNT = PARAMS.length;

/**
 * The sound parameters: the ones a tone holds, in the library's order. The
 * mixer values (volume, pan, sensitivity) are not part of a tone.
 */
export const SOUND_PARAMS = [
  'noisePitch',
  'tonePitch',
  'bend',
  'decay',
  'noiseTone',
  'clickTone',
] as const;
export type SoundParam = (typeof SOUND_PARAMS)[number];
export const SOUND_PARAM_COUNT = SOUND_PARAMS.length;

/** The instrument a trigger plays. */
export type Instrument = Voice;

export function voiceIndex(voice: Voice): number {
  return VOICES.indexOf(voice);
}

export function instrumentIndex(instrument: Instrument): number {
  return VOICES.indexOf(instrument);
}

export function paramIndex(param: Param): number {
  return PARAMS.indexOf(param);
}

/**
 * The parameter table of the engine: the range and the default of every
 * voice and parameter, as the engine itself reports them.
 */
export interface ParamInfo {
  readonly voice: number;
  readonly param: number;
  /** The lowest value the engine accepts, in Q16.16. */
  readonly min: number;
  /** The highest value the engine accepts, in Q16.16. */
  readonly max: number;
  /** The factory value, in Q16.16. */
  readonly default: number;
  /** Whether the engine supports the pair at all. */
  readonly supported: boolean;
}

/**
 * The state the engine reports: the values it holds, read back from the
 * engine itself. The panel never keeps a parallel copy of these.
 */
export interface EngineState {
  /** The value of every voice and parameter, voice by voice. */
  readonly values: Int32Array;
  /** 1 where the engine supports the voice and the parameter. */
  readonly supported: Uint8Array;
  /**
   * 1 while the voice is still sounding. The engine knows a voice is
   * sounding when it produces a signal, so the flag follows the level of
   * the instrument.
   */
  readonly sounding: Uint8Array;
  /**
   * The level of every instrument, in Q16.16, as the engine reports it for
   * the last rendered block: the peak of the instrument's own voice, after
   * its own volume and before the pan and the mix. The lamp of a module is
   * lit by the level of its own instrument.
   */
  readonly levels: Int32Array;
  /**
   * The brightness of the lamp of every instrument, from 0 to 1. The engine
   * reports the peak of a single block, so the worklet smooths it into the
   * fall of a lamp: the light comes up at once and goes out slowly.
   */
  readonly lamp: Float32Array;
  /** The version of the linked library, packed as 0x00MMmmpp. */
  readonly version: number;
  /** True while any voice is still sounding. */
  readonly active: boolean;
  /** The loudest sample of the last rendered block. */
  readonly peak: number;
}

/** The commands the main thread sends to the worklet. */
export type EngineCommand =
  /** Set one parameter of one voice. The value is in Q16.16. */
  | { type: 'param'; voice: number; param: number; value: number }
  /**
   * Write a whole tone: the six sound parameters of a voice, in the
   * library's order.
   */
  | { type: 'tone'; voice: number; values: number[] }
  /**
   * Play an instrument. The velocity is the MIDI strike level, 0..127.
   */
  | { type: 'trigger'; instrument: number; velocity: number }
  /** Restore the factory parameters and the mixer defaults. */
  | { type: 'reset' };

/** The events the worklet sends back. */
export type EngineEvent =
  | { type: 'ready'; info: ParamInfo[] }
  | { type: 'state'; state: EngineState }
  | { type: 'error'; message: string };
