import type { Instrument } from './protocol';

/**
 * The keyboard map of the kit. The keys of the drums are the ones the
 * library's own example uses, so the demo and the C example are played the
 * same way. The metallic voices have keys of their own.
 */
export const KEY_MAP: Readonly<Record<string, Instrument>> = {
  s: 'kick',
  d: 'snare',
  o: 'tom1',
  i: 'tom2',
  u: 'tom3',
  j: 'hihatClosed',
  l: 'hihatOpen',
  p: 'cymbal',
};

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Play the kit from the keyboard.
 *
 * A key press fires the voice once: the voices are one-shots and there is
 * nothing to release. The auto-repeat of a held key is ignored, so a key
 * that is kept down does not machine-gun the voice.
 *
 * The returned function detaches the handler.
 */
export function attachKeyboard(
  onTrigger: (instrument: Instrument, velocity: number) => void,
): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (isTextField(event.target)) {
      return;
    }
    const instrument = KEY_MAP[event.key.toLowerCase()];
    if (instrument === undefined) {
      return;
    }
    event.preventDefault();
    // The keyboard plays at full velocity: there is no key velocity.
    onTrigger(instrument, 127);
  };

  window.addEventListener('keydown', handler);
  return () => {
    window.removeEventListener('keydown', handler);
  };
}
