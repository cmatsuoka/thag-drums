import type { Instrument } from './protocol';

/**
 * The note-to-instrument table.
 *
 * The mapping is host-side data. Every instrument owns a small group of
 * neighbouring notes, so that a flam is two keys a finger apart. The
 * Hi-hats sit above the drums, on the F# and the A# of the octave above
 * the Toms. The Cymbal has no plate and no note. A note that is not in
 * the table is ignored.
 */
export const MIDI_NOTE_MAP: Readonly<Record<number, Instrument>> = {
  36: 'kick', // C2
  37: 'kick', // C#2
  38: 'snare', // D2
  39: 'snare', // D#2
  43: 'tom3', // G2
  44: 'tom3', // G#2
  45: 'tom2', // A2
  46: 'tom2', // A#2
  47: 'tom2', // B2
  50: 'tom1', // D3
  51: 'tom1', // D#3
  53: 'hihatClosed', // F3
  54: 'hihatClosed', // F#3
  58: 'hihatOpen', // A#3
};

/** A MIDI input the demo can listen to. */
export interface MidiDevice {
  readonly id: string;
  readonly name: string;
}

export interface MidiHandlers {
  /** A note was played: the instrument and the velocity of the hit. */
  onTrigger: (instrument: Instrument, velocity: number) => void;
  /** The list of connected inputs changed. */
  onDevices: (devices: MidiDevice[]) => void;
  /** Something went wrong; the demo carries on without MIDI. */
  onError: (message: string) => void;
}

/**
 * The optional Web MIDI input.
 *
 * The browser asks the user for permission, so the request has to happen
 * from a gesture. A browser without Web MIDI, or a user who declines the
 * permission, simply does without it: the keyboard still plays the whole
 * kit.
 */
export class MidiInput {
  private access: WebMidi.MIDIAccess | null = null;
  private readonly handlers: MidiHandlers;
  private readonly attached = new Map<string, WebMidi.MIDIInput>();
  private selectedId: string | null = null;

  constructor(handlers: MidiHandlers) {
    this.handlers = handlers;
  }

  /** The input the demo listens to, or null when it listens to all of them. */
  get selected(): string | null {
    return this.selectedId;
  }

  /**
   * Listen to one input, or to every connected input when id is null.
   * A selection that is not connected right now is kept: the input is
   * picked up again when it comes back.
   */
  select(id: string | null): void {
    this.selectedId = id;
    this.listen();
  }

  /** Whether this browser has Web MIDI at all. */
  static get supported(): boolean {
    return typeof navigator !== 'undefined' &&
      typeof navigator.requestMIDIAccess === 'function';
  }

  /** The inputs that are connected right now. */
  get devices(): MidiDevice[] {
    const access = this.access;
    if (access === null) {
      return [];
    }
    const devices: MidiDevice[] = [];
    for (const input of access.inputs.values()) {
      devices.push({ id: input.id, name: input.name ?? input.id });
    }
    return devices;
  }

  /**
   * Ask for the MIDI permission and listen to every connected input.
   * The call has to come from a user gesture.
   */
  async connect(): Promise<void> {
    if (!MidiInput.supported) {
      this.handlers.onError('this browser does not support Web MIDI');
      return;
    }

    try {
      const access = await navigator.requestMIDIAccess({
        sysex: false,
        software: false,
      });
      this.access = access;
      access.onstatechange = () => {
        this.listen();
        this.handlers.onDevices(this.devices);
      };
      this.listen();
      this.handlers.onDevices(this.devices);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.handlers.onError(`the MIDI permission was not granted (${reason.message})`);
    }
  }

  /** Stop listening and let go of the inputs. */
  disconnect(): void {
    for (const input of this.attached.values()) {
      input.onmidimessage = null;
    }
    this.attached.clear();
    this.access = null;
  }

  private listen(): void {
    const access = this.access;
    if (access === null) {
      return;
    }

    const selected = this.selectedId;

    for (const [id, input] of this.attached) {
      const wanted =
        selected === null || id === selected ? access.inputs.has(id) : false;
      if (!wanted) {
        input.onmidimessage = null;
        this.attached.delete(id);
      }
    }

    for (const [id, input] of access.inputs) {
      if (selected !== null && id !== selected) {
        continue;
      }
      if (this.attached.has(id)) {
        continue;
      }
      input.onmidimessage = (event: WebMidi.MIDIMessageEvent) => {
        this.handleMessage(event);
      };
      this.attached.set(id, input);
    }
  }

  private handleMessage(event: WebMidi.MIDIMessageEvent): void {
    const data = event.data;
    if (data === undefined || data.length < 3) {
      return;
    }

    const status = data[0] ?? 0;
    if ((status & 0xf0) !== 0x90) {
      // Only note-on carries a hit. Everything else is ignored.
      return;
    }

    const note = data[1] ?? 0;
    const velocity = data[2] ?? 0;
    if (velocity === 0) {
      // A note-on with velocity 0 is a note-off, and the voices are
      // one-shots: there is nothing to release.
      return;
    }

    const instrument = MIDI_NOTE_MAP[note];
    if (instrument === undefined) {
      return;
    }

    this.handlers.onTrigger(instrument, velocity);
  }
}
