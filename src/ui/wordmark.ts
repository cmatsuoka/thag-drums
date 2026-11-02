import { WORDMARKS } from './wordmark-paths';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A printed word, as a drawing.
 *
 * The face is not shipped with the panel: the words are cut into outlines
 * (see scripts/generate-wordmarks.py) and the panel draws the outlines.
 * An outline stands on the line box of the face, one em high, so it takes
 * the place of the text it replaces, down to the place of its baseline.
 *
 * The drawing carries no name of its own: the caller decides what the
 * assistive technology reads, and the panel keeps the word in the markup
 * for the readers that need it.
 */
export function printedWord(word: string): SVGElement {
  const mark = WORDMARKS[word];
  if (mark === undefined) {
    throw new Error(`the word has no outline: ${word}`);
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', mark.viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', mark.path);

  svg.append(path);
  return svg;
}
