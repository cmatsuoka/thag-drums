import {
  SCOPE_POINTS,
  fxParamIndex,
  type FxParam,
  type FxParamInfo,
} from '../audio/protocol';
import { fromQ16 } from '../audio/units';
import { createKnob, type Knob } from './knob';
import { appendScrews } from './screws';
import { speedStripe } from './speed-stripe';
import { printedWord } from './wordmark';

/**
 * The effects module: the FX plate.
 *
 * The module has a layout of its own: it has no sound column and no mixer
 * column. The controls of the kit's effects stand on the plate in two
 * clusters instead, one for the reverb and one for the gate, and each
 * cluster is a grid of knobs under the name of the effect.
 *
 * At the top of the plate stands a small display: it shows the waveform
 * of the output signal, the way a scope does. The trace comes from the
 * engine itself: the worklet keeps the last frames of the output and
 * hands the shape of them to the panel.
 *
 * The knobs are the engine's own shared FX bus: the four of the reverb and
 * the five of the gate. The ranges and the defaults are the engine's,
 * like everywhere else on the panel, and the module reads the values back
 * from the engine rather than keeping a copy of them.
 */

/**
 * A control of the effects module: one of the knobs of the plate.
 *
 * The range and the default do not stand here: they are the engine's own
 * and they come from its FX bus table.
 */
export interface FxControl {
  /** The name of the control on the panel, for the markup. */
  readonly id: string;
  /** The parameter of the engine's FX bus behind the control. */
  readonly param: FxParam;
  /** The label that is printed under the knob. */
  readonly label: string;
  /** The unit of the value, for the readout and the ARIA text. */
  readonly unit: string;
  /** How many decimals the readout shows. */
  readonly decimals: number;
}

/**
 * The reverb of the kit: the size of the room it is in, how much of the
 * high end it takes away, how wide it is and how much of it is heard.
 */
export const REVERB_CONTROLS: readonly FxControl[] = [
  {
    id: 'roomSize',
    param: 'roomSize',
    label: 'size',
    unit: '',
    decimals: 2,
  },
  {
    id: 'damp',
    param: 'damping',
    label: 'damp',
    unit: '',
    decimals: 2,
  },
  {
    id: 'width',
    param: 'width',
    label: 'width',
    unit: '',
    decimals: 2,
  },
  {
    id: 'level',
    param: 'wet',
    label: 'level',
    unit: '',
    decimals: 2,
  },
];

/**
 * The gate of the kit: the level it opens at, how much of the signal it
 * lets through, and the three times that shape its envelope.
 */
export const GATE_CONTROLS: readonly FxControl[] = [
  {
    id: 'threshold',
    param: 'gateThreshold',
    label: 'thrs',
    unit: '',
    decimals: 2,
  },
  {
    id: 'range',
    param: 'gateRange',
    label: 'range',
    unit: '',
    decimals: 2,
  },
  {
    id: 'attack',
    param: 'gateAttack',
    label: 'attack',
    unit: 's',
    decimals: 3,
  },
  {
    id: 'hold',
    param: 'gateHold',
    label: 'hold',
    unit: 's',
    decimals: 3,
  },
];

/** The release of the gate: it stands alone, in the middle of the plate. */
export const GATE_RELEASE: FxControl = {
  id: 'release',
  param: 'gateRelease',
  label: 'release',
  unit: 's',
  decimals: 3,
};

/** The size of the display of the module, in its own pixels. */
const SCOPE_WIDTH = 240;
const SCOPE_HEIGHT = 72;

export interface FxModule {
  /** The plate of the module, as it stands in the row of the panel. */
  readonly element: HTMLElement;
  /**
   * Build the knobs of the module from the engine's own FX bus table.
   * Until this is called the plate carries its two clusters and no knobs.
   */
  build(info: readonly FxParamInfo[]): void;
  /**
   * Show the values the engine holds for the shared FX bus, in Q16.16.
   */
  update(values: Int32Array): void;
  /**
   * Draw the waveform of the output signal on the display of the module.
   * The points are signed peaks, from the left to the right.
   */
  updateScope(scope: Float32Array): void;
  dispose(): void;
}

/**
 * Build the effects module: the plate, its display and its two clusters
 * of knobs.
 */
