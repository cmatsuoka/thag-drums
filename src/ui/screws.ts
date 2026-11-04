/**
 * The four screws of a module plate, one in each corner.
 *
 * A plate may be an instrument module, an unwired one or a blank one; the
 * screws are the same. The turn of each screw is fixed by the place it
 * has on the panel: the machine looks the same on every load, and two
 * renders of it never differ.
 */
export function appendScrews(element: HTMLElement, place: string): void {
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const screw = document.createElement('span');
    screw.className = `screw screw-${corner}`;
    screw.style.setProperty(
      '--screw-angle',
      `${screwAngle(place, corner)}deg`,
    );
    screw.setAttribute('aria-hidden', 'true');
    element.append(screw);
  }
}

/**
 * The turn of the slot of a screw, in degrees.
 *
 * A screw is turned by a hand, and no two of them end up pointing the
 * same way. The turn of each screw is fixed by the place it has on the
 * panel: the machine looks the same on every load, and two renders of it
 * never differ.
 */
function screwAngle(place: string, corner: string): number {
  const key = `${place}/${corner}`;

  /* A hash of the place of the screw, so that every one of them gets a
   * turn of its own. */
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  /* One round of mixing, so that the screws that stand near each other
   * on the panel do not end up near each other in their turn. */
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;

  /* A slot has no head and no tail, so half a turn is the same as none. */
  return (hash >>> 0) % 180;
}
