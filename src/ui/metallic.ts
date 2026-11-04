import { createKnob, type Knob } from './knob';
import type { Taper } from './params';
import { appendScrews } from './screws';
import { printedWord } from './wordmark';

/**
 * The metallic modules: the faceplates of two instruments the engine does
 * not have yet.
 *
 * The modules draw every part of themselves the way the instrument
 * modules do — the printed name, the lamp, the two knob columns and the
 * mark at the foot of the plate — but they are not wired to anything:
 * the knobs turn and hold their values, and nothing reaches the engine,
 * which has neither a hi-hat voice nor a cymbal voice. The lamp never
 * lights and the rail under the modules carries no export control.
 * Ranges and tapers follow the specification of the metallic voices; the
 * two modules differ only in their defaults and their names.
 */

interface MetallicKnobSpec {
  readonly param: string;
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly decimals: number;
  readonly taper: Taper;
  readonly step: number;
  readonly fineStep: number;
}

/* The sound knobs, in the order of the module: sweep, tone, bend,
 * decay, noise/tone and bell/cym. The metallic modules have no
 * noise-pitch knob, unlike the drum voices. Tone Pitch is a scale
 * factor of the metallic bank, not a frequency in Hz; Sweep is
 * bipolar. */
const SOUND_KNOBS: readonly MetallicKnobSpec[] = [
  { param: 'sweep', label: 'sweep', unit: '', min: -1, max: 1, decimals: 2, taper: 'linear', step: 0.02, fineStep: 0.002 },
  { param: 'tone', label: 'tone', unit: '', min: 0, max: 1, decimals: 2, taper: 'linear', step: 0.02, fineStep: 0.002 },
  { param: 'bend', label: 'bend', unit: 'st', min: -48, max: 48, decimals: 1, taper: 'linear', step: 0.01, fineStep: 0.001 },
  { param: 'decay', label: 'decay', unit: 's', min: 0.1, max: 3, decimals: 2, taper: 'log', step: 0.02, fineStep: 0.002 },
  { param: 'noiseTone', label: 'noise/tone', unit: '', min: 0, max: 1, decimals: 2, taper: 'linear', step: 0.02, fineStep: 0.002 },
  { param: 'bellCym', label: 'bell/cym', unit: '', min: 0, max: 1, decimals: 2, taper: 'linear', step: 0.02, fineStep: 0.002 },
];

/* The mixer column of the channel: the same three controls the other
 * modules carry, as small knobs. */
const MIX_KNOBS: readonly MetallicKnobSpec[] = [
  { param: 'volume', label: 'vol', unit: '', min: 0, max: 1, decimals: 2, taper: 'linear', step: 0.02, fineStep: 0.002 },
  { param: 'pan', label: 'pan', unit: '', min: -1, max: 1, decimals: 2, taper: 'linear', step: 0.02, fineStep: 0.002 },
  { param: 'sensitivity', label: 'sens', unit: '', min: 0, max: 1, decimals: 2, taper: 'linear', step: 0.02, fineStep: 0.002 },
];

const MIXER_DEFAULTS = { volume: 0.8, pan: 0, sensitivity: 1 } as const;

export interface MetallicModuleOptions {
  /** The place of the plate on the panel: 'hihat' or 'cymbal'. */
  readonly place: string;
  /** The class of the plate: 'strip-hihat' or 'strip-cymbal'. */
  readonly plateClass: string;
  /** The word to print, as it is printed: 'HI HAT' or 'CYMBAL'. */
  readonly wordmark: string;
  /** The word the assistive technology reads: 'Hi-Hat' or 'Cymbal'. */
  readonly spokenName: string;
  /** The label of the section for the assistive technology. */
  readonly ariaLabel: string;
  /** The position the knobs rest at when the page loads. */
  readonly values: Readonly<Record<string, number>>;
}

export interface MetallicModule {
  readonly element: HTMLElement;
  /** The cell of the rail under the module: empty, the module exports nothing. */
  readonly railCell: HTMLElement;
}