export function createFxModule(
  onFxParam: (param: FxParam, value: number) => void,
): FxModule {
  const element = document.createElement('section');
  element.className = 'strip strip-fx-module';
  element.dataset.place = 'fx';
  element.setAttribute('aria-label', 'FX module');

  /* Every module is a plate of its own, screwed to the case. */
  appendScrews(element, 'fx');

  const head = document.createElement('div');
  head.className = 'strip-head';

  /* The name of the module and the speed stripe that stands beside it:
   * they are one emblem, and they stand on the same line. The stripe is
   * a print on the plate and nothing more: it is not part of the name,
   * and the assistive technology skips it. */
  const nameplate = document.createElement('div');
  nameplate.className = 'fx-nameplate';

  const title = document.createElement('h2');
  title.className = 'strip-name';

  /* The name of the module is printed, not typed: it is the outline of
   * the word. The word itself stays in the markup, for the readers. */
  const spoken = document.createElement('span');
  spoken.className = 'visually-hidden';
  spoken.textContent = 'FX';

  title.append(printedWord('FX'), spoken);

  const stripe = document.createElement('span');
  stripe.className = 'fx-stripe-mark';
  stripe.setAttribute('aria-hidden', 'true');
  stripe.append(speedStripe());

  nameplate.append(title, stripe);
  head.append(nameplate);

  /* The display of the module: a small screen of the kind that shows the
   * shape of the signal. It stands at the top of the plate, under the
   * name of the module. */
  const display = document.createElement('div');
  display.className = 'fx-display';

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-scope';
  canvas.width = SCOPE_WIDTH;
  canvas.height = SCOPE_HEIGHT;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'the waveform of the output signal');

  display.append(canvas);

  const context = canvas.getContext('2d');
  const trace = new Float32Array(SCOPE_POINTS);

  /**
   * Draw the trace of the signal on the display.
   */
  const paint = (): void => {
    if (context === null) {
      return;
    }

    const width = SCOPE_WIDTH;
    const height = SCOPE_HEIGHT;
    const middle = height / 2;

    /* The glass of the display: it is dark, and the line of zero runs
     * through the middle of it. */
    context.fillStyle = '#04120a';
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(125, 251, 161, 0.16)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, middle + 0.5);
    context.lineTo(width, middle + 0.5);
    context.stroke();

    /* The trace itself: one point for every point of the waveform. */
    context.strokeStyle = '#7dfba1';
    context.lineWidth = 2;
    context.lineJoin = 'round';
    context.shadowColor = 'rgba(125, 251, 161, 0.65)';
    context.shadowBlur = 6;
    context.beginPath();

    for (let point = 0; point < trace.length; point += 1) {
      const value = trace[point] ?? 0;
      const x = ((point + 0.5) / trace.length) * width;
      const y = middle - value * (middle - 4);
      if (point === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.stroke();
    context.shadowBlur = 0;
  };

  const body = document.createElement('div');
  body.className = 'strip-body fx-body';

  /* The widget of a control of the module, with the place of its value in
   * the engine's FX bus snapshot. */
  interface FxWidget {
    readonly control: FxControl;
    readonly knob: Knob;
  }

  const widgets: FxWidget[] = [];
  const knobs: Knob[] = [];

  /* The parents the knobs are built into: the grid of a cluster, or the
   * row of the release. They are made with the plate, so the module has
   * its shape before the engine answers. */
  interface Placement {
    readonly parent: HTMLElement;
    readonly control: FxControl;
  }

  const placements: Placement[] = [];

  /**
   * Build a cluster of knobs: the name of the effect and its knobs, in a
   * grid of two columns. The knobs themselves come with the engine's
   * table.
   */
  const buildCluster = (
    name: string,
  ): { element: HTMLElement; grid: HTMLElement } => {
    const cluster = document.createElement('div');
    cluster.className = 'fx-cluster';

    const caption = document.createElement('span');
    caption.className = 'fx-caption';
    caption.textContent = name;

    const grid = document.createElement('div');
    grid.className = 'fx-grid';

    cluster.append(caption, grid);
    return { element: cluster, grid };
  };

  /* The reverb, under the display: a grid of two by two knobs, set on a
   * darkened square of the plate the way the speed stripe darkens it. */
  const reverb = buildCluster('reverb');
  reverb.element.classList.add('fx-cluster-reverb');
  body.append(reverb.element);
  for (const control of REVERB_CONTROLS) {
    placements.push({ parent: reverb.grid, control });
  }

  /* The gate, below it: a grid of two by two knobs, and the release on
   * its own, in the middle of the plate. It stands on a darkened
   * rectangle, like the reverb. */
  const gate = buildCluster('gate');
  gate.element.classList.add('fx-cluster-gate');
  for (const control of GATE_CONTROLS) {
    placements.push({ parent: gate.grid, control });
  }

  const releaseRow = document.createElement('div');
  releaseRow.className = 'fx-release';
  placements.push({ parent: releaseRow, control: GATE_RELEASE });

  gate.element.append(releaseRow);
  body.append(gate.element);

  /* The plate carries no mark of the machine at its foot: the module is
   * not an engine of its own, and the mark belongs to the ones that
   * are. */
  element.append(head, display, body);

  /* The display starts dark, with nothing on it. */
  paint();

  let built = false;

  /**
   * Build one knob of the module: the knob and the label that is printed
   * under it. The range and the default are the engine's own.
   */
  const buildKnob = (control: FxControl, info: FxParamInfo): HTMLElement => {
    const knob = createKnob({
      label: control.label,
      unit: control.unit,
      min: fromQ16(info.min),
      max: fromQ16(info.max),
      decimals: control.decimals,
      taper: 'linear',
      step: 0.02,
      fineStep: 0.002,
      value: fromQ16(info.default),
      onChange: (value) => {
        onFxParam(control.param, value);
      },
    });
    knobs.push(knob);
    widgets.push({ control, knob });

    const cell = document.createElement('div');
    cell.className = 'knob-cell';
    cell.dataset.control = control.id;
    knob.element.dataset.control = control.id;

    const label = document.createElement('span');
    label.className = 'knob-label';
    label.textContent = control.label;

    cell.append(knob.element, label);
    return cell;
  };

  return {
    element,

    build(info: readonly FxParamInfo[]): void {
      if (built) {
        return;
      }
      built = true;

      for (const placement of placements) {
        const entry = info.find(
          (item) => item.param === fxParamIndex(placement.control.param),
        );
        if (entry === undefined) {
          continue;
        }
        placement.parent.append(buildKnob(placement.control, entry));
      }
    },

    update(values: Int32Array): void {
      for (const widget of widgets) {
        const raw = values[fxParamIndex(widget.control.param)] ?? 0;
        widget.knob.setValue(fromQ16(raw));
        widget.knob.element.dataset.value = String(raw);
      }
    },

    updateScope(scope: Float32Array): void {
      const count = Math.min(scope.length, trace.length);
      for (let point = 0; point < count; point += 1) {
        trace[point] = scope[point] ?? 0;
      }
      paint();
    },

    dispose(): void {
      for (const knob of knobs) {
        knob.dispose();
      }
    },
  };
}
