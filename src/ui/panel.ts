import type { HiveEngine } from '../audio/engine';
import {
  CHANNEL_PARAMS,
  FX_PARAMS,
  PARAM_COUNT,
  SOUND_PARAMS,
  VOICE_INSTRUMENTS,
  instrumentIndex,
  paramIndex,
  voiceIndex,
  type ChannelParam,
  type EngineState,
  type Instrument,
  type Param,
  type ParamInfo,
  type SoundParam,
  type Voice,
} from '../audio/protocol';
import { fromQ16, toQ16 } from '../audio/units';
import { createFitter, type Fitter } from './fit';
import { createChannelStore, type ChannelStore } from './channel';
import { createFxModule } from './fx';
import { createFxStore, type FxStore } from './fx-store';
import { createKnob, type Knob } from './knob';
import { createMemoryStore, MEMORY_POSITIONS, type MemoryStore } from './memory';
import { CYMBAL_MODULE, HIHAT_MODULE } from './metallic';
import { MODULE_NAMES } from './names';
import {
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
 * plays the module's own voice, the way a key of the keyboard does. Under
 * it stand the four memory positions of the module: one of them is always
 * selected, the selected one is lit, and the engine plays the tone of the
 * position that is selected. A position holds the tone of the module — the
 * sound knobs — and not the mixer of the channel: the mixer belongs to the
 * module and keeps the values the user has set.
 *
 * The hi-hat module and the cymbal module stand at the end of the row, and
 * the effects module after them: the two metallic voices of the engine
 * come first, and the effects module carries the controls of the engine's
 * shared FX bus.
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
  /** The buttons of the memory positions of the module. */
  readonly memoryButtons: HTMLButtonElement[];
  /** The control that puts the knobs of the module back to their defaults. */
  readonly resetButton: HTMLButtonElement;
  /** The cell of the effects knob of the module. */
  readonly fxCell: HTMLElement;
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
 * The order of the modules on the panel: the five drums, the two metallic
 * voices and the effects module at the end of the row.
 */
const PANEL_ORDER: readonly Voice[] = [
  'kick',
  'snare',
  'tom1',
  'tom2',
  'tom3',
  'hihat',
  'cymbal',
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

function findInfo(
  info: readonly ParamInfo[],
  voice: Voice,
  param: number,
): ParamInfo | undefined {
  const v = voiceIndex(voice);
  return info.find((entry) => entry.voice === v && entry.param === param);
}

/**
 * Whether a parameter is part of a tone.
 *
 * The sound knobs are: the mixer of the channel and the effects send
 * belong to the module and not to the tone in it.
 */
function isSoundParam(param: Param): param is SoundParam {
  return (SOUND_PARAMS as readonly string[]).includes(param);
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

  /* The memories of the kit: the four positions of every module, the
   * values in them and the position that is selected. They are the
   * panel's own store — the engine has no memory storage — and they are
   * kept in the browser, so the kit comes back the way it was left. */
  let memory: MemoryStore | null = null;

  /* The channel of every module: the mixer of the voice and its effects
   * send. They belong to the module and not to the tone in it, so they
   * are kept apart from the memories and written down as the user sets
   * them. */
  let channel: ChannelStore | null = null;

  /* The memory of the effects module: the nine controls of the shared
   * FX bus. */
  let fxStore: FxStore | null = null;

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

    /* The memory positions of the module: four buttons, one for every
     * tone the module holds. One of them is always selected, and the
     * selected one is the tone the engine is playing: picking a position
     * recalls its values, and moving a knob writes them back into it. */
    const pads = document.createElement('div');
    pads.className = 'strip-pads';

    const memoryButtons: HTMLButtonElement[] = [];

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
      /* The button selects a position: it is pressed when the position is
       * the selected one. */
      memoryButton.setAttribute('aria-pressed', 'false');
      memoryButton.addEventListener('click', () => {
        selectMemory(voice, position);
      });
      pads.append(memoryButton);
      memoryButtons.push(memoryButton);
    }

    /* The reset of the module: it puts the tone of the selected memory
     * position back to its built-in values. It is the one control of a
     * module that throws something away, so it is the quietest one and it
     * has to be held down. */
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'strip-reset';
    resetButton.dataset.voice = voice;
    resetButton.textContent = 'RST';
    resetButton.setAttribute(
      'aria-label',
      `reset the selected tone of the ${name.spoken} module`,
    );

    wireReset(voice, triggerLamp, resetButton);

    /* The buttons of the module: the trigger, the memory positions and
     * the reset. They stand at the foot of the mixer column. */
    const buttons = document.createElement('div');
    buttons.className = 'strip-buttons';
    buttons.append(triggerButton, pads, resetButton);

    /* The effects knob of the module: the share of the module that goes
     * to the effects send of the kit. It stands below the buttons, and
     * the knob itself is built with the engine's table, like every other
     * knob of the panel. */
    const fxCell = document.createElement('div');
    fxCell.className = 'knob-cell strip-fx';

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

    strips.set(voice, {
      triggerLamp,
      knobColumn,
      mixColumn,
      knobs: [],
      memoryButtons,
      resetButton,
      fxCell,
    });
  }

  /* The effects module stands at the end of the row, where the Cymbal
   * stood before it: it is a plate of its own, with a layout of its own,
   * and it carries no voice of the engine, only the controls of the
   * shared FX bus. */
  const fx = createFxModule((param, value) => {
    const raw = toQ16(value);
    engine.setFxParam(param, raw);
    /* The bus is remembered: the effects of the kit come back the way
     * they were left. */
    fxStore?.write(param, raw);
  });
  plateRow.append(fx.element);

  faceplate.append(plateRow, rail);
  fitHost.append(faceplate);
  host.append(fitHost);

  /**
   * Put the tone of a module back to its built-in values.
   *
   * The built-in values are those of the selected memory position: the
   * factory values of the engine's own table, and the tones of the Snare,
   * which are tones of their own. The position is put back to them, and
   * the values are written to the engine, so the panel reads them back
   * like every other value and the knobs follow the engine and not the
   * other way round.
   *
   * The mixer of the channel is not part of a tone: it keeps the values
   * the user has set.
   */
  function resetVoice(voice: Voice): void {
    const store = memory;
    if (store === null) {
      return;
    }
    store.resetSelected(voice);
    engine.setTone(voice, Array.from(store.values(voice)));
  }

  /**
   * Show which memory position of a module is selected.
   *
   * The selected button is pressed in and lit, the other ones are not,
   * and the button tells the assistive technology that it is pressed.
   */
  function updateMemoryButtons(voice: Voice): void {
    const strip = strips.get(voice);
    if (strip === undefined) {
      return;
    }
    const selected = memory?.selected(voice) ?? 1;
    const spoken = MODULE_NAMES[voice].spoken;

    for (const button of strip.memoryButtons) {
      const position = Number(button.dataset.position ?? '1');
      const isSelected = position === selected;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      button.setAttribute(
        'aria-label',
        `memory position ${position} of the ${spoken} module${
          isSelected ? ', selected' : ''
        }`,
      );
    }
  }

  /**
   * Select a memory position of a module.
   *
   * The position is selected, the tone in it is written to the engine,
   * and the engine holds it: the knobs of the module follow the engine
   * and show the tone that was picked. The mixer of the channel is not
   * part of a tone and stays where the user left it.
   */
  function selectMemory(voice: Voice, position: number): void {
    const store = memory;
    if (store === null) {
      return;
    }
    store.select(voice, position);
    updateMemoryButtons(voice);
    engine.setTone(voice, Array.from(store.values(voice)));
  }

  /**
   * Write the channel of a module to the engine: the mixer of the voice
   * and its effects send.
   */
  function applyChannel(voice: Voice): void {
    const store = channel;
    if (store === null) {
      return;
    }
    const values = store.values(voice);
    for (let slot = 0; slot < CHANNEL_PARAMS.length; slot += 1) {
      const param = CHANNEL_PARAMS[slot];
      const value = values[slot];
      if (param === undefined || value === undefined) {
        continue;
      }
      if (param === 'fxSend') {
        engine.setInstrumentFxSend(TRIGGER_INSTRUMENT[voice], value);
        continue;
      }
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

  /* The last state the engine reported, so that the panel shows it as
   * soon as the modules are built. */
  let lastState: EngineState | null = null;

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
    write?: (value: number) => void,
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
        const raw = toQ16(value);
        if (write !== undefined) {
          write(value);
        } else {
          engine.setParam(voice, spec.param, raw);
        }
        /* The value belongs to the tone that is selected, or to the
         * channel of the module: the mixer of a voice is not part of a
         * tone. */
        if (isSoundParam(spec.param)) {
          memory?.write(voice, spec.param, raw);
        } else {
          channel?.write(voice, spec.param as ChannelParam, raw);
        }
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

      /* The compact knobs of a module stand together in a little grid at
       * the top of the column, so a voice with more controls than the
       * common six keeps the height of the plate. */
      let cluster: HTMLElement | null = null;

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
        if (spec.compact === true) {
          if (cluster === null) {
            cluster = document.createElement('div');
            cluster.className = 'strip-knob-cluster';
            strip.knobColumn.append(cluster);
          }
          cluster.append(widget.cell);
        } else {
          cluster = null;
          strip.knobColumn.append(widget.cell);
        }
        strip.knobs.push(widget);
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
      }

      /* The effects send of the module: the share of the module that goes
       * to the effects bus of the kit. The engine has the parameter on
       * every voice, and the knob is built from its own table. */
      const fxEntry = findInfo(info, voice, paramIndex('fxSend'));
      if (fxEntry !== undefined && fxEntry.supported) {
        const widget = createWidget(
          voice,
          { kind: 'param', param: 'fxSend' },
          {
            min: fromQ16(fxEntry.min),
            max: fromQ16(fxEntry.max),
            default: fromQ16(fxEntry.default),
          },
          (value) => {
            engine.setInstrumentFxSend(
              TRIGGER_INSTRUMENT[voice],
              toQ16(value),
            );
          },
        );
        strip.fxCell.append(widget.cell);
        strip.knobs.push(widget);
      }

    }

    fitter.update();
  };
  const applyState = (state: EngineState): void => {
    lastState = state;

    /* The knobs of the effects module show the values the engine holds
     * for the shared FX bus. */
    fx.update(state.fx);

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

  const unsubscribeReady = engine.onReady((info, fxInfo) => {
    fx.build(fxInfo);
    build(info);

    /* The memories of the kit: the built-in tone of every position, the
     * ones the browser kept from an earlier visit, and the position that
     * is selected for every module. */
    memory = createMemoryStore(info, PANEL_ORDER);

    /* The channels of the kit: the mixer of every voice and its effects
     * send, as the user has set them. */
    channel = createChannelStore(info, PANEL_ORDER);

    /* The effects of the kit: the factory values of the bus and the ones
     * the browser kept. */
    fxStore = createFxStore(fxInfo);

    /* The engine takes the values of the bus the browser kept, and every
     * module takes the values of the position that is selected: the kit
     * comes back the way it was left. */
    for (const entry of fxInfo) {
      const param = FX_PARAMS[entry.param];
      if (param === undefined) {
        continue;
      }
      engine.setFxParam(param, fxStore.values[entry.param] ?? 0);
    }

    for (const voice of PANEL_ORDER) {
      updateMemoryButtons(voice);
      engine.setTone(voice, Array.from(memory.values(voice)));
      applyChannel(voice);
    }

    if (lastState !== null) {
      applyState(lastState);
    }
  });

  const unsubscribeState = engine.onState((state) => {
    applyState(state);
  });

  /* The memories of the kit are written to the browser as they change.
   * The page may go away before the last value is written, so the pending
   * one is flushed when the page is hidden. */
  const flush = (): void => {
    memory?.flush();
    channel?.flush();
    fxStore?.flush();
  };

  window.addEventListener('pagehide', flush);

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  };
  window.addEventListener('visibilitychange', onVisibility);

  return {
    /**
     * The reset of the demo: the whole machine goes back to the factory.
     *
     * The engine takes its factory values, every memory position of every
     * module goes back to its built-in values, and the effects of the kit
     * go back to the factory values of the bus. The first memory position
     * is selected again for every module.
     */
    reset(): void {
      engine.reset();

      const store = memory;
      if (store !== null) {
        store.resetAll();
        for (const voice of PANEL_ORDER) {
          updateMemoryButtons(voice);
          engine.setTone(voice, Array.from(store.values(voice)));
        }
      }

      channel?.resetAll();
      for (const voice of PANEL_ORDER) {
        applyChannel(voice);
      }

      fxStore?.reset();
    },

    dispose(): void {
      unsubscribeReady();
      unsubscribeState();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('visibilitychange', onVisibility);
      memory?.dispose();
      channel?.dispose();
      fxStore?.dispose();
      fx.dispose();
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
