import type { HiveEngine } from '../audio/engine';
import { INSTRUMENT_NAMES } from '../audio/keyboard';
import {
  PARAM_COUNT,
  VOICES,
  paramIndex,
  voiceIndex,
  type EngineState,
  type Param,
  type ParamInfo,
  type Voice,
} from '../audio/protocol';
import { fromQ16, toQ16 } from '../audio/units';
import {
  buildModuleExport,
  downloadModuleExport,
} from './export';
import { createFitter, type Fitter } from './fit';
import { createKnob, type Knob } from './knob';
import { MIX_KNOBS, STRIP_KNOBS, specFor, type KnobSpec } from './params';
import { printedWord } from './wordmark';

/**
 * The hardware panel: the faceplate with the five module strips.
 *
 * The panel is built from the engine's own table. The long knob column of
 * a strip and the shorter mixer column beside it come from the parameters
 * the engine supports for that voice, so the ranges of the knobs are the
 * ranges the engine reports. The mixer column carries the per-voice Volume
 * and Pan and the per-voice Sens, the strike sensitivity of the engine.
 *
 * The panel never keeps a copy of the values: it shows what the engine
 * holds, read back from the engine's own snapshot. A value the engine
 * clamped is shown clamped.
 */

export interface Panel {
  /** Restore the factory parameters. */
  reset(): void;
  dispose(): void;
}

/**
 * A knob of a strip, and the place of its value in the engine's snapshot.
 */
interface KnobWidget {
  /** The place of the value in the engine's parameter snapshot. */
  readonly index: number;
  readonly knob: Knob;
  readonly cell: HTMLElement;
}

interface StripWidgets {
  readonly voice: Voice;
  readonly triggerLamp: HTMLElement;
  readonly knobColumn: HTMLElement;
  readonly mixColumn: HTMLElement;
  readonly knobs: KnobWidget[];
  /** The control that writes the settings of the module to a file. */
  readonly exportButton: HTMLButtonElement;
}

function findInfo(
  info: readonly ParamInfo[],
  voice: Voice,
  param: number,
): ParamInfo | undefined {
  const v = voiceIndex(voice);
  return info.find((entry) => entry.voice === v && entry.param === param);
}

/**
 * The turn of the slot of a screw, in degrees.
 *
 * A screw is turned by a hand, and no two of them end up pointing the
 * same way. The turn of each screw is fixed by the place it has on the
 * panel: the machine looks the same on every load, and two renders of it
 * never differ.
 */
function screwAngle(voice: Voice, corner: string): number {
  const key = `${voice}/${corner}`;

  /* A hash of the place of the screw, so that every one of them gets a
   * turn of its own. */
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  /* One round of mixing, so that the screws that stand near each other
   * on the panel do not end up near each other in their turn. */
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;

  /* A slot has no head and no tail, so half a turn is the same as none. */
  return (hash >>> 0) % 180;
}

