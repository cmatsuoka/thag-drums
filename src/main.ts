import { HiveEngine } from './audio/engine';
import { attachKeyboard } from './audio/keyboard';
import { MidiInput } from './audio/midi';
import { createHarness } from './ui/harness';

/**
 * The application: the engine, the trigger sources and the panel.
 *
 * The engine's graph is built while the page loads, so the first press
 * only has to wake the context up. Every trigger source ends in the same
 * place: a trigger with an instrument and a strength.
 */

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('the page is missing its #app element');
}

const engine = new HiveEngine();
const harness = createHarness(app, engine);

engine.onError((message) => {
  harness.showError(message);
});

/* The keyboard is the practical way to play. */
attachKeyboard((instrument, strength) => {
  engine.trigger(instrument, strength);
});

/* A MIDI controller may be connected; the velocity is the hit strength. */
const midi = new MidiInput({
  onTrigger: (instrument, strength) => {
    engine.trigger(instrument, strength);
  },
  onDevices: (devices) => {
    harness.setMidiDevices(devices);
  },
  onError: (message) => {
    harness.showError(message);
  },
});

const midiButton = document.querySelector<HTMLButtonElement>('#midi-connect');
midiButton?.addEventListener('click', () => {
  void midi.connect();
});

/* The graph is built while the page loads. */
void engine.init();

/* The first gesture wakes the suspended context up. */
const wake = (): void => {
  void engine.wake();
};
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);
