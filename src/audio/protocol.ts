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
 * seven are the sound parameters a tone holds; the last two are the mixer
 * values.
 */
export const PARAMS = [
  'noisePitch',
  'tonePitch',
  'bend',
  'decay',
  'noiseTone',
  'clickTone',
  'sweep',
  'volume',
  'pan',
] as const;
export type Param = (typeof PARAMS)[number];
export const PARAM_COUNT = PARAMS.length;

/**
 * The sound parameters: the ones a tone holds, in the library's order. The
 * mixer values (volume, pan) are not part of a tone.
 */
export const SOUND_PARAMS = [
  'noisePitch',
  'tonePitch',
  'bend',
  'decay',
  'noiseTone',
  'clickTone',
  'sweep',
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
   * 1 while the voice is still sounding. The engine has no per-voice
   * activity query, so the worklet derives it from the trigger and from
   * the decay time of the voice.
   */
  readonly sounding: Uint8Array;
  /**
   * The level of the voice's own last hit, from 0 to 255. The engine
   * mixes the voices into one signal, so the level of a single voice is
   * the level of the mix right after that voice was hit.
   */
  readonly levels: Uint8Array;
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
  /** Write a whole tone: the seven sound parameters of a voice, in the
   * library's order. */
  | { type: 'tone'; voice: number; values: number[] }
  /** Play an instrument. The strength is in Q16.16. */
  | { type: 'trigger'; instrument: number; strength: number }
  /** The trigger sensitivity of a channel, in Q16.16. */
  | { type: 'sens'; voice: number; threshold: number }
  /** Restore the factory parameters and the mixer defaults. */
  | { type: 'reset' };

/** The events the worklet sends back. */
export type EngineEvent =
  | { type: 'ready'; info: ParamInfo[] }
  | { type: 'state'; state: EngineState }
  | { type: 'error'; message: string };
