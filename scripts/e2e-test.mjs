/*
 * e2e-test.mjs - the browser check of the panel and of the audio path.
 *
 * The page is served by Vite and opened in Chromium. The test plays the
 * kit from the keyboard, moves a knob with the keyboard alone, picks a
 * tone, edits it, switches back and forth, resets the engine and checks
 * that a value outside the engine's range is shown clamped. It watches
 * the engine's own state to see that every step arrived.
 *
 * Run it with `npm run e2e` after `npm run build:wasm`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 5178;
const URL = `http://localhost:${PORT}/`;
const TIMEOUT = 20000;

/* The order of the engine's own tables. */
const VOICES = ['kick', 'snare', 'tom1', 'tom2', 'tom3', 'cymbal', 'hihat'];

/* The voices that have a plate of their own on the panel: the five drums
 * and the two metallic voices. The effects module is no voice of the
 * engine. */
const PLATED_VOICES = ['kick', 'snare', 'tom1', 'tom2', 'tom3', 'hihat', 'cymbal'];
const PARAMS = [
  'noisePitch',
  'tonePitch',
  'bend',
  'decay',
  'noiseTone',
  'clickTone',
  'sweep',
  'bellCymbal',
  'volume',
  'pan',
  'sensitivity',
  'fxSend',
  'noiseBody',
  'drive',
];

/**
 * Find a Chromium in the Playwright browser cache.
 *
 * The installed playwright-core may expect a newer build than the one in
 * the cache, and an older build still speaks the same protocol. Set
 * CHROMIUM_PATH to point at a browser of your own.
 */
function findChromium() {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit !== undefined && existsSync(explicit)) {
    return explicit;
  }

  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    path.join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) {
    return undefined;
  }

  const builds = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((left, right) => Number(left.slice(9)) - Number(right.slice(9)))
    .reverse();

  for (const build of builds) {
    const binary = path.join(root, build, 'chrome-linux', 'chrome');
    if (existsSync(binary)) {
      return binary;
    }
  }
  return undefined;
}

let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log(`ok   ${message}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${message}`);
}

function equal(actual, expected, message) {
  check(
    actual === expected,
    `${message} (expected ${expected}, got ${actual})`,
  );
}

async function startServer() {
  // E2E_PREVIEW runs the check against the production build instead of
  // the dev server.
  const preview = process.env.E2E_PREVIEW !== undefined;
  const args = preview
    ? ['preview', '--port', String(PORT), '--strictPort']
    : ['--port', String(PORT), '--strictPort'];
  const server = spawn('node_modules/.bin/vite', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      if (response.ok) {
        return server;
      }
    } catch {
      // The server is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  server.kill();
  throw new Error('the dev server did not come up');
}

/** The peak the engine reports, in the engine's own state. */
async function readPeak(page) {
  return page.evaluate(() => window.hive?.engineState?.peak ?? 0);
}

/** Wait until the engine renders something louder than the given peak. */
async function waitForPeak(page, minimum) {
  await page.waitForFunction(
    (minimum) => (window.hive?.engineState?.peak ?? 0) > minimum,
    minimum,
    { timeout: TIMEOUT },
  );
}

/** The values the engine holds, in the engine's own order. */
async function readEngineValues(page) {
  return page.evaluate(() => {
    const state = window.hive?.engineState;
    return state === null || state === undefined
      ? null
      : Array.from(state.values);
  });
}

/**
 * What the engine holds: the parameters of the voices, read out of the
 * engine's own snapshot.
 */
async function readEngineState(page) {
  return page.evaluate(() => {
    const state = window.hive?.engineState;
    return state === null || state === undefined
      ? null
      : {
          values: Array.from(state.values),
        };
  });
}

/**
 * What the engine holds for the shared FX bus, read out of the engine's
 * own snapshot.
 */
async function readEngineFxState(page) {
  return page.evaluate(() => {
    const state = window.hive?.engineState;
    return state === null || state === undefined || !state.fx
      ? []
      : Array.from(state.fx);
  });
}

/** The value the engine holds for a knob of a strip. */
function stateValue(state, voice, param) {
  return state.values[engineIndex(voice, param)];
}

/**
 * The loudest sample the engine has rendered for as long as it is asked.
 *
 * The engine posts the peak of every block it renders, so the page is
 * polled for the duration and the loudest block seen is returned.
 */
async function measurePeak(page, durationMs) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let max = 0;
        const start = performance.now();
        const tick = () => {
          const peak = window.hive?.engineState?.peak ?? 0;
          if (peak > max) {
            max = peak;
          }
          if (performance.now() - start < duration) {
            requestAnimationFrame(tick);
          } else {
            resolve(max);
          }
        };
        tick();
      }),
    durationMs,
  );
}

