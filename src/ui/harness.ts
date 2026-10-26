import {
  INSTRUMENT_KEYS,
  INSTRUMENT_NAMES,
} from '../audio/keyboard';
import type { HiveEngine } from '../audio/engine';
import type { MidiDevice } from '../audio/midi';
import {
  PARAM_COUNT,
  Q16_ONE,
  SOUND_PARAM_COUNT,
  VOICES,
  paramIndex,
  voiceIndex,
  type EngineState,
  type Param,
  type ParamInfo,
  type Voice,
} from '../audio/protocol';

/**
 * The Phase 1 test surface.
 *
 * The hardware panel arrives in Phase 2. This is the plain surface that
 * exercises the audio path: the triggers, a few parameters of the engine,
 * the trigger sensitivity and the reset. Everything it shows comes from the
 * engine's own snapshot.
 */

const SLIDER_MAX = 1000;

interface BoundParam {
  readonly voice: Voice;
  readonly param: Param;
  readonly label: string;
  readonly unit: string;
}

const BOUND_PARAMS: readonly BoundParam[] = [
  { voice: 'kick', param: 'tonePitch', label: 'Bass tone', unit: 'Hz' },
  { voice: 'kick', param: 'decay', label: 'Bass decay', unit: 's' },
  { voice: 'kick', param: 'volume', label: 'Bass level', unit: '' },
  { voice: 'snare', param: 'sweep', label: 'Snare sweep', unit: '' },
  { voice: 'snare', param: 'volume', label: 'Snare level', unit: '' },
];

export interface Harness {
  /** The MIDI inputs that are connected. */
  setMidiDevices(devices: readonly MidiDevice[]): void;
  /** Something went wrong; the demo carries on. */
  showError(message: string): void;
  dispose(): void;
}

interface Bound {
  readonly spec: BoundParam;
  readonly input: HTMLInputElement;
  readonly readout: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  return node;
}

function infoFor(
  info: readonly ParamInfo[],
  voice: Voice,
  param: Param,
): ParamInfo | undefined {
  const v = voiceIndex(voice);
  const p = paramIndex(param);
  return info.find((entry) => entry.voice === v && entry.param === p);
}

