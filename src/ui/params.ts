import type { Param, Voice } from '../audio/protocol';

/**
 * The panel's own description of the engine's parameters.
 *
 * The ranges are not here: they come from the engine's own parameter
 * table, so a knob's scale never drifts from the engine. What lives here
 * is what the panel knows on its own: the label that is printed on the
 * faceplate, the unit of the value, the taper of the knob and the step of
 * the keyboard.
 */

/** How the knob travel maps onto the value. */
export type Taper = 'linear' | 'log';

export interface ParamSpec {
  /** The label that is printed under the knob. */
  readonly label: string;
  /** The unit of the value, for the readout and the ARIA text. */
  readonly unit: string;
  /** The taper between the knob travel and the value. */
  readonly taper: Taper;
  /** How many decimals the readout shows. */
  readonly decimals: number;
  /** The step of the arrow keys, as a share of the knob travel. */
  readonly step: number;
  /** The step of the arrow keys with the shift key held down. */
  readonly fineStep: number;
}

/**
 * The taper follows the unit: a pitch and a decay time are perceived
 * logarithmically, a balance and a bend linearly.
 *
 * The labels are printed in lower case, in the same font as the names of
 * the modules.
 */
export const PARAM_SPECS: Readonly<Record<Param, ParamSpec>> = {
  noisePitch: {
    label: 'noise',
    unit: 'Hz',
    taper: 'log',
    decimals: 0,
    step: 0.02,
    fineStep: 0.002,
  },
  tonePitch: {
    label: 'tone',
    unit: 'Hz',
    taper: 'log',
    decimals: 0,
    step: 0.02,
    fineStep: 0.002,
  },
  bend: {
    label: 'bend',
    unit: 'st',
    taper: 'linear',
    decimals: 1,
    step: 0.01,
    fineStep: 0.001,
  },
  decay: {
    label: 'decay',
    unit: 's',
    taper: 'log',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  noiseTone: {
    label: 'noise/tone',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  clickTone: {
    label: 'click/drum',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  sweep: {
    label: 'sweep',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  bellCymbal: {
    label: 'bell/cym',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  volume: {
    label: 'vol',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  pan: {
    label: 'pan',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  sensitivity: {
    label: 'sens',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
  fxSend: {
    label: 'fx',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
};

/**
 * The voices of the metallic engine: the Cymbal and the Hi-hat.
 *
 * The metallic voices are built from another engine than the drums, and
 * two of their controls mean something else there.
 */
export const METALLIC_VOICES: readonly Voice[] = ['cymbal', 'hihat'];

/**
 * The controls of the metallic voices, where they differ from the drum
 * voices.
 *
 * The Tone Pitch of a metallic voice scales the bank of its ten
 * oscillators: it is a factor between 0 and 1, not a frequency in Hz. The
 * Bend of a metallic voice sweeps that bank, in semitones, and the Sweep
 * is the contour of the noise filter, signed: a positive sweep closes the
 * filter as the sound dies, a negative one opens it.
 */
export const METALLIC_PARAM_SPECS: Readonly<
  Partial<Record<Param, ParamSpec>>
> = {
  tonePitch: {
    label: 'tone',
    unit: '',
    taper: 'linear',
    decimals: 2,
    step: 0.02,
    fineStep: 0.002,
  },
};

/**
 * A knob of a module strip: one of the engine's own parameters.
 */
export interface KnobSpec {
  readonly kind: 'param';
  readonly param: Param;
}

/**
 * The long knob column of a module strip, in the order of the hardware:
 * Noise, Tone, Bend, Decay, Noise/Tone and Click/Drum.
 *
 * The strip is built from this list and from the engine's own table: a
 * knob the engine does not support is not on the panel.
 */
export const STRIP_KNOBS: readonly KnobSpec[] = [
  { kind: 'param', param: 'noisePitch' },
  { kind: 'param', param: 'tonePitch' },
  { kind: 'param', param: 'bend' },
  { kind: 'param', param: 'decay' },
  { kind: 'param', param: 'noiseTone' },
  { kind: 'param', param: 'clickTone' },
];

/**
 * The long knob column of a metallic module, in the order of the engine's
 * own parameters.
 *
 * The metallic voices carry their own six controls: the Sweep is the
 * contour of the noise filter, the Tone Pitch scales the bank of the
 * oscillators, the Bend sweeps that bank, the Decay is the release of the
 * envelope, the Noise/Tone is the tone amount of the noise and the
 * Bell/Cymbal is the balance between the bank and the noise.
 */
export const METALLIC_KNOBS: readonly KnobSpec[] = [
  { kind: 'param', param: 'sweep' },
  { kind: 'param', param: 'tonePitch' },
  { kind: 'param', param: 'bend' },
  { kind: 'param', param: 'decay' },
  { kind: 'param', param: 'noiseTone' },
  { kind: 'param', param: 'bellCymbal' },
];

/**
 * The second, shorter column of a module: the mixer of the channel.
 *
 * Volume, Pan and Sens are the engine's own per-voice channel controls,
 * Sens being the strike sensitivity of the voice. The three sit together
 * in their own column, so the sound knobs of the module stay together and
 * the channel's controls are found in one place.
 */
export const MIX_KNOBS: readonly KnobSpec[] = [
  { kind: 'param', param: 'volume' },
  { kind: 'param', param: 'pan' },
  { kind: 'param', param: 'sensitivity' },
];


/**
 * The label and the scale of a knob.
 *
 * A control of a metallic voice is described by its own spec: the same
 * parameter of a drum voice means something else there.
 */
export function specFor(spec: KnobSpec, voice?: Voice): ParamSpec {
  if (voice !== undefined && METALLIC_VOICES.includes(voice)) {
    const metallic = METALLIC_PARAM_SPECS[spec.param];
    if (metallic !== undefined) {
      return metallic;
    }
  }
  return PARAM_SPECS[spec.param];
}
