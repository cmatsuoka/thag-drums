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
 * The seven voices of the kit, in the library's own order: the five drum
 * voices and the two metallic ones, the Cymbal and the Hi-hat.
 */
export const VOICES = [
  'kick',
  'snare',
  'tom1',
  'tom2',
  'tom3',
  'cymbal',
  'hihat',
] as const;
export type Voice = (typeof VOICES)[number];
export const VOICE_COUNT = VOICES.length;

/**
 * The twelve parameters of a voice, in the library's own order. The first
 * eight are the sound parameters a tone holds; the last three are the
 * mixer values of the channel, and the last one is the share of the voice
 * that goes to the effects bus of the kit. The Sweep and the Bell/Cymbal
 * belong to the metallic voices; the Noise and the Click/Drum to the drum
 * voices.
 */
export const PARAMS = [
  'noisePitch',
  'tonePitch',
  'bend',
  'decay',
  'noiseTone',
  'clickTone',
  'sweep',
  'bellCymbal',
  'volume',
  'pan',
  'sensitivity',
  'fxSend',
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
  'sweep',
  'bellCymbal',
] as const;
export type SoundParam = (typeof SOUND_PARAMS)[number];
export const SOUND_PARAM_COUNT = SOUND_PARAMS.length;

/**
 * The nine parameters of the shared FX bus, in the library's own order:
 * the four of the reverb and the five of the gate.
 */
export const FX_PARAMS = [
  'roomSize',
  'damping',
  'width',
  'wet',
  'gateThreshold',
  'gateAttack',
  'gateHold',
  'gateRelease',
  'gateRange',
] as const;
export type FxParam = (typeof FX_PARAMS)[number];
export const FX_PARAM_COUNT = FX_PARAMS.length;

export function fxParamIndex(param: FxParam): number {
  return FX_PARAMS.indexOf(param);
}

/**
 * The FX bus table of the engine: the range and the default of every bus
 * parameter, as the engine itself reports them.
 */
export interface FxParamInfo {
  /** The place of the parameter in the library's own order. */
  readonly param: number;
  /** The lowest value the engine accepts, in Q16.16. */
  readonly min: number;
  /** The highest value the engine accepts, in Q16.16. */
  readonly max: number;
  /** The factory value, in Q16.16. */
  readonly default: number;
}

/**
 * The eight instruments a trigger can play, in the library's own order.
 *
 * The Hi-hat is one voice reached through two instruments: the closed one
 * and the open one, which shares the voice, its parameters and its mixer
 * values. The other six instruments map to the voice of the same name.
 */
export const INSTRUMENTS = [
  'kick',
  'snare',
  'tom1',
  'tom2',
  'tom3',
  'cymbal',
  'hihatClosed',
  'hihatOpen',
] as const;
export type Instrument = (typeof INSTRUMENTS)[number];
export const INSTRUMENT_COUNT = INSTRUMENTS.length;

/**
 * The instruments of every voice: the lamps of a module are lit by the
 * level of the instruments of its own voice, and the Hi-hat has two of
 * them.
 */
export const VOICE_INSTRUMENTS: Readonly<
  Record<Voice, readonly Instrument[]>
> = {
  kick: ['kick'],
  snare: ['snare'],
  tom1: ['tom1'],
  tom2: ['tom2'],
  tom3: ['tom3'],
  cymbal: ['cymbal'],
  hihat: ['hihatClosed', 'hihatOpen'],
};

export function voiceIndex(voice: Voice): number {
  return VOICES.indexOf(voice);
}

export function instrumentIndex(instrument: Instrument): number {
  return INSTRUMENTS.indexOf(instrument);
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
 * The number of points of the scope trace: the points of the waveform of
 * the output signal that the effects module draws on its display.
 */
export const SCOPE_POINTS = 64;

/**
 * The state the engine reports: the values it holds, read back from the
 * engine itself. The panel never keeps a parallel copy of these.
 */
export interface EngineState {
  /** The value of every voice and parameter, voice by voice. */
  readonly values: Int32Array;
  /** 1 where the engine supports the voice and the parameter. */
  readonly supported: Uint8Array;
  /** The value of every parameter of the shared FX bus, in Q16.16. */
  readonly fx: Int32Array;
  /**
   * The waveform of the output signal, as the scope of the effects module
   * draws it: one signed peak per point, from the left to the right.
   */
  readonly scope: Float32Array;
  /**
   * 1 while the instrument is still sounding. The engine knows an
   * instrument is sounding when it produces a signal, so the flag follows
   * the level of the instrument.
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
   * fall of a lamp: the light comes up at once and goes out slowly. The
   * lamp of a module is lit by the brightest of the instruments of its
   * own voice.
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
  /** Set one parameter of the shared FX bus. The value is in Q16.16. */
  | { type: 'fx'; param: number; value: number }
  /**
   * Set the FX send of one instrument. The value is in Q16.16, and the
   * engine maps the instrument to the voice that owns its send.
   */
  | { type: 'fxSend'; instrument: number; value: number }
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
  | { type: 'ready'; info: ParamInfo[]; fxInfo: FxParamInfo[] }
  | { type: 'state'; state: EngineState }
  | { type: 'error'; message: string };
