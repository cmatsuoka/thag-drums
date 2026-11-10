import { KEY_MAP } from '../audio/keyboard';
import type { Instrument } from '../audio/protocol';
import { MODULE_NAMES } from './names';

/**
 * The player's guide: the keys of the keyboard and the memory positions.
 *
 * The guide lives outside the faceplate, below the console, and it is
 * folded away by default: a reader who knows the machine does not need
 * it, and the faceplate must stay a faceplate. It is a disclosure: the
 * summary opens and closes it, and the assistive technology reads it as
 * a region that can be expanded.
 */

/** The keys of the kit, in the order they stand on the keyboard. */
interface KeyEntry {
  readonly key: string;
  readonly instrument: Instrument;
  readonly label: string;
}

const KEY_ENTRIES: readonly KeyEntry[] = [
  { key: 'S', instrument: 'kick', label: MODULE_NAMES.kick.spoken },
  { key: 'D', instrument: 'snare', label: MODULE_NAMES.snare.spoken },
  { key: 'O', instrument: 'tom1', label: MODULE_NAMES.tom1.spoken },
  { key: 'I', instrument: 'tom2', label: MODULE_NAMES.tom2.spoken },
  { key: 'U', instrument: 'tom3', label: MODULE_NAMES.tom3.spoken },
  { key: 'J', instrument: 'hihatClosed', label: 'Hi-Hat, closed' },
  { key: 'L', instrument: 'hihatOpen', label: 'Hi-Hat, open' },
  { key: 'P', instrument: 'cymbal', label: MODULE_NAMES.cymbal.spoken },
];

/**
 * The keys of the keyboard, read from the map the handler plays from.
 *
 * The table is built from the map itself, so a key that is not played
 * never shows up in the guide, and a key that is played always does.
 */
function keyEntries(): readonly KeyEntry[] {
  return KEY_ENTRIES.filter(
    (entry) => KEY_MAP[entry.key.toLowerCase()] === entry.instrument,
  );
}

function section(title: string): HTMLElement {
  const block = document.createElement('section');
  block.className = 'help-block';
  const heading = document.createElement('h3');
  heading.className = 'help-heading';
  heading.textContent = title;
  block.append(heading);
  return block;
}

export function createHelp(): HTMLElement {
  const details = document.createElement('details');
  details.className = 'help';
  details.id = 'help';

  const summary = document.createElement('summary');
  summary.className = 'help-summary';
  summary.textContent = 'How to play';
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'help-body';
  details.append(body);

  /* The keys of the keyboard. */
  const keys = section('The keys of the keyboard');
  const keyList = document.createElement('dl');
  keyList.className = 'help-keys';
  for (const entry of keyEntries()) {
    const term = document.createElement('dt');
    const kbd = document.createElement('kbd');
    kbd.textContent = entry.key;
    term.append(kbd);
    const definition = document.createElement('dd');
    definition.textContent = entry.label;
    keyList.append(term, definition);
  }
  keys.append(keyList);
  const keyNote = document.createElement('p');
  keyNote.className = 'help-note';
  keyNote.textContent =
    'The keyboard plays at full velocity: a key press fires the voice once, and there is nothing to release.';
  keys.append(keyNote);
  body.append(keys);

  /* The memory positions of a module. */
  const memory = section('The memory positions of a module');
  const memoryList = document.createElement('ul');
  memoryList.className = 'help-list';
  const points: readonly string[] = [
    'A short press on the button of a position picks it and brings back the tone that is stored in it.',
    'A long press — a second, with the lamp of the module blinking — stores the tone the module is playing in that position.',
    'The knobs of the module change the tone it plays, and the tone is not stored until a position is held down. A tone that is not stored is lost when another position is picked.',
    'A position that holds a tone of your own shows it with a number in a darker ink.',
    'The reset button of the module puts the position that is picked back to its built-in tone. The mixer of the module keeps the values you have set.',
    'The memories are kept in the browser, so the kit comes back the way you left it.',
  ];
  for (const point of points) {
    const item = document.createElement('li');
    item.textContent = point;
    memoryList.append(item);
  }
  memory.append(memoryList);
  body.append(memory);

  /* The other trigger sources. */
  const other = section('The other ways to play');
  const otherList = document.createElement('ul');
  otherList.className = 'help-list';
  const others: readonly string[] = [
    'The small button at the foot of a module plays its own voice.',
    'A MIDI controller may be connected; the velocity of the note is the strength of the hit.',
  ];
  for (const point of others) {
    const item = document.createElement('li');
    item.textContent = point;
    otherList.append(item);
  }
  other.append(otherList);
  body.append(other);

  return details;
}
