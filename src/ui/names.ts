import type { Voice } from '../audio/protocol';

/**
 * The names of the modules, as the panel carries them.
 *
 * A name is spoken and printed: the spoken one is what the assistive
 * technology reads, the printed one is the word that is cut into an
 * outline and drawn on the plate. The Hi-hat is one module with two
 * instruments, the closed one and the open one.
 */
export interface ModuleName {
  /** The name the assistive technology reads. */
  readonly spoken: string;
  /** The word that is printed on the plate, as it is printed. */
  readonly printed: string;
}

export const MODULE_NAMES: Readonly<Record<Voice, ModuleName>> = {
  kick: { spoken: 'Bass', printed: 'BASS' },
  snare: { spoken: 'Snare', printed: 'SNARE' },
  tom1: { spoken: 'Tom 1', printed: 'TOM 1' },
  tom2: { spoken: 'Tom 2', printed: 'TOM 2' },
  tom3: { spoken: 'Tom 3', printed: 'TOM 3' },
  cymbal: { spoken: 'Cymbal', printed: 'CYMBAL' },
  hihat: { spoken: 'Hi-Hat', printed: 'HI HAT' },
};
