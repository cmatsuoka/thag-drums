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
  sweep: {
    label: 'sweep',
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
};

/**
 * The knob column of a module strip, in the order of the hardware: Noise,
 * Tone, Bend, Decay, Noise/Tone, Click/Drum and Sweep, which only the
 * Snare has, plus Pan, which is the demo's own addition, at the bottom.
 *
 * The strip is built from this list and from the engine's own table: a
 * knob the engine does not support is not on the panel.
 */
export interface KnobSpec {
  readonly param: Param;
}

export const STRIP_KNOBS: readonly KnobSpec[] = [
  { param: 'noisePitch' },
  { param: 'tonePitch' },
  { param: 'bend' },
  { param: 'decay' },
  { param: 'noiseTone' },
  { param: 'clickTone' },
  { param: 'sweep' },
  { param: 'pan' },
];
