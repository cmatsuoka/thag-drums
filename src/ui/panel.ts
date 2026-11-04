import type { HiveEngine } from '../audio/engine';
import {
  PARAM_COUNT,
  VOICE_INSTRUMENTS,
  instrumentIndex,
  paramIndex,
  voiceIndex,
  type EngineState,
  type Instrument,
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
import { createFxModule } from './fx';
import { CYMBAL_MODULE, HIHAT_MODULE } from './metallic';
import { createKnob, type Knob } from './knob';
import { MODULE_NAMES } from './names';
import {
  FX_SPEC,
  MIX_KNOBS,
  STRIP_KNOBS,
  specFor,
  type KnobSpec,
} from './params';
import { appendScrews } from './screws';
import { printedWord } from './wordmark';

/**
 * The hardware panel: the faceplate with the module strips.
 *
 * The panel is built from the engine's own table. The long knob column of
 * a strip and the shorter mixer column beside it come from the parameters
 * the engine supports for that voice, so the ranges of the knobs are the
 * ranges the engine reports. The mixer column carries the per-voice
 * Volume and Pan and the per-voice Sens, the strike sensitivity of the
 * engine.
 *
 * The panel never keeps a copy of the values: it shows what the engine
 * holds, read back from the engine's own snapshot. A value the engine
 * clamped is shown clamped.
 *
 * Under the mixer knobs of every module stands a small trigger button: it
 * plays the module's own voice, the way a key of the keyboard does.
 *
 * The hi-hat module stands at the end of the row, and the effects module
 * after it: the hi-hat is the metallic voice of the engine, and the
 * effects module carries the controls of the kit's effects, which the
 * engine has no bus for.
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
  readonly triggerLamp: HTMLElement;
  readonly knobColumn: HTMLElement;
  readonly mixColumn: HTMLElement;
  readonly knobs: KnobWidget[];
  /** The control that writes the settings of the module to a file. */
  readonly exportButton: HTMLButtonElement;
  /** The control that puts the knobs of the module back to their defaults. */
  readonly resetButton: HTMLButtonElement;
  /** The effects knob of the module. It is not wired to anything yet. */
  readonly fxKnob: Knob;
}

/**
 * A module of the panel: a voice of the engine and the plate it is
 * printed on.
 */
interface ModuleDescriptor {
  /** The class of the plate, on top of the class of every module. */
  readonly plateClass: string;
  /** The place of the plate: the screws of the plate are turned for it. */
  readonly place: string;
  /** The long knob column of the module. */
  readonly soundKnobs: readonly KnobSpec[];
}

/**
 * The order of the modules on the panel: the five drums, the hi-hat and
 * the effects module at the end of the row.
 *
 * The Cymbal has no plate of its own for now: the engine still has the
 * voice, and it is still played from the keyboard and from a MIDI
 * controller, but the panel carries no faceplate for it.
 */
const PANEL_ORDER: readonly Voice[] = [
  'kick',
  'snare',
  'tom1',
  'tom2',
  'tom3',
  'hihat',
];

/**
 * The modules of the panel.
 *
 * The drums carry the six sound knobs of the hardware; the metallic
 * modules carry the controls their engine has.
 */
const MODULES: Readonly<Record<Voice, ModuleDescriptor>> = {
  kick: { plateClass: '', place: 'kick', soundKnobs: STRIP_KNOBS },
  snare: { plateClass: '', place: 'snare', soundKnobs: STRIP_KNOBS },
  tom1: { plateClass: '', place: 'tom1', soundKnobs: STRIP_KNOBS },
  tom2: { plateClass: '', place: 'tom2', soundKnobs: STRIP_KNOBS },
  tom3: { plateClass: '', place: 'tom3', soundKnobs: STRIP_KNOBS },
  hihat: {
    plateClass: HIHAT_MODULE.plateClass,
    place: HIHAT_MODULE.place,
    soundKnobs: HIHAT_MODULE.knobs,
  },
  cymbal: {
    plateClass: CYMBAL_MODULE.plateClass,
    place: CYMBAL_MODULE.place,
    soundKnobs: CYMBAL_MODULE.knobs,
  },
};

