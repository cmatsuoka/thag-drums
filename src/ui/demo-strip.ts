import type { HivedrumEngine } from '../audio/engine';
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
  /** The selected MIDI input changed; null means every input. */
  readonly onMidiSelect: (id: string | null) => void;
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
  engine: HivedrumEngine,
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
  status.append('powered by ');
  const libhivedrumLink = document.createElement('a');
  libhivedrumLink.href = 'https://github.com/cmatsuoka/hivedrum';
  /* The link leaves the demo in another tab: the page that plays the kit
   * must stay alive while the reader follows it. */
  libhivedrumLink.target = '_blank';
  libhivedrumLink.rel = 'noopener noreferrer';
  libhivedrumLink.textContent = 'libhivedrum';
  status.append(libhivedrumLink);
  const version = document.createElement('span');
  status.append(version);
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
  resetButton.setAttribute(
    'aria-label',
    'reset the whole machine: the engine, the memories of every module and the effects',
  );
   resetButton.addEventListener('click', () => {
     if (window.confirm('Are you sure you want to reset the whole machine? This will wipe all current settings.')) {
       options.onReset();
     }
   });


  const midiButton = document.createElement('button');
  midiButton.type = 'button';
  midiButton.className = 'demo-button';
  midiButton.id = 'midi-connect';
  midiButton.textContent = 'Connect a MIDI controller';
  midiButton.addEventListener('click', () => {
    options.onMidiConnect();
  });

  const midiSelect = document.createElement('select');
  midiSelect.className = 'demo-select';
  midiSelect.id = 'midi-input';
  midiSelect.setAttribute('aria-label', 'MIDI input');
  midiSelect.hidden = true;
  midiSelect.addEventListener('change', () => {
    const value = midiSelect.value;
    options.onMidiSelect(value === '' ? null : value);
  });

  const midiStatus = document.createElement('span');
  midiStatus.className = 'demo-midi-status';
  midiStatus.id = 'midi-status';

  actions.append(resetButton, midiButton, midiSelect, midiStatus);
  strip.append(actions);

  host.append(strip);

  const render = (state: EngineState): void => {
    const major = (state.version >> 16) & 0xff;
    const minor = (state.version >> 8) & 0xff;
    const patch = state.version & 0xff;
    version.textContent = ` ${major}.${minor}.${patch}`;
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
      const previous = midiSelect.value;
      const stillThere = devices.some((device) => device.id === previous);

      midiSelect.replaceChildren();

      const all = document.createElement('option');
      all.value = '';
      all.textContent = 'All MIDI inputs';
      midiSelect.append(all);

      for (const device of devices) {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        midiSelect.append(option);
      }

      midiSelect.value = previous !== '' && stillThere ? previous : '';
      midiSelect.hidden = devices.length === 0;

      if (previous !== '' && !stillThere) {
        options.onMidiSelect(null);
      }

      midiStatus.textContent =
        devices.length === 0
          ? 'no MIDI input connected'
          : devices.length === 1
            ? '1 MIDI input available'
            : `${devices.length} MIDI inputs available`;
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
