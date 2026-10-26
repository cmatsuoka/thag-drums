import type { Taper } from './params';

/**
 * The knob widget.
 *
 * A knob is a slider with a travel: the pointer of the knob turns from
 * -135 to +135 degrees while the value walks from the smallest value the
 * engine accepts to the largest one. The taper between the travel and the
 * value follows the unit of the parameter: a pitch and a decay time are
 * logarithmic, a balance and a bend are linear.
 *
 * The knob is operable with a pointer (a vertical drag), with the wheel
 * and with the keyboard (the arrow keys step, the shift key is fine, home
 * and end jump to the bounds). It is a slider for the assistive
 * technology: it carries the role, the range and the value the engine
 * holds.
 */

/** How far a pointer has to travel to cover the whole range, in pixels. */
const DRAG_RANGE = 220;

export interface KnobOptions {
  /** The label that is printed under the knob. */
  readonly label: string;
  /** The unit of the value, for the readout and the ARIA text. */
  readonly unit: string;
  /** The smallest value the engine accepts, in physical units. */
  readonly min: number;
  /** The largest value the engine accepts, in physical units. */
  readonly max: number;
  /** How many decimals the readout shows. */
  readonly decimals: number;
  /** The taper between the knob travel and the value. */
  readonly taper: Taper;
  /** The step of the arrow keys, as a share of the knob travel. */
  readonly step: number;
  /** The step of the arrow keys with the shift key held down. */
  readonly fineStep: number;
  /** The value the knob shows, in physical units. */
  readonly value: number;
  /** The user moved the knob. The value is in physical units. */
  readonly onChange: (value: number) => void;
}

export interface Knob {
  /** The element that carries the slider role. */
  readonly element: HTMLElement;
  /**
   * Show the value the engine holds. The knob ignores the value while it
   * is being dragged: the drag is the truth until the pointer is up.
   */
  setValue(value: number): void;
  dispose(): void;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * The place of a value on the knob travel, between 0 and 1.
 */
function positionOf(
  value: number,
  min: number,
  max: number,
  taper: Taper,
): number {
  if (taper === 'log' && min > 0 && max > min) {
    const ratio = Math.log(value / min) / Math.log(max / min);
    return clamp01(ratio);
  }
  const span = max - min;
  if (span === 0) {
    return 0;
  }
  return clamp01((value - min) / span);
}

/**
 * The value at a place of the knob travel.
 */
function valueOf(
  position: number,
  min: number,
  max: number,
  taper: Taper,
): number {
  if (taper === 'log' && min > 0 && max > min) {
    return min * Math.pow(max / min, position);
  }
  return min + position * (max - min);
}

export function createKnob(options: KnobOptions): Knob {
  const element = document.createElement('div');
  element.className = 'knob';
  element.tabIndex = 0;
  element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', options.label);
  element.setAttribute('aria-valuemin', options.min.toFixed(options.decimals));
  element.setAttribute('aria-valuemax', options.max.toFixed(options.decimals));

  let position = positionOf(
    options.value,
    options.min,
    options.max,
    options.taper,
  );
  let value = options.value;
  let dragging = false;
  let dragStartY = 0;
  let dragStartPosition = 0;

  function readout(): string {
    const text = value.toFixed(options.decimals);
    return options.unit === '' ? text : `${text} ${options.unit}`;
  }

  function render(): void {
    element.style.setProperty('--knob-pos', position.toFixed(4));
    element.setAttribute('aria-valuenow', value.toFixed(options.decimals));
    element.setAttribute('aria-valuetext', readout());
    element.setAttribute('title', `${options.label}: ${readout()}`);
  }

  /**
   * Move the knob to a place of its travel and tell the caller about it.
   */
  function move(next: number, notify: boolean): void {
    position = clamp01(next);
    value = round(
      valueOf(position, options.min, options.max, options.taper),
      options.decimals,
    );
    render();
    if (notify) {
      options.onChange(value);
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    dragStartY = event.clientY;
    dragStartPosition = position;
    element.setPointerCapture(event.pointerId);
    element.focus();
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    const delta = (dragStartY - event.clientY) / DRAG_RANGE;
    move(dragStartPosition + delta, true);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? options.fineStep : options.step;
    let delta = 0;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        delta = step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        delta = -step;
        break;
      case 'PageUp':
        delta = step * 4;
        break;
      case 'PageDown':
        delta = -step * 4;
        break;
      case 'Home':
        event.preventDefault();
        move(0, true);
        return;
      case 'End':
        event.preventDefault();
        move(1, true);
        return;
      default:
        return;
    }
    event.preventDefault();
    move(position + delta, true);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const step = event.shiftKey ? options.fineStep : options.step;
    const direction = event.deltaY < 0 ? 1 : -1;
    move(position + direction * step, true);
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('keydown', onKeyDown);
  element.addEventListener('wheel', onWheel, { passive: false });

  render();

  return {
    element,
    setValue(next: number): void {
      if (dragging) {
        return;
      }
      value = next;
      position = positionOf(next, options.min, options.max, options.taper);
      render();
    },
    dispose(): void {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('wheel', onWheel);
    },
  };
}