function knobCell(
  spec: MetallicKnobSpec,
  value: number,
): HTMLElement {
  const knob: Knob = createKnob({
    label: spec.label,
    unit: spec.unit,
    min: spec.min,
    max: spec.max,
    decimals: spec.decimals,
    taper: spec.taper,
    step: spec.step,
    fineStep: spec.fineStep,
    value,
    // The metallic voices are not wired to the engine yet: the knob
    // turns and holds its value, and nothing is sent anywhere.
    onChange: () => {
      /* unwired */
    },
  });
  knob.element.dataset.param = spec.param;

  const cell = document.createElement('div');
  cell.className = 'knob-cell';
  cell.dataset.param = spec.param;

  const label = document.createElement('span');
  label.className = 'knob-label';
  label.textContent = spec.label;

  cell.append(knob.element, label);
  return cell;
}

export function createMetallicModule(
  options: MetallicModuleOptions,
): MetallicModule {
  const element = document.createElement('section');
  element.className = `strip ${options.plateClass}`;
  element.dataset.place = options.place;
  element.setAttribute('aria-label', options.ariaLabel);

  appendScrews(element, options.place);

  const head = document.createElement('div');
  head.className = 'strip-head';

  const title = document.createElement('h2');
  title.className = 'strip-name';
  /* The name of the module is printed, not typed: it is the outline of
   * the word. The word itself stays in the markup, for the readers. */
  const spoken = document.createElement('span');
  spoken.className = 'visually-hidden';
  spoken.textContent = options.spokenName;
  title.append(printedWord(options.wordmark), spoken);

  const lamps = document.createElement('div');
  lamps.className = 'strip-lamps';

  /* The voice does not exist in the engine, so no level ever reaches
   * the lamp: it is drawn as part of the faceplate and it never lights. */
  const lamp = document.createElement('span');
  lamp.className = 'lamp lamp-trigger';
  lamp.setAttribute('aria-hidden', 'true');

  lamps.append(lamp);
  head.append(title, lamps);

  const knobColumn = document.createElement('div');
  knobColumn.className = 'strip-knobs';
  for (const spec of SOUND_KNOBS) {
    knobColumn.append(knobCell(spec, options.values[spec.param] ?? 0));
  }

  const mixColumn = document.createElement('div');
  mixColumn.className = 'strip-mix';
  for (const spec of MIX_KNOBS) {
    const defaults = MIXER_DEFAULTS as Record<string, number>;
    mixColumn.append(knobCell(spec, defaults[spec.param] ?? 0));
  }

  const body = document.createElement('div');
  body.className = 'strip-body';
  body.append(knobColumn, mixColumn);

  const mark = document.createElement('span');
  mark.className = 'strip-mark';

  const markText = printedWord('THAG-V');
  markText.setAttribute('class', 'strip-mark-text');

  mark.append(markText);
  mark.setAttribute('aria-hidden', 'true');

  element.append(head, body, mark);

  const railCell = document.createElement('div');
  railCell.className = 'faceplate-rail-cell';
  railCell.setAttribute('aria-hidden', 'true');

  return { element, railCell };
}

/** The hi-hat module: the faceplate of an instrument the engine does not
 * have yet. The defaults are the hi-hat's own. */
export function createHiHatModule(): MetallicModule {
  return createMetallicModule({
    place: 'hihat',
    plateClass: 'strip-hihat',
    wordmark: 'HI HAT',
    spokenName: 'Hi-Hat',
    ariaLabel: 'Hi-hat module, not connected',
    values: {
      sweep: 0,
      tone: 1,
      bend: 0,
      decay: 1,
      noiseTone: 0.2,
      bellCym: 0.5,
    },
  });
}

/** The cymbal module: the faceplate of an instrument the engine does not
 * have yet. The defaults are the cymbal's own. */
export function createCymbalModule(): MetallicModule {
  return createMetallicModule({
    place: 'cymbal',
    plateClass: 'strip-cymbal',
    wordmark: 'CYMBAL',
    spokenName: 'Cymbal',
    ariaLabel: 'Cymbal module, not connected',
    values: {
      sweep: 0.7,
      tone: 0.6,
      bend: 10,
      decay: 3,
      noiseTone: 0.5,
      bellCym: 0.5,
    },
  });
}
