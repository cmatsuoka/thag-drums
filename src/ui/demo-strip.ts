import type { HiveEngine } from '../audio/engine';
import type { MidiDevice } from '../audio/midi';
import type { EngineState } from '../audio/protocol';

/**
 * The demo's own strip, below the console.
 *
 * The faceplate stays a faceplate: the reset control, the engine version
 * and the notices of the demo live outside the hardware replica.
 */

export interface DemoStripOptions {
  /** The reset control was pressed. */
  readonly onReset: () => void;
  /** The MIDI button was pressed. */
  readonly onMidiConnect: () => void;
}

export interface DemoStrip {
  /** The MIDI inputs that are connected. */
  setMidiDevices(devices: readonly MidiDevice[]): void;
  /** Something went wrong; the demo carries on. */
  showError(message: string): void;
  dispose(): void;
}

export function createDemoStrip(
  host: HTMLElement,
  engine: HiveEngine,
  options: DemoStripOptions,
): DemoStrip {
  const strip = document.createElement('section');
  strip.className = 'demo-strip';

  const title = document.createElement('p');
  title.className = 'demo-title';
  title.textContent = 'THE THAGOMIZER';
  strip.append(title);

  const status = document.createElement('p');
  status.className = 'demo-status';
  status.id = 'engine-status';
  status.textContent = 'powered by libhive';
  strip.append(status);

  const error = document.createElement('p');
  error.className = 'demo-error';
  error.id = 'engine-error';
  error.hidden = true;
  strip.append(error);

  const actions = document.createElement('div');
  actions.className = 'demo-actions';

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'demo-button';
  resetButton.id = 'reset';
  resetButton.textContent = 'Reset';
  resetButton.addEventListener('click', () => {
    options.onReset();
  });

  const midiButton = document.createElement('button');
  midiButton.type = 'button';
  midiButton.className = 'demo-button';
  midiButton.id = 'midi-connect';
  midiButton.textContent = 'Connect a MIDI controller';
  midiButton.addEventListener('click', () => {
    options.onMidiConnect();
  });

  const midiStatus = document.createElement('span');
  midiStatus.className = 'demo-midi-status';
  midiStatus.id = 'midi-status';

  actions.append(resetButton, midiButton, midiStatus);
  strip.append(actions);

  host.append(strip);

  const render = (state: EngineState): void => {
    const major = (state.version >> 16) & 0xff;
    const minor = (state.version >> 8) & 0xff;
    const patch = state.version & 0xff;
    status.textContent = `powered by libhive ${major}.${minor}.${patch}`;
  };

  const unsubscribe = engine.onState((state) => {
    render(state);
  });

  const unavailable = engine.unavailable;
  if (unavailable !== null) {
    error.textContent = unavailable;
    error.hidden = false;
  }

  return {
    setMidiDevices(devices: readonly MidiDevice[]): void {
      midiStatus.textContent =
        devices.length === 0
          ? 'no MIDI input connected'
          : devices.map((device) => device.name).join(', ');
    },

    showError(message: string): void {
      error.textContent = message;
      error.hidden = false;
    },

    dispose(): void {
      unsubscribe();
      strip.remove();
    },
  };
}