/** What the panel shows: the value of every knob of every strip. */
async function readPanelValues(page) {
  return page.evaluate(() => {
    const values = {};
    for (const knob of document.querySelectorAll('.knob')) {
      const strip = knob.closest('.strip');
      const key = `${strip?.dataset.voice ?? strip?.dataset.place}.${knob.dataset.param ?? knob.dataset.control}`;
      values[key] = {
        stored: Number(knob.getAttribute('data-value')),
        aria: knob.getAttribute('aria-valuenow'),
        text: knob.getAttribute('aria-valuetext'),
        role: knob.getAttribute('role'),
        min: knob.getAttribute('aria-valuemin'),
        max: knob.getAttribute('aria-valuemax'),
      };
    }
    return values;
  });
}

function engineIndex(voice, param) {
  return VOICES.indexOf(voice) * PARAMS.length + PARAMS.indexOf(param);
}

/** Wait until the engine holds a value for a voice and a parameter. */
async function waitForEngineValue(page, voice, param, expected) {
  await page.waitForFunction(
    ({ voice, param, expected, voices, params }) => {
      const state = window.hive?.engineState;
      if (state === null || state === undefined) {
        return false;
      }
      const index = voices.indexOf(voice) * params.length + params.indexOf(param);
      return state.values[index] === expected;
    },
    { voice, param, expected, voices: VOICES, params: PARAMS },
    { timeout: TIMEOUT },
  );
}

/** Wait until the engine holds another value for a voice and a parameter. */
async function waitForEngineValueChange(page, voice, param, previous) {
  await page.waitForFunction(
    ({ voice, param, previous, voices, params }) => {
      const state = window.hive?.engineState;
      if (state === null || state === undefined) {
        return false;
      }
      const index = voices.indexOf(voice) * params.length + params.indexOf(param);
      return state.values[index] !== previous;
    },
    { voice, param, previous, voices: VOICES, params: PARAMS },
    { timeout: TIMEOUT },
  );
}