export function createHarness(root: HTMLElement, engine: HiveEngine): Harness {
  const heading = element('h1', 'harness-title');
  heading.textContent = 'libhive-demo';
  root.append(heading);

  const note = element('p', 'harness-note');
  note.textContent =
    'Phase 1: the audio path. The hardware panel arrives in Phase 2.';
  root.append(note);

  const status = element('p', 'harness-status');
  status.id = 'engine-status';
  root.append(status);

  const error = element('p', 'harness-error');
  error.id = 'engine-error';
  error.hidden = true;
  root.append(error);

  /* The triggers. The buttons play with the hit strength of the slider
   * below, the way a pad plays with the strength of the hit; the keyboard
   * always plays at full strength. */
  const triggers = element('section', 'harness-triggers');
  for (const voice of VOICES) {
    const button = element('button', 'harness-trigger');
    button.type = 'button';
    button.id = `trigger-${voice}`;
    button.textContent = `${INSTRUMENT_NAMES[voice]} (${INSTRUMENT_KEYS[voice]})`;
    button.addEventListener('click', () => {
      engine.trigger(voice, hitStrength);
    });
    triggers.append(button);
  }
  root.append(triggers);

  /* The strength of a hit. */
  const strengthRow = element('label', 'harness-param');
  const strengthCaption = element('span', 'harness-param-label');
  strengthCaption.textContent = 'Hit strength';
  const strengthInput = element('input', 'harness-slider');
  strengthInput.type = 'range';
  strengthInput.min = '0';
  strengthInput.max = String(SLIDER_MAX);
  strengthInput.step = '1';
  strengthInput.value = String(SLIDER_MAX);
  strengthInput.id = 'hit-strength';
  const strengthReadout = element('span', 'harness-param-value');
  strengthReadout.id = 'value-hit-strength';
  strengthRow.append(strengthCaption, strengthInput, strengthReadout);
  root.append(strengthRow);

  let hitStrength = Q16_ONE;
  strengthInput.addEventListener('input', () => {
    hitStrength = Math.round((Number(strengthInput.value) / SLIDER_MAX) * Q16_ONE);
    strengthReadout.textContent = (hitStrength / Q16_ONE).toFixed(2);
  });
  strengthReadout.textContent = '1.00';

  /* The parameters of the engine. */
  const parameters = element('section', 'harness-params');
  const bounds: Bound[] = [];
  for (const spec of BOUND_PARAMS) {
    const row = element('label', 'harness-param');
    const caption = element('span', 'harness-param-label');
    caption.textContent = spec.label;
    const input = element('input', 'harness-slider');
    input.type = 'range';
    input.min = '0';
    input.max = String(SLIDER_MAX);
    input.step = '1';
    input.id = `param-${spec.voice}-${spec.param}`;
    input.disabled = true;
    const readout = element('span', 'harness-param-value');
    readout.id = `value-${spec.voice}-${spec.param}`;
    row.append(caption, input, readout);
    parameters.append(row);
    bounds.push({ spec, input, readout });

    input.addEventListener('input', () => {
      const info = infoFor(engine.paramInfo, spec.voice, spec.param);
      if (info === undefined || !info.supported) {
        return;
      }
      const ratio = Number(input.value) / SLIDER_MAX;
      const value = Math.round(info.min + ratio * (info.max - info.min));
      engine.setParam(spec.voice, spec.param, value);
    });
  }
  root.append(parameters);

  /* The trigger sensitivity of the Bass channel. */
  const sensRow = element('label', 'harness-param');
  const sensCaption = element('span', 'harness-param-label');
  sensCaption.textContent = 'Bass sensitivity';
  const sensInput = element('input', 'harness-slider');
  sensInput.type = 'range';
  sensInput.min = '0';
  sensInput.max = String(SLIDER_MAX);
  sensInput.step = '1';
  sensInput.id = 'param-kick-sens';
  const sensReadout = element('span', 'harness-param-value');
  sensReadout.id = 'value-kick-sens';
  sensRow.append(sensCaption, sensInput, sensReadout);
  root.append(sensRow);

  /* The sensitivity is the host's own: the engine has no velocity input,
   * so the strength of a hit decides whether the channel speaks. */
  let sensitivity = 0;
  sensInput.addEventListener('input', () => {
    const ratio = Number(sensInput.value) / SLIDER_MAX;
    sensitivity = Math.round(ratio * Q16_ONE);
    engine.setSens('kick', sensitivity);
    sensReadout.textContent = (sensitivity / Q16_ONE).toFixed(2);
  });

  /* One memory of the Bass sound, to exercise the tone path. */
  const memory = element('section', 'harness-memory');
  const storeButton = element('button', 'harness-action');
  storeButton.type = 'button';
  storeButton.id = 'store-tone';
  storeButton.textContent = 'Store the Bass sound';
  const recallButton = element('button', 'harness-action');
  recallButton.type = 'button';
  recallButton.id = 'recall-tone';
  recallButton.textContent = 'Recall the Bass sound';
  const resetButton = element('button', 'harness-action');
  resetButton.type = 'button';
  resetButton.id = 'reset';
  resetButton.textContent = 'Reset';
  memory.append(storeButton, recallButton, resetButton);
  root.append(memory);

  /* The MIDI input. */
  const midiRow = element('section', 'harness-midi');
  const midiButton = element('button', 'harness-action');
  midiButton.type = 'button';
  midiButton.id = 'midi-connect';
  midiButton.textContent = 'Connect a MIDI controller';
  const midiStatus = element('span', 'harness-midi-status');
  midiStatus.id = 'midi-status';
  midiRow.append(midiButton, midiStatus);
  root.append(midiRow);

  let storedTone: number[] | null = null;

  storeButton.addEventListener('click', () => {
    const state = engine.engineState;
    if (state === null) {
      return;
    }
    const base = voiceIndex('kick') * PARAM_COUNT;
    storedTone = [];
    for (let index = 0; index < SOUND_PARAM_COUNT; index += 1) {
      storedTone.push(state.values[base + index] ?? 0);
    }
  });

  recallButton.addEventListener('click', () => {
    if (storedTone !== null) {
      engine.setTone('kick', storedTone);
    }
  });

  resetButton.addEventListener('click', () => {
    engine.reset();
  });

  const unsubscribe = engine.onState((state) => {
    render(state);
  });

  const unavailable = engine.unavailable;
  if (unavailable !== null) {
    showError(unavailable);
  }

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
  }

  function setMidiDevices(devices: readonly MidiDevice[]): void {
    if (devices.length === 0) {
      midiStatus.textContent = 'no MIDI input connected';
      return;
    }
    midiStatus.textContent = devices
      .map((device) => device.name)
      .join(', ');
  }

  function render(state: EngineState): void {
    const version = (state.version >> 8) & 0xff;
    const patch = state.version & 0xff;
    status.textContent =
      `libhive ${(state.version >> 16) & 0xff}.${version}.${patch} — ` +
      `${state.active ? 'sounding' : 'silent'} — peak ${state.peak}`;

    for (const bound of bounds) {
      const info = infoFor(engine.paramInfo, bound.spec.voice, bound.spec.param);
      const value = state.values[
        voiceIndex(bound.spec.voice) * PARAM_COUNT + paramIndex(bound.spec.param)
      ] ?? 0;

      if (info !== undefined && info.supported) {
        bound.input.disabled = false;
        const span = info.max - info.min;
        const ratio = span === 0 ? 0 : (value - info.min) / span;
        if (document.activeElement !== bound.input) {
          bound.input.value = String(
            Math.round(Math.min(1, Math.max(0, ratio)) * SLIDER_MAX),
          );
        }
        bound.readout.textContent = `${(value / Q16_ONE).toFixed(2)} ${bound.spec.unit}`.trim();
      } else {
        bound.input.disabled = true;
        bound.readout.textContent = 'not supported';
      }
    }
  }

  return {
    setMidiDevices,
    showError,
    dispose(): void {
      unsubscribe();
      root.replaceChildren();
    },
  };
}
