import type { Voice } from '../audio/protocol';
import { METALLIC_KNOBS, type KnobSpec } from './params';

/**
 * The two metallic modules: the Cymbal and the Hi-hat.
 *
 * They are built from the metallic engine of the library, which has its
 * own controls: the bank of its oscillators is scaled by the Tone Pitch
 * instead of naming a frequency, it computes no pitch sweep, and its
 * envelope has an attack of its own. The panels of the two modules carry
 * the controls the engine has, and nothing else.
 *
 * The Hi-hat is one module with two instruments: the closed one and the
 * open one, which share the voice and its controls.
 */
export interface MetallicModule {
  /** The voice of the module: the one the engine holds the controls of. */
  readonly voice: Voice;
  /** The class of the plate: 'strip-hihat' or 'strip-cymbal'. */
  readonly plateClass: string;
  /** The place of the plate on the panel: the screws are turned for it. */
  readonly place: string;
  /** The long knob column of the module. */
  readonly knobs: readonly KnobSpec[];
}

/** The hi-hat module: the closed and the open hat share it. */
export const HIHAT_MODULE: MetallicModule = {
  voice: 'hihat',
  plateClass: 'strip-hihat',
  place: 'hihat',
  knobs: METALLIC_KNOBS,
};

/** The cymbal module. */
export const CYMBAL_MODULE: MetallicModule = {
  voice: 'cymbal',
  plateClass: 'strip-cymbal',
  place: 'cymbal',
  knobs: METALLIC_KNOBS,
};
