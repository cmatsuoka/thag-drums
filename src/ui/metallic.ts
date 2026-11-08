import { HIHAT_KNOBS, METALLIC_KNOBS, type KnobSpec } from './params';

/**
 * The two metallic modules: the Cymbal and the Hi-hat.
 *
 * Each is built from an engine of its own: the Cymbal from its strike and
 * sampled-loop engine, the Hi-hat from the metallic engine. The Cymbal
 * carries a Sweep and a Bend; the Hi-hat has neither, as its Bend and
 * Sweep are fixed at zero. Both carry the Pitch and the Color, the two
 * edges of their noise filter, and a Tone Pitch that is a factor between
 * 0 and 1 rather than a frequency in Hz. The panels of the two modules
 * carry the controls the engine has, and nothing else.
 *
 * The Hi-hat is one module with two instruments: the closed one and the
 * open one, which share the voice and its controls.
 */
export interface MetallicModule {
  /** The class of the plate: 'strip-hihat' or 'strip-cymbal'. */
  readonly plateClass: string;
  /** The place of the plate on the panel: the screws are turned for it. */
  readonly place: string;
  /** The long knob column of the module. */
  readonly knobs: readonly KnobSpec[];
}

/** The hi-hat module: the closed and the open hat share it. */
export const HIHAT_MODULE: MetallicModule = {
  plateClass: 'strip-hihat',
  place: 'hihat',
  knobs: HIHAT_KNOBS,
};

/** The cymbal module. */
export const CYMBAL_MODULE: MetallicModule = {
  plateClass: 'strip-cymbal',
  place: 'cymbal',
  knobs: METALLIC_KNOBS,
};
