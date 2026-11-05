/**
 * The speed stripe of the effects module.
 *
 * A painted black strip that stands to the right of the name of the
 * module. It is drawn in the same space as the lettering: the outline of
 * the word and the outline of the stripe are both cut in the em of the
 * face, so the stripe stands as high as the letters of the name and
 * scales with them.
 *
 * Its right end is cut square and its left end comes to a point, in the
 * angle of the right side of the X of the name: the two slanted edges of
 * the point run parallel to the arms of the letter.
 *
 * The strip is painted a light gray, darker than the brushed aluminium of
 * the plate, and the paint is flat for now: the diagonals that would cut
 * it are not there yet.
 *
 * The drawing carries no name of its own: the module's name is spelled
 * out for the readers next to it.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The box of the drawing, in the em of the face: it is the same box the
 * outlines of the words are cut in.
 */
const WIDTH = 4160;
const HEIGHT = 1000;

/**
 * The band of the metal, in the em of the face.
 *
 * It is the band the letters of the name stand in: the cap band of the
 * face, from the top of the capitals to the baseline.
 */
const CAP_TOP = 70.5;
const CAP_BOTTOM = 834.5;
const CAP_MIDDLE = (CAP_TOP + CAP_BOTTOM) / 2;

/**
 * The angle of the arms of the X of the name, in degrees. The point of
 * the left end of the strip follows it.
 */
const ANGLE = 61.9;

/**
 * How far the point of the left end reaches to the left, in the angle of
 * the arms of the letter.
 */
const TIP = CAP_MIDDLE / Math.tan((ANGLE * Math.PI) / 180);

/**
 * The outline of the strip: the point at the left, the square end at the
 * right, and the four corners in between.
 */
function outline(): string {
  return [
    `M0 ${CAP_MIDDLE}`,
    `L${TIP.toFixed(1)} ${CAP_TOP}`,
    `L${WIDTH} ${CAP_TOP}`,
    `L${WIDTH} ${CAP_BOTTOM}`,
    `L${TIP.toFixed(1)} ${CAP_BOTTOM}`,
    'Z',
  ].join(' ');
}

/**
 * The paint of the strip: the outline of the band.
 */
function painted(): string {
  return outline();
}

/**
 * The speed stripe of the effects module.
 *
 * The drawing carries no name of its own: the module's name is spelled
 * out for the readers next to it.
 */
export function speedStripe(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'fx-stripe');

  const defs = document.createElementNS(SVG_NS, 'defs');

  /* The paint of the strip: it is a light gray, and it is not flat: the
   * metal catches the light along its top and softens towards its foot.
   * It stays darker than the brushed aluminium of the plate. */
  const metal = document.createElementNS(SVG_NS, 'linearGradient');
  metal.setAttribute('id', 'fx-stripe-metal');
  metal.setAttribute('x1', '0');
  metal.setAttribute('y1', '0');
  metal.setAttribute('x2', '0');
  metal.setAttribute('y2', '1');
  const top = document.createElementNS(SVG_NS, 'stop');
  top.setAttribute('offset', '0');
  top.setAttribute('stop-color', '#c4c9cc');
  const upper = document.createElementNS(SVG_NS, 'stop');
  upper.setAttribute('offset', '0.18');
  upper.setAttribute('stop-color', '#b8bdc1');
  const bottom = document.createElementNS(SVG_NS, 'stop');
  bottom.setAttribute('offset', '0.62');
  bottom.setAttribute('stop-color', '#adb2b6');
  const foot = document.createElementNS(SVG_NS, 'stop');
  foot.setAttribute('offset', '1');
  foot.setAttribute('stop-color', '#9fa5a9');
  metal.append(top, upper, bottom, foot);
  defs.append(metal);

  svg.append(defs);

  /* The paint of the strip, with the diagonals cut out of it. It is a
   * silk screen print on the faceplate: it has no outline and no raised
   * edge, only the paint itself. */
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', painted());
  body.setAttribute('fill-rule', 'evenodd');
  body.setAttribute('fill', 'url(#fx-stripe-metal)');
  svg.append(body);

  return svg;
}
