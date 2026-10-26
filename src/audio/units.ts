import { Q16_ONE } from './protocol';

/**
 * The conversion between the panel's physical units and the engine's
 * Q16.16. It happens once, at the edge, and it is rounded: a float never
 * drifts into the panel state.
 */

/** Convert a physical value to the engine's Q16.16 unit. */
export function toQ16(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scaled = Math.round(value * Q16_ONE);
  if (scaled > 2147483647) {
    return 2147483647;
  }
  if (scaled < -2147483648) {
    return -2147483648;
  }
  return scaled;
}

/** Convert the engine's Q16.16 unit back to a physical value. */
export function fromQ16(value: number): number {
  return value / Q16_ONE;
}

/** A pitch in Hz. */
export function hzToQ16(hz: number): number {
  return toQ16(hz);
}

/** A decay time in seconds. */
export function secondsToQ16(seconds: number): number {
  return toQ16(seconds);
}

/** A bend in signed semitones. */
export function semitonesToQ16(semitones: number): number {
  return toQ16(semitones);
}

/** A balance between 0 and 1. */
export function scaleToQ16(scale: number): number {
  return toQ16(scale);
}