/**
 * The instrument the trigger button of a module plays.
 *
 * The Hi-hat module stands for two instruments: the button plays the
 * closed one, the way the key of the closed hat does.
 */
const TRIGGER_INSTRUMENT: Readonly<Record<Voice, Instrument>> = {
  kick: 'kick',
  snare: 'snare',
  tom1: 'tom1',
  tom2: 'tom2',
  tom3: 'tom3',
  cymbal: 'cymbal',
  hihat: 'hihatClosed',
};

/**
 * How long the reset button of a module must be held down, in
 * milliseconds.
 *
 * The reset throws the knobs of the module away, so it is not a thing a
 * press should do by accident: the button has to be held down, and the
 * lamp of the module blinks three times while it is held.
 */
const RESET_HOLD_MS = 1000;

/**
 * The number of memory positions of a module. The four buttons for them
 * stand under the knobs of the module, in two columns; they are not wired
 * yet.
 */
const MEMORY_POSITIONS = 4;

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

  /* The row of module plates, and the rail of the case under them. */
  const plateRow = document.createElement('div');
  plateRow.className = 'faceplate-row';

  const rail = document.createElement('div');
  rail.className = 'faceplate-rail';

  const strips = new Map<Voice, StripWidgets>();

  /* The factory value of every control of every voice, as the engine's own
   * table reports it: the reset of a module puts its knobs back to these. */
  const voiceDefaults = new Map<Voice, Map<Param, number>>();

  for (const voice of PANEL_ORDER) {
    const module = MODULES[voice];
    const name = MODULE_NAMES[voice];

    const element = document.createElement('section');
    element.className = `strip ${module.plateClass}`.trim();
    element.dataset.voice = voice;
    element.dataset.place = module.place;
    element.setAttribute('aria-label', `${name.spoken} module`);

    /* Every module is a plate of its own, screwed to the case. */
    appendScrews(element, module.place);

    const head = document.createElement('div');
    head.className = 'strip-head';

    const title = document.createElement('h2');
    title.className = 'strip-name';
    /* The name of the module is printed, not typed: it is the outline of
     * the word. The word itself stays in the markup, for the readers. */
    const spoken = document.createElement('span');
    spoken.className = 'visually-hidden';
    spoken.textContent = name.spoken;
    title.append(printedWord(name.printed), spoken);

    const lamps = document.createElement('div');
    lamps.className = 'strip-lamps';

    const triggerLamp = document.createElement('span');
    triggerLamp.className = 'lamp lamp-trigger';
    triggerLamp.id = `lamp-${voice}-trigger`;
    triggerLamp.setAttribute('role', 'img');
    triggerLamp.setAttribute('aria-label', `${name.spoken}: silent`);

    lamps.append(triggerLamp);
    head.append(title, lamps);

    const knobColumn = document.createElement('div');
    knobColumn.className = 'strip-knobs';

    /* The second, shorter column of the module: the mixer of the channel. */
    const mixColumn = document.createElement('div');
    mixColumn.className = 'strip-mix';

    /* The trigger button of the module: a quiet button under the mixer
     * knobs that plays the module's own voice, the way a key of the
     * keyboard does. */
    const triggerButton = document.createElement('button');
    triggerButton.type = 'button';
    triggerButton.className = 'strip-trigger';
    triggerButton.dataset.voice = voice;
    triggerButton.textContent = 'trig';
    triggerButton.setAttribute('aria-label', `play the ${name.spoken}`);
    triggerButton.addEventListener('click', () => {
      engine.trigger(TRIGGER_INSTRUMENT[voice], 127);
    });

    /* The memory positions of the module: four buttons for the tones the
     * module will hold. They are not wired yet — the four tones of a
     * module are a design that is still deferred. */
    const pads = document.createElement('div');
    pads.className = 'strip-pads';

    for (let position = 1; position <= MEMORY_POSITIONS; position += 1) {
      const memoryButton = document.createElement('button');
      memoryButton.type = 'button';
      memoryButton.className = 'strip-mem';
      memoryButton.dataset.voice = voice;
      memoryButton.dataset.position = String(position);
      memoryButton.textContent = String(position);
      memoryButton.setAttribute(
        'aria-label',
        `memory position ${position} of the ${name.spoken} module`,
      );
      /* The button is there, but nothing is behind it yet. */
      memoryButton.setAttribute('aria-disabled', 'true');
      pads.append(memoryButton);
    }

    /* The reset of the module: it puts the knobs back to their defaults.
     * It is the one control of a module that throws something away, so it
     * is the quietest one and it has to be held down. */
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'strip-reset';
    resetButton.dataset.voice = voice;
    resetButton.textContent = 'RST';
    resetButton.setAttribute(
      'aria-label',
      `reset the knobs of the ${name.spoken} module`,
    );

    wireReset(voice, triggerLamp, resetButton);

    /* The buttons of the module: the trigger, the memory positions and
     * the reset. They stand at the foot of the mixer column. */
    const buttons = document.createElement('div');
    buttons.className = 'strip-buttons';
    buttons.append(triggerButton, pads, resetButton);

    /* The effects knob of the module: the share of the module that goes
     * to the effects send of the kit. It stands below the buttons and it
     * is not wired to anything yet — the engine has no effects bus. */
    const fxKnob = createKnob({
      label: FX_SPEC.label,
      unit: FX_SPEC.unit,
      min: 0,
      max: 1,
      decimals: FX_SPEC.decimals,
      taper: FX_SPEC.taper,
      step: FX_SPEC.step,
      fineStep: FX_SPEC.fineStep,
      value: 0,
      onChange: () => {
        /* Nothing is behind the knob yet. */
      },
    });

    const fxCell = document.createElement('div');
    fxCell.className = 'knob-cell strip-fx';

    const fxLabel = document.createElement('span');
    fxLabel.className = 'knob-label';
    fxLabel.textContent = FX_SPEC.label;

    fxCell.append(fxKnob.element, fxLabel);

    /* The mixer column, the trigger button, the memory positions, the
     * reset and the effects knob stand in one stack. The rule that
     * divides the mixer from the sound knobs is drawn on the mixer column
     * itself, so it stops where the knobs stop. */
    const mixStack = document.createElement('div');
    mixStack.className = 'strip-mix-stack';
    mixStack.append(mixColumn, buttons, fxCell);

    const body = document.createElement('div');
    body.className = 'strip-body';
    body.append(knobColumn, mixStack);

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
      `export the settings of the ${name.spoken} module`,
    );
    exportButton.addEventListener('click', () => {
      exportVoice(voice);
    });

    const railCell = document.createElement('div');
    railCell.className = 'faceplate-rail-cell';
    railCell.append(exportButton);
    rail.append(railCell);

    strips.set(voice, {
      triggerLamp,
      knobColumn,
      mixColumn,
      knobs: [],
      exportButton,
      resetButton,
      fxKnob,
    });
  }

  /* The effects module stands at the end of the row, where the Cymbal
   * stood before it: it is a plate of its own, with a layout of its own,
   * and it carries no voice of the engine. */
  const fx = createFxModule();
  plateRow.append(fx.element);

  /* The rail of the case carries a cell for every plate, so that a
   * control on the rail stands under the module it belongs to. The
   * effects module has nothing to export: the engine holds no settings
   * for it. */
  const fxRailCell = document.createElement('div');
  fxRailCell.className = 'faceplate-rail-cell';
  rail.append(fxRailCell);

  faceplate.append(plateRow, rail);
  fitHost.append(faceplate);
  host.append(fitHost);

  /**
   * Put the knobs of a module back to their defaults.
   *
   * The defaults are the factory values of the engine's own table. They
   * are written to the engine, and the engine holds them: the panel reads
   * them back like every other value, so the knobs follow the engine and
   * not the other way round.
   */
  function resetVoice(voice: Voice): void {
    const defaults = voiceDefaults.get(voice);
    if (defaults === undefined) {
      return;
    }
    for (const [param, value] of defaults) {
      engine.setParam(voice, param, value);
    }
  }

  /**
   * Wire the reset button of a module.
   *
   * The reset throws the knobs of the module away, so a press is not
   * enough: the button has to be held down for a second, and the lamp of
   * the module blinks three times while it is held. Letting go before the
   * hold is over leaves the module as it is.
   */
  function wireReset(
    voice: Voice,
    lamp: HTMLElement,
    button: HTMLButtonElement,
  ): void {
    let timer: number | null = null;

    const stop = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      button.classList.remove('is-armed');
      lamp.classList.remove('is-blinking');
    };

    const arm = (): void => {
      if (timer !== null) {
        return;
      }
      button.classList.add('is-armed');
      lamp.classList.add('is-blinking');
      timer = window.setTimeout(() => {
        timer = null;
        resetVoice(voice);
        stop();
      }, RESET_HOLD_MS);
    };

    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      /* The button keeps the pointer while it is held, so the hold does
       * not end when the pointer wanders off it. */
      button.setPointerCapture(event.pointerId);
      arm();
    });

    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, stop);
    }

    /* The keyboard holds the button down the same way: the key goes down
     * and stays down. */
    button.addEventListener('keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      arm();
    });

    for (const type of ['keyup', 'blur']) {
      button.addEventListener(type, stop);
    }
  }

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
    const meta = specFor(spec, voice);
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

    for (const voice of PANEL_ORDER) {
      const strip = strips.get(voice);
      if (strip === undefined) {
        continue;
      }

      /* The controls the engine supports on this voice: the export writes
       * these and nothing else. */
      const supported: Param[] = [];

      /* The factory value of every control of this voice: the reset of the
       * module puts its knobs back to these. */
      const defaults = new Map<Param, number>();

      for (const spec of MODULES[voice].soundKnobs) {
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
        defaults.set(spec.param, entry.default);
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
        defaults.set(spec.param, entry.default);
      }

      supportedParams.set(voice, supported);
      voiceDefaults.set(voice, defaults);
    }

    fitter.update();
  };
  const applyState = (state: EngineState): void => {
    lastState = state;

    /* The display of the effects module shows the shape of the output
     * signal, as the engine renders it. */
    fx.updateScope(state.scope);

    for (const voice of PANEL_ORDER) {
      const strip = strips.get(voice);
      if (strip === undefined) {
        continue;
      }

      for (const widget of strip.knobs) {
        const value = state.values[widget.index] ?? 0;
        widget.knob.setValue(fromQ16(value));
        widget.knob.element.dataset.value = String(value);
      }

      /* The lamp of a module follows the signal of its own instruments.
       * The engine knows the level of every instrument before it sums the
       * voices into the mix, so the brightness of the lamp is the level of
       * those instruments alone, and the light is proportional to it. The
       * hi-hat has two instruments and one lamp: the louder of the two
       * lights it. */
      let level = 0;
      let sounding = false;
      for (const instrument of VOICE_INSTRUMENTS[voice]) {
        const index = instrumentIndex(instrument);
        level = Math.max(level, state.lamp[index] ?? 0);
        if (state.sounding[index] === 1) {
          sounding = true;
        }
      }

      strip.triggerLamp.classList.toggle('is-lit', level > 0);
      strip.triggerLamp.style.setProperty('--lamp-level', level.toFixed(3));

      /* The label follows the engine: the lamp may still fade out after
       * the instrument has fallen silent. */
      strip.triggerLamp.setAttribute(
        'aria-label',
        `${MODULE_NAMES[voice].spoken}: ${sounding ? 'sounding' : 'silent'}`,
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
      fx.dispose();
      for (const strip of strips.values()) {
        for (const widget of strip.knobs) {
          widget.knob.dispose();
        }
        strip.fxKnob.dispose();
      }
      fitter.dispose();
      fitHost.remove();
    },
  };
}
