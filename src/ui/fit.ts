/**
 * The responsive scale of the console.
 *
 * The faceplate has the shape of the hardware: a wide console that is
 * wider than a phone is. When the viewport is too narrow for it, the
 * whole console is scaled down instead of being folded into a column, so
 * a phone held sideways still gets the wide shape of the machine.
 *
 * The scale is a transform: the layout of the panel does not change, only
 * the size it is drawn at.
 */

export interface Fitter {
  /** Fit the console into its host again. */
  update(): void;
  dispose(): void;
}

export function createFitter(host: HTMLElement, content: HTMLElement): Fitter {
  let lastAvailable = -1;
  let lastDesign = '';

  const update = (): void => {
    const designWidth = content.offsetWidth;
    const designHeight = content.offsetHeight;
    const available = host.clientWidth;
    if (designWidth === 0 || available === 0) {
      // The console is not on the page (yet): there is nothing to fit.
      return;
    }

    const design = `${designWidth}x${designHeight}`;
    if (available === lastAvailable && design === lastDesign) {
      return;
    }
    lastAvailable = available;
    lastDesign = design;

    const scale = Math.min(1, available / designWidth);
    const offset = Math.max(0, (available - designWidth * scale) / 2);
    content.style.transform =
      `translateX(${offset.toFixed(2)}px) scale(${scale.toFixed(5)})`;
    host.style.height = `${Math.ceil(designHeight * scale)}px`;
  };

  const onResize = (): void => {
    update();
  };

  /* The host is watched for its width, the content for its height: the
   * console grows when the knobs are built and when the font arrives, and
   * the host has to make room for it. */
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(host);
    observer.observe(content);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  update();

  return {
    update,
    dispose(): void {
      observer?.disconnect();
      observer = null;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    },
  };
}
