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
const VOICES = ['kick', 'snare', 'tom1', 'tom2', 'tom3'];
const PARAMS = [
  'noisePitch',
  'tonePitch',
  'bend',
  'decay',
  'noiseTone',
  'clickTone',
  'sweep',
  'volume',
  'pan',
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

/** What the panel shows: the value of every knob of every strip. */
async function readPanelValues(page) {
  return page.evaluate(() => {
    const values = {};
    for (const knob of document.querySelectorAll('.knob')) {
      const strip = knob.closest('.strip');
      const key = `${strip?.dataset.voice}.${knob.dataset.param}`;
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
        'volume',
        'pan',
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
        'volume',
        'pan',
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
    (status ?? '').includes('libhive 0.1.0'),
    `the engine reports its version (${(status ?? '').trim()})`,
  );

  /* The panel: five module strips. */
  await page.waitForFunction(
    () => document.querySelectorAll('.strip .knob').length === 36,
    undefined,
    { timeout: TIMEOUT },
  );
  equal(
    await page.locator('.strip').count(),
    5,
    'the panel has the five module strips',
  );
  equal(
    await page.locator('.strip .lamp').count(),
    5,
    'every strip has its trigger lamp',
  );

  /* The knob column comes from the engine's own table: only the Snare has
   * a Sweep knob, and every voice has a Pan knob. */
  equal(
    await page.locator('.strip[data-voice="snare"] .knob[data-param="sweep"]').count(),
    1,
    'the snare has a sweep knob',
  );
  for (const voice of VOICES.filter((name) => name !== 'snare')) {
    equal(
      await page
        .locator(`.strip[data-voice="${voice}"] .knob[data-param="sweep"]`)
        .count(),
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
  const engineValues = await readEngineValues(page);
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
    if (knob.stored === engineValues[engineIndex(voice, param)]) {
      stored += 1;
    }
  }
  equal(roles, 36, 'every knob is a slider');
  equal(ranges, 36, 'every knob carries the range of the engine');
  equal(
    stored,
    36,
    'every knob shows the value the engine stored',
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

  /* Every knob is operable with the keyboard alone. */
  const before = await readEngineValues(page);
  const knobs = page.locator('.knob');
  const knobCount = await knobs.count();
  for (let index = 0; index < knobCount; index += 1) {
    await knobs.nth(index).press('ArrowUp');
  }
  await page.waitForTimeout(300);
  const after = await readEngineValues(page);
  let moved = 0;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) {
      moved += 1;
    }
  }
  equal(moved, knobCount, 'every knob moves with the arrow keys');

  /* The panel follows the engine. */
  const shown = await readPanelValues(page);
  let inSync = 0;
  for (const [key, knob] of Object.entries(shown)) {
    const [voice, param] = key.split('.');
    if (knob.stored === after[engineIndex(voice, param)]) {
      inSync += 1;
    }
  }
  equal(inSync, knobCount, 'the panel shows the values the engine stored');

  /* A knob is also a pointer and a wheel. */
  const snareDecay = page.locator('.strip[data-voice="snare"] .knob[data-param="decay"]');
  const box = await snareDecay.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, {
    steps: 6,
  });
  await page.mouse.up();
  await waitForEngineValueChange(page, 'snare', 'decay', after[engineIndex('snare', 'decay')]);
  check(true, 'a knob is moved with the pointer');

  const beforeWheel = (await readEngineValues(page))[engineIndex('snare', 'decay')];
  await snareDecay.hover();
  await page.mouse.wheel(0, -120);
  await waitForEngineValueChange(page, 'snare', 'decay', beforeWheel);
  check(true, 'a knob is moved with the wheel');

  /* A knob edit reaches the engine. */
  const kickPitch = page.locator('.strip[data-voice="kick"] .knob[data-param="tonePitch"]');
  const factoryValue = 40 * 65536;
  await kickPitch.press('ArrowUp');
  await waitForEngineValueChange(page, 'kick', 'tonePitch', factoryValue);
  const edited = (await readEngineValues(page))[engineIndex('kick', 'tonePitch')];
  check(edited !== factoryValue, 'a knob edit reaches the engine');

  /* The engine takes a whole tone at once. */
  await page.evaluate(() => {
    const values = [0, 55 * 65536, 0, 0, 0, 0, 0];
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

  /* The sensitivity decides whether a channel speaks. A soft hit does not
   * reach a channel that asks for more. */
  await page.evaluate(() => {
    window.hive?.setSens('kick', 0.6 * 65536);
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.hive?.trigger('kick', 0.2 * 65536);
  });
  await page.waitForTimeout(300);
  check(
    (await readPeak(page)) === 0,
    'a soft hit does not make a sensitive channel speak',
  );

  /* A full-strength hit always plays. */
  await page.keyboard.press('s');
  await waitForPeak(page, 0);
  check(
    (await readPeak(page)) > 0,
    'a full-strength hit plays whatever the sensitivity is',
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
