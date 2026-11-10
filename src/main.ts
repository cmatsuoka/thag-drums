import { HivedrumEngine } from './audio/engine';
import { attachKeyboard } from './audio/keyboard';
import { MidiInput } from './audio/midi';
import { createDemoStrip, type DemoStrip } from './ui/demo-strip';
import { createHelp } from './ui/help';
import { createPanel } from './ui/panel';

/*
 * The engine itself lives in the worklet, but the facade is the demo's
 * own handle on it: the browser console and the end-to-end test use it to
 * reach the engine, which the panel does not offer on its own.
 */
declare global {
  interface Window {
    hivedrum?: HivedrumEngine;
  }
}

/**
 * The application: the engine, the trigger sources and the panel.
 *
 * The engine's graph is built while the page loads, so the first press
 * only has to wake the context up. Every trigger source ends in the same
 * place: a trigger with an instrument and a velocity.
 */

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('the page is missing its #app element');
}

const engine = new HivedrumEngine();

/* The page's heading. The console carries the module strips, and their
 * names are the headings below it. */
const heading = document.createElement('h1');
heading.className = 'visually-hidden';
heading.textContent = 'Thagomizer';
app.append(heading);

const panel = createPanel(app, engine);

let demo: DemoStrip | null = null;

/* A MIDI controller may be connected; the velocity is the hit strength. */
const midi = new MidiInput({
  onTrigger: (instrument, velocity) => {
    engine.trigger(instrument, velocity);
  },
  onDevices: (devices) => {
    demo?.setMidiDevices(devices);
  },
  onError: (message) => {
    demo?.showError(message);
  },
});

demo = createDemoStrip(app, engine, {
  onReset: () => {
    panel.reset();
  },
  onMidiConnect: () => {
    void midi.connect();
  },
  onMidiSelect: (id) => {
    midi.select(id);
  },
});

/* The player's guide, folded away under the console. */
app.append(createHelp());

engine.onError((message) => {
  demo?.showError(message);
});

/* The keyboard is the practical way to play. */
attachKeyboard((instrument, velocity) => {
  engine.trigger(instrument, velocity);
});

/* The graph is built while the page loads. */
void engine.init();

/* The first gesture wakes the suspended context up. */
const wake = (): void => {
  void engine.wake();
};
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);

window.hivedrum = engine;
