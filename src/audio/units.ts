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
