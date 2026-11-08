/**
 * The demo's own storage: a few values of the machine are kept in the
 * browser, so the kit comes back the way it was left.
 *
 * The store of the browser is not always there: a private window may
 * refuse it and the quota may be full. Every read and every write here is
 * guarded, and a failure is not an error: the machine simply forgets.
 *
 * The writes are debounced: a knob that is dragged reports a value for
 * every step of the drag, and the store of the browser is not a place to
 * write in every frame. The last value is written once the knob has been
 * quiet for a second, and the pending one is flushed when the page is
 * hidden or the panel goes away.
 */

/**
 * How long a value waits before it is written to the store.
 *
 * A knob that is dragged reports a value for every step of the drag, and
 * none of them is worth a write. The value is written when the knob has
 * been quiet for a second: that is the value the user meant, and the
 * store of the browser is not touched while the knob is moving.
 */
const WRITE_DELAY_MS = 1000;

/**
 * Read a value from the store of the browser.
 *
 * The value comes back as it was written, as plain JSON: the caller knows
 * what it expects and checks it.
 */
export function readJson(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key);
    if (text === null) {
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    // No store, no permission or broken data: there is nothing to read.
    return null;
  }
}

/**
 * Write a value to the store of the browser.
 *
 * A failure is swallowed on purpose: the machine keeps playing without
 * the store.
 */
export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The store is full or blocked: the value is lost, the kit goes on.
  }
}

/**
 * A writer that waits for the value to settle before it writes it.
 */
export interface DebouncedWriter {
  /** Remember a value and write it once the delay is over. */
  save(value: unknown): void;
  /**
   * Remember how to build the value and write it once the delay is over.
   *
   * The value is built when it is written and not before: a knob that is
   * dragged reports a value for every step, and the whole picture of the
   * machine does not have to be put together for every one of them.
   */
  saveLater(produce: () => unknown): void;
  /** Write the value that is waiting, right now. */
  flush(): void;
  /** Write the value that is waiting and let the writer go. */
  dispose(): void;
}

/**
 * A writer for one key of the store of the browser.
 *
 * Only the last value matters: a knob that is dragged reports a value for
 * every step, and the last one is the value of the knob.
 */
export function createDebouncedWriter(
  key: string,
  delayMs: number = WRITE_DELAY_MS,
): DebouncedWriter {
  let timer: number | null = null;
  let pending: unknown = undefined;
  let producer: (() => unknown) | null = null;

  const write = (): void => {
    if (producer !== null) {
      const build = producer;
      producer = null;
      pending = undefined;
      writeJson(key, build());
      return;
    }
    if (pending === undefined) {
      // Nothing is waiting: there is nothing to write.
      return;
    }
    const value = pending;
    pending = undefined;
    writeJson(key, value);
  };

  const schedule = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = null;
      write();
    }, delayMs);
  };

  return {
    save(value: unknown): void {
      producer = null;
      pending = value;
      schedule();
    },

    saveLater(build: () => unknown): void {
      pending = undefined;
      producer = build;
      schedule();
    },

    flush(): void {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      write();
    },

    dispose(): void {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      write();
    },
  };
}