export function createPanel(host: HTMLElement, engine: HiveEngine): Panel {
  const fitHost = document.createElement('div');
  fitHost.className = 'console-fit';

  const faceplate = document.createElement('div');
  faceplate.className = 'faceplate';
  faceplate.setAttribute('role', 'group');
  faceplate.setAttribute('aria-label', 'the sound module');

  /* The row of module plates, and the rail of the case under them. */
  const plateRow = document.createElement('div');
  plateRow.className = 'faceplate-row';

  const rail = document.createElement('div');
  rail.className = 'faceplate-rail';

  const strips = new Map<Voice, StripWidgets>();

  for (const voice of VOICES) {
    const name = INSTRUMENT_NAMES[voice];

    const element = document.createElement('section');
    element.className = 'strip';
    element.dataset.voice = voice;
    element.setAttribute('aria-label', `${name} module`);

    /* Every module is a plate of its own, screwed to the case. */
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const screw = document.createElement('span');
      screw.className = `screw screw-${corner}`;
      screw.style.setProperty(
        '--screw-angle',
        `${screwAngle(voice, corner)}deg`,
      );
      screw.setAttribute('aria-hidden', 'true');
      element.append(screw);
    }

    const head = document.createElement('div');
    head.className = 'strip-head';

    const title = document.createElement('h2');
    title.className = 'strip-name';
    /* The name of the module is printed, not typed: it is the outline of
     * the word. The word itself stays in the markup, for the readers. */
    const spoken = document.createElement('span');
    spoken.className = 'visually-hidden';
    spoken.textContent = name;
    title.append(printedWord(name.toUpperCase()), spoken);

    const lamps = document.createElement('div');
    lamps.className = 'strip-lamps';

    const triggerLamp = document.createElement('span');
    triggerLamp.className = 'lamp lamp-trigger';
    triggerLamp.id = `lamp-${voice}-trigger`;
    triggerLamp.setAttribute('role', 'img');
    triggerLamp.setAttribute('aria-label', `${name}: silent`);

    lamps.append(triggerLamp);
    head.append(title, lamps);

    const knobColumn = document.createElement('div');
    knobColumn.className = 'strip-knobs';

    /* The second, shorter column of the module: the mixer of the channel. */
    const mixColumn = document.createElement('div');
    mixColumn.className = 'strip-mix';

    const body = document.createElement('div');
    body.className = 'strip-body';
    body.append(knobColumn, mixColumn);

    /* The mark at the foot of the plate: the model of the machine in a
     * rounded frame, the way the hardware carries the model's name at the
     * base of every module. It is a print on the plate and nothing more:
     * it is not a control, so the assistive technology skips it. */
    const mark = document.createElement('span');
    mark.className = 'strip-mark';

    const markText = printedWord('THAG-V');
    markText.setAttribute('class', 'strip-mark-text');

    mark.append(markText);
    mark.setAttribute('aria-hidden', 'true');

    element.append(head, body, mark);
    plateRow.append(element);

    /* The export control: it writes the settings the engine holds for
     * this module to a JSON file. It is a demo's own addition and not a
     * control of the hardware, so it stands on the rail of the case, under
     * the module it belongs to. */
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'strip-export';
    exportButton.dataset.voice = voice;
    exportButton.textContent = 'export';
    exportButton.setAttribute(
      'aria-label',
      `export the settings of the ${name} module`,
    );
    exportButton.addEventListener('click', () => {
      exportVoice(voice);
    });

    const railCell = document.createElement('div');
    railCell.className = 'faceplate-rail-cell';
    railCell.append(exportButton);
    rail.append(railCell);

    strips.set(voice, {
      voice,
      triggerLamp,
      knobColumn,
      mixColumn,
      knobs: [],
      exportButton,
    });
  }

  faceplate.append(plateRow, rail);
  fitHost.append(faceplate);
  host.append(fitHost);

  const fitter: Fitter = createFitter(fitHost, faceplate);

  let built = false;

  /* The last state the engine reported, and the controls it supports on
   * every voice: the export reads the settings from them. */
  let lastState: EngineState | null = null;
  const supportedParams = new Map<Voice, Param[]>();

  /**
   * Write the settings of a module to a JSON file.
   *
   * The values are the ones the engine holds, read from its own snapshot,
   * and only the controls the engine supports on that voice go into the
   * file.
   */
  const exportVoice = (voice: Voice): void => {
    const state = lastState;
    if (state === null) {
      return;
    }
    const supported = supportedParams.get(voice) ?? [];
    downloadModuleExport(
      voice,
      buildModuleExport(voice, state, supported),
    );
  };

  /**
   * Build one knob of a strip.
   *
   * The range of a knob is the range the engine reports. The user moved a
   * knob: the value goes to the engine, and the engine holds it. The panel
   * shows what the engine holds, so a value the engine clamped is shown
   * clamped.
   */
  const createWidget = (
    voice: Voice,
    spec: KnobSpec,
    range: { min: number; max: number; default: number },
  ): KnobWidget => {
    const meta = specFor(spec);
    const knob = createKnob({
      label: meta.label,
      unit: meta.unit,
      min: range.min,
      max: range.max,
      decimals: meta.decimals,
      taper: meta.taper,
      step: meta.step,
      fineStep: meta.fineStep,
      value: range.default,
      onChange: (value) => {
        engine.setParam(voice, spec.param, toQ16(value));
      },
    });

    const name = spec.param;
    knob.element.dataset.param = name;

    const cell = document.createElement('div');
    cell.className = 'knob-cell';
    cell.dataset.param = name;

    const label = document.createElement('span');
    label.className = 'knob-label';
    label.textContent = meta.label;

    cell.append(knob.element, label);

    const index = voiceIndex(voice) * PARAM_COUNT + paramIndex(spec.param);

    return { index, knob, cell };
  };

  /**
   * Build the knob columns of every strip from the engine's own table.
   */
  const build = (info: readonly ParamInfo[]): void => {
    if (built) {
      return;
    }
    built = true;

    for (const voice of VOICES) {
      const strip = strips.get(voice);
      if (strip === undefined) {
        continue;
      }

      /* The controls the engine supports on this voice: the export writes
       * these and nothing else. */
      const supported: Param[] = [];

      for (const spec of STRIP_KNOBS) {
        const index = paramIndex(spec.param);
        const entry = findInfo(info, voice, index);
        if (entry === undefined || !entry.supported) {
          // The engine does not have this control on this voice: it does
          // not go on the panel.
          continue;
        }

        const widget = createWidget(voice, spec, {
          min: fromQ16(entry.min),
          max: fromQ16(entry.max),
          default: fromQ16(entry.default),
        });
        strip.knobColumn.append(widget.cell);
        strip.knobs.push(widget);
        supported.push(spec.param);
      }

      /* The mixer of the channel, in its own shorter column. */
      for (const spec of MIX_KNOBS) {
        const entry = findInfo(info, voice, paramIndex(spec.param));
        if (entry === undefined || !entry.supported) {
          // The engine does not have this control on this voice: it does
          // not go on the panel.
          continue;
        }
        const range = {
          min: fromQ16(entry.min),
          max: fromQ16(entry.max),
          default: fromQ16(entry.default),
        };

        const widget = createWidget(voice, spec, range);
        strip.mixColumn.append(widget.cell);
        strip.knobs.push(widget);
        supported.push(spec.param);
      }

      supportedParams.set(voice, supported);
    }

    fitter.update();
  };
  const applyState = (state: EngineState): void => {
    lastState = state;

    for (const voice of VOICES) {
      const strip = strips.get(voice);
      if (strip === undefined) {
        continue;
      }

      for (const widget of strip.knobs) {
        const value = state.values[widget.index] ?? 0;
        widget.knob.setValue(fromQ16(value));
        widget.knob.element.dataset.value = String(value);
      }

      const index = voiceIndex(voice);

      /* The lamp of a module follows the signal of its own instrument.
       * The engine knows the level of every instrument before it sums the
       * voices into the mix, so the brightness of the lamp is the level of
       * that instrument alone, and the light is proportional to it. */
      const level = state.lamp[index] ?? 0;
      strip.triggerLamp.classList.toggle('is-lit', level > 0);
      strip.triggerLamp.style.setProperty('--lamp-level', level.toFixed(3));

      /* The label follows the engine: the lamp may still fade out after
       * the instrument has fallen silent. */
      const sounding = state.sounding[index] === 1;
      strip.triggerLamp.setAttribute(
        'aria-label',
        `${INSTRUMENT_NAMES[voice]}: ${sounding ? 'sounding' : 'silent'}`,
      );
    }
  };

  const unsubscribeReady = engine.onReady((info) => {
    build(info);
  });

  const unsubscribeState = engine.onState((state) => {
    applyState(state);
  });

  return {
    reset(): void {
      engine.reset();
    },

    dispose(): void {
      unsubscribeReady();
      unsubscribeState();
      for (const strip of strips.values()) {
        for (const widget of strip.knobs) {
          widget.knob.dispose();
        }
      }
      fitter.dispose();
      fitHost.remove();
    },
  };
}
