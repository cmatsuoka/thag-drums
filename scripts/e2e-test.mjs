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
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 5178;
const URL = `http://localhost:${PORT}/`;
const TIMEOUT = 20000;

/* The order of the engine's own tables. */
const VOICES = ['kick', 'snare', 'tom1', 'tom2', 'tom3', 'cymbal', 'hihat'];
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
      const key = `${strip?.dataset.voice ?? strip?.dataset.place}.${knob.dataset.param}`;
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
    ({ voice, param, expected }) => {
      const state = window.hive?.engineState;
      if (state === null || state === undefined) {
        return false;
      }
      const voices = ['kick', 'snare', 'tom1', 'tom2', 'tom3'];
      const params = [
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
      ];
      const index = voices.indexOf(voice) * params.length + params.indexOf(param);
      return state.values[index] === expected;
    },
    { voice, param, expected },
    { timeout: TIMEOUT },
  );
}

/** Wait until the engine holds another value for a voice and a parameter. */
async function waitForEngineValueChange(page, voice, param, previous) {
  await page.waitForFunction(
    ({ voice, param, previous }) => {
      const state = window.hive?.engineState;
      if (state === null || state === undefined) {
        return false;
      }
      const voices = ['kick', 'snare', 'tom1', 'tom2', 'tom3'];
      const params = [
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
      ];
      const index = voices.indexOf(voice) * params.length + params.indexOf(param);
      return state.values[index] !== previous;
    },
    { voice, param, previous },
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
  const status = await page.locator('#engine-status').textContent();
  check(
    (status ?? '').includes('libhive 0.4.0'),
    `the engine reports its version (${(status ?? '').trim()})`,
  );

  /* The panel: the five drum modules and the two metallic ones at the
   * end of the row. */
  await page.waitForFunction(
    () => document.querySelectorAll('.strip .knob').length === 63,
    undefined,
    { timeout: TIMEOUT },
  );
  equal(
    await page.locator('.strip').count(),
    7,
    'the panel has the seven modules',
  );
  equal(
    await page.locator('.strip-blank').count(),
    0,
    'no module is blank any more',
  );
  equal(
    await page.locator('.strip .lamp').count(),
    7,
    'every module draws its lamp',
  );

  /* The metallic modules: the hi-hat and the cymbal, wired to the engine
   * like the drums. They carry the controls the metallic voices have and
   * nothing else: their own Sweep and Bell/Cymbal, and no Noise or
   * Click/Drum of the drums. */
  for (const place of ['hihat', 'cymbal']) {
    equal(
      await page.locator(`.strip-${place}`).count(),
      1,
      `the ${place} module is on the panel`,
    );
    equal(
      await page.locator(`.strip-${place} .strip-knobs .knob`).count(),
      6,
      `the ${place} module has the six sound knobs`,
    );
    for (const param of ['sweep', 'tonePitch', 'bend', 'decay', 'noiseTone', 'bellCymbal']) {
      equal(
        await page.locator(`.strip-${place} .knob[data-param="${param}"]`).count(),
        1,
        `the ${place} module has a ${param} knob`,
      );
    }
    equal(
      await page.locator(`.strip-${place} .knob[data-param="noisePitch"]`).count(),
      0,
      `the ${place} module has no noise knob`,
    );
    equal(
      await page.locator(`.strip-${place} .knob[data-param="clickTone"]`).count(),
      0,
      `the ${place} module has no click/drum knob`,
    );
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
      await page.locator(`.strip-export[data-voice="${place}"]`).count(),
      1,
      `the ${place} module has an export control`,
    );
    equal(
      await page.locator(`.strip-${place} .lamp`).count(),
      1,
      `the ${place} module draws its lamp`,
    );
  }

  /* Every module has a second, shorter column: the mixer of the channel. */
  for (const voice of VOICES) {
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
   * no sweep knob any more, and every voice has a Pan knob. */
  for (const voice of VOICES) {
    if (voice === 'cymbal' || voice === 'hihat') {
      continue;
    }
    equal(
      await page.locator(`.strip[data-voice="${voice}"] .knob[data-param="sweep"]`).count(),
      0,
      `the ${voice} has no sweep knob`,
    );
  }
  for (const voice of VOICES) {
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
    if (knob.stored === stateValue(engineState, voice, param)) {
      stored += 1;
    }
  }
  const knobTotal = Object.keys(panel).length;
  equal(roles, knobTotal, 'every knob is a slider');
  equal(ranges, knobTotal, 'every knob carries the range of its control');
  equal(
    stored,
    knobTotal,
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

  /* The metallic voices play from the keyboard as well: the cymbal on P,
   * the closed hi-hat on J and the open one on L. */
  for (const key of ['p', 'j', 'l']) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(200);
  check(
    (await readPeak(page)) > 0,
    'the cymbal and the hi-hats play from the keyboard',
  );

  /* The lamp of the cymbal module is lit by the cymbal's own hit. */
  await page.keyboard.press('p');
  await page.waitForFunction(
    () =>
      document
        .querySelector('#lamp-cymbal-trigger')
        ?.classList.contains('is-lit') === true,
    undefined,
    { timeout: TIMEOUT },
  );
  check(true, 'the cymbal lamp lights while the cymbal is sounding');

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

  /* Every module carries a trigger button under its mixer knobs, and the
   * button plays the module's own voice. */
  equal(
    await page.locator('.strip-trigger').count(),
    VOICES.length,
    'every module has a trigger button',
  );

  await page.locator('.strip[data-voice="snare"] .strip-trigger').click();
  await waitForPeak(page, 0);
  check(
    (await readPeak(page)) > 0,
    'the trigger button of a module plays its own voice',
  );

  /* Every module carries four memory buttons and a reset button. */
  equal(
    await page.locator('.strip-mem').count(),
    VOICES.length * 4,
    'every module has four memory buttons',
  );
  equal(
    await page.locator('.strip-reset').count(),
    VOICES.length,
    'every module has a reset button',
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
  const knobs = page.locator('.strip[data-voice] .knob');
  const knobCount = await knobs.count();
  for (let index = 0; index < knobCount; index += 1) {
    await knobs.nth(index).press('ArrowDown');
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

  /* Every module can write its settings to a file. The file carries the
   * values the engine holds for that module. */
  for (const voice of VOICES) {
    equal(
      await page.locator(`.strip-export[data-voice="${voice}"]`).count(),
      1,
      `the ${voice} has an export control`,
    );
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.strip-export[data-voice="snare"]').click(),
  ]);
  equal(
    download.suggestedFilename(),
    'snare.json',
    'the export names the file after the module',
  );
  const exported = JSON.parse(
    await readFile(await download.path(), 'utf8'),
  );
  equal(exported.voice, 'snare', 'the export names the module');
  equal(
    exported.parameters.sensitivity.q16,
    await page.evaluate(() => window.hive?.value('snare', 'sensitivity') ?? -1),
    'the export carries the value the engine holds',
  );
  equal(
    exported.parameters.sweep,
    undefined,
    'the export does not carry a control the engine does not have',
  );
  check(
    exported.parameters.noisePitch !== undefined,
    'the export carries the controls of the module',
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
