import type { Param } from '../audio/protocol';

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

/** The label and the scale of a knob. */
export function specFor(spec: KnobSpec): ParamSpec {
  return PARAM_SPECS[spec.param];
}
