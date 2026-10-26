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
import { createFitter, type Fitter } from './fit';
import { createKnob, type Knob } from './knob';
import { PARAM_SPECS, STRIP_KNOBS } from './params';

/**
 * The hardware panel: the faceplate with the five module strips.
 *
 * The panel is built from the engine's own table. The knob column of a
 * strip comes from the parameters the engine supports for that voice, so
 * only the Snare has a Sweep knob, and the ranges of the knobs are the
 * ranges the engine reports.
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

interface KnobWidget {
  readonly param: Param;
  /** The place of the value in the engine's snapshot. */
  readonly index: number;
  readonly knob: Knob;
}

interface StripWidgets {
  readonly voice: Voice;
  readonly triggerLamp: HTMLElement;
  readonly knobColumn: HTMLElement;
  readonly knobs: KnobWidget[];
}

function findInfo(
  info: readonly ParamInfo[],
  voice: Voice,
  param: number,
): ParamInfo | undefined {
  const v = voiceIndex(voice);
  return info.find((entry) => entry.voice === v && entry.param === param);
}

export function createPanel(host: HTMLElement, engine: HiveEngine): Panel {
  const fitHost = document.createElement('div');
  fitHost.className = 'console-fit';

  const faceplate = document.createElement('div');
  faceplate.className = 'faceplate';
  faceplate.setAttribute('role', 'group');
  faceplate.setAttribute('aria-label', 'the sound module');

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
      screw.setAttribute('aria-hidden', 'true');
      element.append(screw);
    }

    const head = document.createElement('div');
    head.className = 'strip-head';

    const title = document.createElement('h2');
    title.className = 'strip-name';
    title.textContent = name;

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

    element.append(head, knobColumn);
    faceplate.append(element);

    strips.set(voice, {
      voice,
      triggerLamp,
      knobColumn,
      knobs: [],
    });
  }

  fitHost.append(faceplate);
  host.append(fitHost);

  const fitter: Fitter = createFitter(fitHost, faceplate);

  let built = false;

  /**
   * The user moved a knob: the value goes to the engine, and the engine
   * holds it. The panel shows what the engine holds, so a value the
   * engine clamped is shown clamped.
   */
  const onKnobChange = (voice: Voice, param: Param, value: number): void => {
    engine.setParam(voice, param, toQ16(value));
  };

  /**
   * Build the knob column of every strip from the engine's own table.
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

      for (const spec of STRIP_KNOBS) {
        const index = paramIndex(spec.param);
        const entry = findInfo(info, voice, index);
        if (entry === undefined || !entry.supported) {
          // The engine does not have this control on this voice: it does
          // not go on the panel.
          continue;
        }

        const meta = PARAM_SPECS[spec.param];
        const knob = createKnob({
          label: meta.label,
          unit: meta.unit,
          min: fromQ16(entry.min),
          max: fromQ16(entry.max),
          decimals: meta.decimals,
          taper: meta.taper,
          step: meta.step,
          fineStep: meta.fineStep,
          value: fromQ16(entry.default),
          onChange: (value) => {
            onKnobChange(voice, spec.param, value);
          },
        });
        knob.element.dataset.param = spec.param;

        const cell = document.createElement('div');
        cell.className = 'knob-cell';
        cell.dataset.param = spec.param;

        const label = document.createElement('span');
        label.className = 'knob-label';
        label.textContent = meta.label;

        cell.append(knob.element, label);
        strip.knobColumn.append(cell);

        strip.knobs.push({
          param: spec.param,
          index: voiceIndex(voice) * PARAM_COUNT + index,
          knob,
        });
      }
    }

    fitter.update();
  };
  const applyState = (state: EngineState): void => {
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

      const sounding = state.sounding[voiceIndex(voice)] === 1;
      strip.triggerLamp.classList.toggle('is-lit', sounding);
      strip.triggerLamp.setAttribute(
        'aria-label',
        `${INSTRUMENT_NAMES[voice]}: ${sounding ? 'sounding' : 'silent'}`,
      );

      // The lamp glows with the level of the voice's own last hit.
      const level = (state.levels[voiceIndex(voice)] ?? 0) / 255;
      strip.triggerLamp.style.setProperty(
        '--lamp-level',
        (0.35 + 0.65 * level).toFixed(3),
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