const server = await startServer();
const executablePath = findChromium();
const browser = await chromium.launch({
  ...(executablePath === undefined ? {} : { executablePath }),
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const consoleErrors = [];

try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto(URL);

  /* The engine comes up and reports its version. */
  await page.waitForFunction(
    () => {
      const status = document.querySelector('#engine-status');
      return (status?.textContent ?? '').includes('libhive 0.');
    },
    undefined,
    { timeout: TIMEOUT },
  );
  /* The version the engine reports is the version of the library it was
   * built with: the panel may not make one up. */
  const status = await page.locator('#engine-status').textContent();
  const reported = await page.evaluate(() => {
    const version = window.hive?.engineState?.version ?? 0;
    const major = (version >> 16) & 0xff;
    const minor = (version >> 8) & 0xff;
    const patch = version & 0xff;
    return `${major}.${minor}.${patch}`;
  });
  check(
    (status ?? '').includes(`libhive ${reported}`),
    `the engine reports its version (${(status ?? '').trim()})`,
  );

  /* The panel: the five drum modules, the hi-hat, the cymbal and the
   * effects module at the end of the row. */
  await page.waitForFunction(
    () => document.querySelectorAll('.strip .knob').length === 81,
    undefined,
    { timeout: TIMEOUT },
  );
  equal(
    await page.locator('.strip').count(),
    8,
    'the panel has the eight modules',
  );
  equal(
    await page.locator('.strip-blank').count(),
    0,
    'no module is blank any more',
  );
  equal(
    await page.locator('.strip .lamp').count(),
    7,
    'every voice module draws its lamp',
  );

  /* The effects module: a plate of its own, with a layout of its own. It
   * has no lamp, no trigger and no reset: it carries the controls of the
   * kit's effects and a display that shows the output signal. */
  equal(
    await page.locator('.strip-fx-module').count(),
    1,
    'the effects module is on the panel',
  );
  equal(
    await page.locator('.strip-fx-module .lamp').count(),
    0,
    'the effects module draws no lamp',
  );
  equal(
    await page.locator('.strip-fx-module .strip-trigger').count(),
    0,
    'the effects module has no trigger button',
  );
  equal(
    await page.locator('.strip-fx-module .strip-reset').count(),
    0,
    'the effects module has no reset button',
  );
  equal(
    await page.locator('.strip-fx-module .knob').count(),
    9,
    'the effects module has nine knobs',
  );
  equal(
    (await page.locator('.strip-fx-module .fx-caption').allTextContents()).join(','),
    'reverb,gate',
    'the effects module names its two effects',
  );
  for (const control of [
    'roomSize',
    'damp',
    'width',
    'level',
    'threshold',
    'range',
    'attack',
    'hold',
    'release',
  ]) {
    equal(
      await page.locator(`.strip-fx-module .knob[data-control="${control}"]`).count(),
      1,
      `the effects module has a ${control} knob`,
    );
  }
  equal(
    await page.locator('.strip-fx-module .fx-scope').count(),
    1,
    'the effects module has a display',
  );

  /* The metallic modules: the hi-hat and the cymbal, wired to the engine
   * like the drums. Each carries the controls its own voice has and
   * nothing else: the Pitch and the Color of its noise filter, the Tone
   * Pitch, the Decay, the Noise/Tone and the Bell, plus the Bend and Sweep
   * of the Cymbal. The Hi-hat has no Bend or Sweep, which are fixed at
   * zero on it. */
  const METALLIC = {
    hihat: {
      knobs: ['noisePitch', 'tonePitch', 'noiseBody', 'decay', 'noiseTone', 'bellCymbal'],
      absent: ['sweep', 'bend', 'clickTone'],
    },
    cymbal: {
      knobs: ['noisePitch', 'tonePitch', 'noiseBody', 'sweep', 'bend', 'decay', 'noiseTone', 'bellCymbal'],
      absent: ['clickTone'],
    },
  };
  for (const place of ['hihat', 'cymbal']) {
    equal(
      await page.locator(`.strip-${place}`).count(),
      1,
      `the ${place} module is on the panel`,
    );
    equal(
      await page.locator(`.strip-${place} .strip-knobs .knob`).count(),
      METALLIC[place].knobs.length,
      `the ${place} module has its sound knobs`,
    );
    for (const param of METALLIC[place].knobs) {
      equal(
        await page.locator(`.strip-${place} .knob[data-param="${param}"]`).count(),
        1,
        `the ${place} module has a ${param} knob`,
      );
    }
    for (const param of METALLIC[place].absent) {
      equal(
        await page.locator(`.strip-${place} .knob[data-param="${param}"]`).count(),
        0,
        `the ${place} module has no ${param} knob`,
      );
    }
    equal(
      await page.locator(`.strip-${place} .strip-mix .knob`).count(),
      3,
      `the ${place} module has the three mixer knobs`,
    );
    equal(
      await page.locator(`.strip-${place} .screw`).count(),
      4,
      `the ${place} module carries the four screws`,
    );
    equal(
      await page.locator(`.strip-${place} .lamp`).count(),
      1,
      `the ${place} module draws its lamp`,
    );
  }

  /* Every voice module has a second, shorter column: the mixer of the
   * channel. */
  for (const voice of PLATED_VOICES) {
    equal(
      await page.locator(`.strip[data-voice="${voice}"] .strip-mix .knob`).count(),
      3,
      `the ${voice} has a mixer column of three knobs`,
    );
    for (const param of ['volume', 'pan', 'sensitivity']) {
      equal(
        await page
          .locator(`.strip[data-voice="${voice}"] .strip-mix .knob[data-param="${param}"]`)
          .count(),
        1,
        `the ${voice} has a ${param} knob in its mixer column`,
      );
    }
  }

  /* No module carries a control the engine does not support: the Snare has
   * no sweep knob any more, and every voice has a Pan knob. The metallic
   * voices carry a sweep of their own only when the engine has one. */
  for (const voice of PLATED_VOICES) {
    if (voice === 'hihat' || voice === 'cymbal') {
      continue;
    }
    equal(
      await page.locator(`.strip[data-voice="${voice}"] .knob[data-param="sweep"]`).count(),
      0,
      `the ${voice} has no sweep knob`,
    );
  }
  for (const voice of PLATED_VOICES) {
    equal(
      await page.locator(`.strip[data-voice="${voice}"] .knob[data-param="pan"]`).count(),
      1,
      `the ${voice} has a pan knob`,
    );
  }

  /* Every knob is a slider, and its ARIA range is the engine's own. */
  const panel = await readPanelValues(page);
  const engineState = await readEngineState(page);
  let roles = 0;
  let ranges = 0;
  let stored = 0;
  for (const [key, knob] of Object.entries(panel)) {
    if (knob.role === 'slider') {
      roles += 1;
    }
    if (knob.min !== null && knob.max !== null && knob.min !== knob.max) {
      ranges += 1;
    }
    const [voice, param] = key.split('.');
    if (!VOICES.includes(voice) || !PARAMS.includes(param)) {
      // A knob of the host is not wired to the engine: it holds no value
      // of its own.
      continue;
    }
    if (knob.stored === stateValue(engineState, voice, param)) {
      stored += 1;
    }
  }
  const knobTotal = Object.keys(panel).length;
  const wiredTotal = Object.keys(panel).filter((key) => {
    const [voice, param] = key.split('.');
    return VOICES.includes(voice) && PARAMS.includes(param);
  }).length;
  equal(roles, knobTotal, 'every knob is a slider');
  equal(ranges, knobTotal, 'every knob carries the range of its control');
  equal(
    stored,
    wiredTotal,
    'every wired knob shows the value the engine stored',
  );
  equal(
    engineState?.values?.length ?? 0,
    VOICES.length * PARAMS.length,
    'the engine holds the seven voices',
  );

  /* The keyboard plays the Bass, and the engine renders it. */
  await page.keyboard.press('s');
  await waitForPeak(page, 0);
  check((await readPeak(page)) > 0, 'the keyboard plays the Bass and the engine renders it');

  /* The other voices play too. */
  for (const key of ['d', 'o', 'i', 'u']) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(200);
  check((await readPeak(page)) > 0, 'the other voices play from the keyboard');

  /* The metallic voices play from the keyboard: the closed hi-hat on J,
   * the open one on L and the cymbal on P. */
  for (const key of ['j', 'l', 'p']) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(200);
  check((await readPeak(page)) > 0, 'the metallic voices play from the keyboard');

  /* The hi-hat has two instruments and one lamp: the closed one and the
   * open one light the same lamp. */
  await page.keyboard.press('j');
  await page.waitForFunction(
    () =>
      document
        .querySelector('#lamp-hihat-trigger')
        ?.classList.contains('is-lit') === true,
    undefined,
    { timeout: TIMEOUT },
  );
  check(true, 'the hi-hat lamp lights while the hi-hat is sounding');

  /* Every voice module carries a trigger button under its mixer knobs,
   * and the button plays the module's own voice. The effects module has
   * no voice of its own, so it has no trigger button. */
  equal(
    await page.locator('.strip-trigger').count(),
    PLATED_VOICES.length,
    'every voice module has a trigger button',
  );

  await page.locator('.strip[data-voice="snare"] .strip-trigger').click();
  await waitForPeak(page, 0);
  check(
    (await readPeak(page)) > 0,
    'the trigger button of a module plays its own voice',
  );

  /* Every voice module carries four memory buttons and a reset button. */
  equal(
    await page.locator('.strip-mem').count(),
    PLATED_VOICES.length * 4,
    'every voice module has four memory buttons',
  );
  equal(
    await page.locator('.strip-reset').count(),
    PLATED_VOICES.length,
    'every voice module has a reset button',
  );

  /* The reset of a module throws the knobs away, so it has to be held
   * down: a short press leaves the module as it is, and the lamp of the
   * module blinks while the button is held. */
  const tomTone = page.locator(
    '.strip[data-voice="tom1"] .knob[data-param="tonePitch"]',
  );
  const tomDefault = await page.evaluate(
    ({ voice, param }) => {
      const info = window.hive?.paramInfo ?? [];
      const entry = info.find((e) => e.voice === voice && e.param === param);
      return entry?.default ?? null;
    },
    {
      voice: VOICES.indexOf('tom1'),
      param: PARAMS.indexOf('tonePitch'),
    },
  );

  await tomTone.press('ArrowUp');
  await waitForEngineValueChange(page, 'tom1', 'tonePitch', tomDefault);

  const resetButton = page.locator('.strip[data-voice="tom1"] .strip-reset');
  const resetBox = await resetButton.boundingBox();
  await page.mouse.move(
    resetBox.x + resetBox.width / 2,
    resetBox.y + resetBox.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(200);
  check(
    await page.evaluate(
      () =>
        document
          .querySelector('#lamp-tom1-trigger')
          ?.classList.contains('is-blinking') === true,
    ),
    'the lamp of the module blinks while the reset is held',
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  check(
    (await readEngineValues(page))[engineIndex('tom1', 'tonePitch')] !==
      tomDefault,
    'a short press on the reset leaves the knobs where they are',
  );

  /* A hold of a second puts the knobs of the module back to their
   * defaults. */
  await page.mouse.down();
  await page.waitForTimeout(1400);
  await page.mouse.up();
  await waitForEngineValue(page, 'tom1', 'tonePitch', tomDefault);
  check(
    Number(await tomTone.getAttribute('data-value')) === tomDefault,
    'a hold on the reset puts the knobs back to their defaults',
  );

  /* The memory positions of a module: one of them is always selected,
   * and the selected one is the tone the engine is playing. */
  const selectedMemory = async (voice) =>
    page.evaluate((voice) => {
      const buttons = document.querySelectorAll(
        `.strip[data-voice="${voice}"] .strip-mem`,
      );
      for (const button of buttons) {
        if (button.getAttribute('aria-pressed') === 'true') {
          return Number(button.dataset.position);
        }
      }
      return 0;
    }, voice);

  for (const voice of PLATED_VOICES) {
    equal(
      await selectedMemory(voice),
      1,
      `the ${voice} module starts on its first memory position`,
    );
  }

  const markedSelection = await page.evaluate(
    () =>
      document.querySelectorAll('.strip-mem.is-selected').length ===
      document.querySelectorAll('.strip[data-voice]').length,
  );
  check(markedSelection, 'the selected memory position is marked on the faceplate');

  /* The first position of the snare is a tone of its own: the values it
   * was given. */
  const q16 = (value) => Math.round(value * 65536);
  const snareInfo = await page.evaluate(
    ({ voices, params }) => {
      const info = window.hive?.paramInfo ?? [];
      const voice = voices.indexOf('snare');
      const out = {};
      for (const entry of info) {
        if (entry.voice === voice) {
          out[params[entry.param]] = entry;
        }
      }
      return out;
    },
    { voices: VOICES, params: PARAMS },
  );

  const snareState = await readEngineState(page);
  equal(
    stateValue(snareState, 'snare', 'noisePitch'),
    q16(14000),
    'the first position of the snare holds the noise it was given',
  );
  equal(
    stateValue(snareState, 'snare', 'tonePitch'),
    q16(96),
    'the first position of the snare holds the tone it was given',
  );
  equal(
    stateValue(snareState, 'snare', 'bend'),
    q16(19.4),
    'the first position of the snare holds the bend it was given',
  );
  equal(
    stateValue(snareState, 'snare', 'noiseTone'),
    q16(0.5),
    'the first position of the snare holds the noise/tone it was given',
  );
  equal(
    stateValue(snareState, 'snare', 'clickTone'),
    q16(0.64),
    'the first position of the snare holds the click it was given',
  );
  equal(
    stateValue(snareState, 'snare', 'decay'),
    q16(0.61),
    'the first position of the snare holds the decay it was given',
  );

  /* Picking a position recalls the tone in it. The first two positions
   * of the snare are tones of their own. */
  const snareMemory = (position) =>
    page.locator(`.strip[data-voice="snare"] .strip-mem[data-position="${position}"]`);

  await snareMemory(2).click();
  await page.waitForTimeout(300);
  equal(
    await selectedMemory('snare'),
    2,
    'the second position of the snare is selected',
  );
  const snareSecond = await readEngineState(page);
  equal(
    stateValue(snareSecond, 'snare', 'noisePitch'),
    q16(6044),
    'the second position of the snare holds the noise it was given',
  );
  equal(
    stateValue(snareSecond, 'snare', 'tonePitch'),
    q16(92),
    'the second position of the snare holds the tone it was given',
  );
  equal(
    stateValue(snareSecond, 'snare', 'bend'),
    q16(8.5),
    'the second position of the snare holds the bend it was given',
  );
  equal(
    stateValue(snareSecond, 'snare', 'decay'),
    q16(0.53),
    'the second position of the snare holds the decay it was given',
  );
  equal(
    stateValue(snareSecond, 'snare', 'noiseTone'),
    q16(0.33),
    'the second position of the snare holds the noise/tone it was given',
  );
  equal(
    stateValue(snareSecond, 'snare', 'clickTone'),
    q16(0.3),
    'the second position of the snare holds the click it was given',
  );

  /* The third position of the snare is a tone of its own too. */
  await snareMemory(3).click();
  await page.waitForTimeout(300);
  const snareThird = await readEngineState(page);
  equal(
    stateValue(snareThird, 'snare', 'noisePitch'),
    q16(2086),
    'the third position of the snare holds the noise it was given',
  );
  equal(
    stateValue(snareThird, 'snare', 'tonePitch'),
    q16(118),
    'the third position of the snare holds the tone it was given',
  );
  equal(
    stateValue(snareThird, 'snare', 'bend'),
    q16(2.4),
    'the third position of the snare holds the bend it was given',
  );
  equal(
    stateValue(snareThird, 'snare', 'decay'),
    q16(0.56),
    'the third position of the snare holds the decay it was given',
  );
  equal(
    stateValue(snareThird, 'snare', 'noiseTone'),
    q16(0.05),
    'the third position of the snare holds the noise/tone it was given',
  );
  equal(
    stateValue(snareThird, 'snare', 'clickTone'),
    q16(0.16),
    'the third position of the snare holds the click it was given',
  );

  /* The fourth position of the snare is a tone of its own too. */
  await snareMemory(4).click();
  await page.waitForTimeout(300);
  const snareFourth = await readEngineState(page);
  equal(
    stateValue(snareFourth, 'snare', 'noisePitch'),
    q16(4433),
    'the fourth position of the snare holds the noise it was given',
  );
  equal(
    stateValue(snareFourth, 'snare', 'tonePitch'),
    q16(40),
    'the fourth position of the snare holds the tone it was given',
  );
  equal(
    stateValue(snareFourth, 'snare', 'bend'),
    q16(46.8),
    'the fourth position of the snare holds the bend it was given',
  );
  equal(
    stateValue(snareFourth, 'snare', 'decay'),
    q16(0.7),
    'the fourth position of the snare holds the decay it was given',
  );
  equal(
    stateValue(snareFourth, 'snare', 'noiseTone'),
    q16(0.7),
    'the fourth position of the snare holds the noise/tone it was given',
  );
  equal(
    stateValue(snareFourth, 'snare', 'clickTone'),
    q16(0.82),
    'the fourth position of the snare holds the click it was given',
  );

  /* The other modules keep the factory values of the engine. */
  const kickInfo = await page.evaluate(
    ({ voices, params }) => {
      const info = window.hive?.paramInfo ?? [];
      const voice = voices.indexOf('kick');
      const out = {};
      for (const entry of info) {
        if (entry.voice === voice) {
          out[params[entry.param]] = entry;
        }
      }
      return out;
    },
    { voices: VOICES, params: PARAMS },
  );
  equal(
    stateValue(await readEngineState(page), 'kick', 'noisePitch'),
    kickInfo.noisePitch.default,
    'the first position of the kick holds the factory values',
  );

  await snareMemory(2).click();
  await page.waitForTimeout(300);

  /* A knob that is moved while a position is selected belongs to that
   * position: it is still there when the position is picked again. */
  const snareTone = page.locator(
    '.strip[data-voice="snare"] .knob[data-param="tonePitch"]',
  );
  await snareTone.press('ArrowUp');
  await page.waitForTimeout(300);
  const snareEdited = Number(await snareTone.getAttribute('data-value'));
  check(
    snareEdited !== q16(92),
    'the tone of the snare moves in the second position',
  );

  await snareMemory(1).click();
  await page.waitForTimeout(300);
  equal(
    stateValue(await readEngineState(page), 'snare', 'tonePitch'),
    q16(96),
    'the first position of the snare holds its own tone again',
  );

  await snareMemory(2).click();
  await page.waitForTimeout(300);
  equal(
    stateValue(await readEngineState(page), 'snare', 'tonePitch'),
    snareEdited,
    'the edit of the second position is still there',
  );

  /* The reset of the module puts the selected position back to its
   * built-in values. */
  await snareMemory(1).click();
  await page.waitForTimeout(300);
  const snareReset = page.locator('.strip[data-voice="snare"] .strip-reset');
  const snareBox = await snareReset.boundingBox();
  await page.mouse.move(
    snareBox.x + snareBox.width / 2,
    snareBox.y + snareBox.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(1400);
  await page.mouse.up();
  await page.waitForTimeout(300);
  equal(
    stateValue(await readEngineState(page), 'snare', 'noisePitch'),
    q16(14000),
    'the reset of the module puts the selected position back to its built-in values',
  );

  /* The mixer of a module is not part of a tone: it belongs to the
   * module and keeps its values when the position changes. */
  const snareVolume = page.locator(
    '.strip[data-voice="snare"] .knob[data-param="volume"]',
  );
  await snareVolume.press('ArrowDown');
  await page.waitForTimeout(300);
  const volume = Number(await snareVolume.getAttribute('data-value'));
  await snareMemory(4).click();
  await page.waitForTimeout(300);
  equal(
    stateValue(await readEngineState(page), 'snare', 'volume'),
    volume,
    'the mixer of the module keeps its value when the position changes',
  );

  /* The memories of the kit and the effects of the bus are kept in the
   * browser: the kit comes back the way it was left. */
  await snareMemory(3).click();
  await page.waitForTimeout(300);
  await snareTone.press('ArrowDown');
  await page.waitForTimeout(300);
  const kept = Number(await snareTone.getAttribute('data-value'));

  const wet = page.locator('.strip-fx-module .knob[data-control="level"]');
  const wetBefore = Number(await wet.getAttribute('data-value'));
  await wet.press('ArrowUp');
  await page.waitForTimeout(300);
  let wetAfter = Number(await wet.getAttribute('data-value'));
  if (wetAfter === wetBefore) {
    await wet.press('ArrowDown');
    await page.waitForTimeout(300);
    wetAfter = Number(await wet.getAttribute('data-value'));
  }
  check(wetAfter !== wetBefore, 'the level of the effects moves');

  /* The values are written once the knobs have been quiet for a
   * second. */
  await page.waitForTimeout(1200);

  await page.reload();
  await page.waitForFunction(
    () =>
      (document.querySelector('#engine-status')?.textContent ?? '').includes(
        'libhive 0.',
      ),
    undefined,
    { timeout: TIMEOUT },
  );
  await page.waitForTimeout(500);

  equal(
    await selectedMemory('snare'),
    3,
    'the selected memory position comes back after a reload',
  );
  equal(
    stateValue(await readEngineState(page), 'snare', 'tonePitch'),
    kept,
    'the values of the memory position come back after a reload',
  );
  equal(
    (await readEngineFxState(page))[3],
    wetAfter,
    'the effects of the kit come back after a reload',
  );
  equal(
    stateValue(await readEngineState(page), 'snare', 'volume'),
    volume,
    'the mixer of the module comes back after a reload',
  );

  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  check(
    await page.evaluate(
      () =>
        document
          .querySelector('#lamp-hihat-trigger')
          ?.classList.contains('is-lit') === true,
    ),
    'the open hi-hat lights the same lamp',
  );

  /* The trigger lamp of the voice that was played is lit. */
  await page.keyboard.press('s');
  await page.waitForFunction(
    () =>
      document
        .querySelector('#lamp-kick-trigger')
        ?.classList.contains('is-lit') === true,
    undefined,
    { timeout: TIMEOUT },
  );
  check(true, 'the trigger lamp lights while the voice is sounding');

  /* The lamp carries the level of the voice's own hit. */
  await page.waitForFunction(
    () => {
      const state = window.hive?.engineState;
      return (state?.levels?.[0] ?? 0) > 0;
    },
    undefined,
    { timeout: TIMEOUT },
  );
  const level = await page.evaluate(
    () => window.hive?.engineState?.levels?.[0] ?? 0,
  );
  check(level > 0, `the lamp carries the level of the hit (${level})`);

  /* The lamp of a module is lit by the level of its own instrument: the
   * brightness on the faceplate is the level the engine reports. */
  await page.waitForFunction(
    () => {
      const state = window.hive?.engineState;
      const lamp = document.querySelector('#lamp-kick-trigger');
      const shown = Number(lamp?.style.getPropertyValue('--lamp-level') ?? '0');
      return (state?.lamp?.[0] ?? 0) > 0 && shown > 0;
    },
    undefined,
    { timeout: TIMEOUT },
  );
  const lampState = await page.evaluate(() => {
    const state = window.hive?.engineState;
    const lamp = document.querySelector('#lamp-kick-trigger');
    return {
      level: state?.levels?.[0] ?? 0,
      lamp: state?.lamp?.[0] ?? 0,
      shown: Number(lamp?.style.getPropertyValue('--lamp-level') ?? '0'),
    };
  });
  check(
    lampState.level > 0,
    `the engine reports the level of the instrument (${lampState.level})`,
  );
  check(
    Math.abs(lampState.shown - lampState.lamp) < 0.01,
    'the light of the lamp is proportional to the level of its own instrument',
  );

  /* Every knob that reaches the engine is operable with the keyboard
   * alone. The hi-hat knobs turn but send nothing anywhere. */
  const before = await readEngineState(page);
  /* The knobs that reach the engine are the ones of a voice: the effects
   * send of a module and the knobs of the effects module. */
  const knobs = page.locator('.strip[data-voice] .knob[data-param]');
  const knobCount = await knobs.count();
  for (let index = 0; index < knobCount; index += 1) {
    const knob = knobs.nth(index);
    /* A knob that stands at the top of its travel does not go up, and a
     * knob that stands at the bottom does not go down: the step is taken
     * in the direction the knob can take it. */
    const before = await knob.getAttribute('aria-valuenow');
    await knob.press('ArrowUp');
    await page.waitForTimeout(20);
    const after = await knob.getAttribute('aria-valuenow');
    if (after === before) {
      await knob.press('ArrowDown');
    }
  }
  await page.waitForTimeout(300);
  const after = await readEngineState(page);
  let moved = 0;
  for (let index = 0; index < before.values.length; index += 1) {
    if (before.values[index] !== after.values[index]) {
      moved += 1;
    }
  }
  equal(
    moved,
    knobCount,
    'every knob of the engine moves with the arrow keys',
  );

  /* The knobs of the effects module reach the engine too: they are the
   * shared FX bus, and the engine keeps their values. */
  const fxBefore = await readEngineFxState(page);
  const fxKnobs = page.locator('.strip-fx-module .knob[data-control]');
  const fxKnobCount = await fxKnobs.count();
  let fxMoved = 0;
  for (let index = 0; index < fxKnobCount; index += 1) {
    const knob = fxKnobs.nth(index);
    const before = await knob.getAttribute('aria-valuenow');
    await knob.press('ArrowUp');
    await page.waitForTimeout(20);
    const after = await knob.getAttribute('aria-valuenow');
    if (after === before) {
      await knob.press('ArrowDown');
    }
    await page.waitForTimeout(60);
    const state = await readEngineFxState(page);
    if (state.some((value, i) => value !== fxBefore[i])) {
      fxMoved += 1;
    }
  }
  equal(
    fxMoved,
    fxKnobCount,
    'every knob of the effects module reaches the engine',
  );

  /* The panel follows the engine. */
  const shown = await readPanelValues(page);
  let inSync = 0;
  for (const [key, knob] of Object.entries(shown)) {
    const [voice, param] = key.split('.');
    if (knob.stored === stateValue(after, voice, param)) {
      inSync += 1;
    }
  }
  equal(inSync, knobCount, 'the panel shows the values the engine stored');

  /* A knob is also a pointer and a wheel. */
  const snareDecay = page.locator('.strip[data-voice="snare"] .knob[data-param="decay"]');
  const box = await snareDecay.boundingBox();
  const decayBeforeDrag = (await readEngineValues(page))[engineIndex('snare', 'decay')];
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, {
    steps: 6,
  });
  await page.mouse.up();
  await waitForEngineValueChange(page, 'snare', 'decay', decayBeforeDrag);
  check(true, 'a knob is moved with the pointer');

  const beforeWheel = (await readEngineValues(page))[engineIndex('snare', 'decay')];
  await snareDecay.hover();
  await page.mouse.wheel(0, -120);
  await waitForEngineValueChange(page, 'snare', 'decay', beforeWheel);
  check(true, 'a knob is moved with the wheel');

  /* A knob edit reaches the engine. */
  const kickPitch = page.locator('.strip[data-voice="kick"] .knob[data-param="tonePitch"]');
  const beforePitchEdit = (await readEngineValues(page))[engineIndex('kick', 'tonePitch')];
  await kickPitch.press('ArrowUp');
  await waitForEngineValueChange(page, 'kick', 'tonePitch', beforePitchEdit);
  const edited = (await readEngineValues(page))[engineIndex('kick', 'tonePitch')];
  check(edited !== beforePitchEdit, 'a knob edit reaches the engine');

  /* The engine takes a whole tone at once. */
  await page.evaluate(() => {
    const values = [0, 55 * 65536, 0, 0, 0, 0];
    window.hive?.setTone('kick', values);
  });
  await waitForEngineValue(page, 'kick', 'tonePitch', 55 * 65536);
  check(true, 'the engine takes a whole tone at once');

  /* A value outside the range of the engine is shown clamped. */
  await page.evaluate(() => {
    window.hive?.setParam('kick', 'tonePitch', 999999999);
  });
  const clamped = 440 * 65536;
  await waitForEngineValue(page, 'kick', 'tonePitch', clamped);
  await page.waitForFunction(
    (expected) => {
      const knob = document.querySelector(
        '.strip[data-voice="kick"] .knob[data-param="tonePitch"]',
      );
      return (
        Number(knob?.getAttribute('data-value')) === expected &&
        knob?.getAttribute('aria-valuenow') === '440'
      );
    },
    clamped,
    { timeout: TIMEOUT },
  );
  check(true, 'a value outside the range of the engine is shown clamped');

  /* The reset restores the factory parameters. */
  await page.locator('#reset').click();
  await waitForEngineValue(page, 'kick', 'tonePitch', 40 * 65536);
  check(
    Number(await kickPitch.getAttribute('data-value')) === 40 * 65536,
    'the reset restores the factory parameters',
  );

  /* The sensitivity scales how much of the strike the hit responds to.
   * With the sensitivity at 0 the velocity is ignored and the hit sounds
   * at full strike level; with the sensitivity at the factory 1 the hit is
   * as quiet as its velocity. */
  await page.evaluate(() => {
    window.hive?.setParam('kick', 'sensitivity', 0);
  });
  await waitForEngineValue(page, 'kick', 'sensitivity', 0);
  await page.evaluate(() => {
    window.hive?.trigger('kick', 16);
  });
  const insensitivePeak = await measurePeak(page, 500);

  await page.locator('#reset').click();
  await waitForEngineValue(page, 'kick', 'sensitivity', 65536);
  await page.evaluate(() => {
    window.hive?.trigger('kick', 16);
  });
  const softPeak = await measurePeak(page, 500);

  await page.locator('#reset').click();
  await waitForEngineValue(page, 'kick', 'sensitivity', 65536);
  await page.evaluate(() => {
    window.hive?.trigger('kick', 127);
  });
  const fullPeak = await measurePeak(page, 500);

  check(
    softPeak < fullPeak / 2,
    `a soft hit is quieter than a full hit (${softPeak} vs ${fullPeak})`,
  );
  check(
    insensitivePeak >= fullPeak / 2,
    `with sensitivity 0 a soft hit sounds at full strike level (${insensitivePeak} vs ${fullPeak})`,
  );

  /* A full-strength hit always plays. */
  await page.keyboard.press('s');
  await waitForPeak(page, 0);
  check(
    (await readPeak(page)) > 0,
    'a full-strength hit plays whatever the sensitivity is',
  );

  /* The sensitivity knob of the module sets the engine's sensitivity of
   * its voice. */
  await page.locator('#reset').click();
  await waitForEngineValue(page, 'kick', 'sensitivity', 65536);
  const kickSens = page.locator('.strip[data-voice="kick"] .knob[data-param="sensitivity"]');
  await kickSens.press('Home');
  await waitForEngineValue(page, 'kick', 'sensitivity', 0);
  check(true, 'the sensitivity knob reaches the engine');
  await page.evaluate(() => {
    window.hive?.trigger('kick', 16);
  });
  const viaKnobPeak = await measurePeak(page, 500);
  check(
    viaKnobPeak >= fullPeak / 2,
    'at sensitivity 0 the knob gives the soft hit its full strike level',
  );

  equal(consoleErrors.length, 0, 'the page logs no errors');
} finally {
  await browser.close();
  server.kill();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log('\nall checks passed');
