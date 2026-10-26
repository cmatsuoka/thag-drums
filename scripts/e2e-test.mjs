/*
 * e2e-test.mjs - the browser check of the audio path.
 *
 * The page is served by Vite and opened in Chromium. The test plays the
 * kit from the keyboard, moves a parameter, stores and recalls a tone and
 * resets the engine, and it watches the engine's own state to see that
 * every step arrived.
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

/** The peak the engine reports, as the panel shows it. */
async function readPeak(page) {
  const text = await page.locator('#engine-status').textContent();
  const match = /peak (\d+)/.exec(text ?? '');
  return match === null ? 0 : Number(match[1]);
}

async function readValue(page, id) {
  const text = await page.locator(`#${id}`).textContent();
  return (text ?? '').trim();
}

/** Move a range input with the keyboard, the way a user would. */
async function nudge(page, id, steps) {
  const slider = page.locator(`#${id}`);
  await slider.focus();
  const key = steps < 0 ? 'ArrowLeft' : 'ArrowRight';
  for (let index = 0; index < Math.abs(steps); index += 1) {
    await slider.press(key);
  }
}

/** Set a range input to a position, the way a drag would. */
async function setSlider(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, position) => {
    const input = element;
    input.value = String(position);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
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
      return status !== null && (status.textContent ?? '').includes('libhive');
    },
    undefined,
    { timeout: TIMEOUT },
  );
  const status = await page.locator('#engine-status').textContent();
  check(
    (status ?? '').includes('libhive 0.1.0'),
    `the engine reports its version (${(status ?? '').trim()})`,
  );

  /* The keyboard plays the Bass, and the engine renders it. */
  await page.keyboard.press('s');
  await page.waitForFunction(
    () => {
      const element = document.querySelector('#engine-status');
      const match = /peak (\d+)/.exec(element?.textContent ?? '');
      return match !== null && Number(match[1]) > 0;
    },
    undefined,
    { timeout: TIMEOUT },
  );
  check((await readPeak(page)) > 0, 'the keyboard plays the Bass and the engine renders it');

  /* The other voices play too. */
  for (const key of ['d', 'o', 'i', 'u']) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(200);
  check((await readPeak(page)) > 0, 'the other voices play from the keyboard');

  /* A parameter change reaches the engine, and the panel shows the value
   * the engine stored. */
  const before = await readValue(page, 'value-kick-tonePitch');
  await nudge(page, 'param-kick-tonePitch', 50);
  await page.waitForFunction(
    (previous) => {
      const element = document.querySelector('#value-kick-tonePitch');
      return element !== null && (element.textContent ?? '') !== previous;
    },
    before,
    { timeout: TIMEOUT },
  );
  const after = await readValue(page, 'value-kick-tonePitch');
  check(after !== before, `a parameter change reaches the engine (${before} -> ${after})`);

  /* A tone is stored and recalled. */
  await page.locator('#store-tone').click();
  await nudge(page, 'param-kick-tonePitch', 50);
  await page.waitForTimeout(100);
  await page.locator('#recall-tone').click();
  await page.waitForFunction(
    (previous) => {
      const element = document.querySelector('#value-kick-tonePitch');
      return element !== null && (element.textContent ?? '') === previous;
    },
    after,
    { timeout: TIMEOUT },
  );
  check(
    (await readValue(page, 'value-kick-tonePitch')) === after,
    'a stored tone is recalled',
  );

  /* The reset restores the factory value. */
  await page.locator('#reset').click();
  await page.waitForFunction(
    () => {
      const element = document.querySelector('#value-kick-tonePitch');
      return (element?.textContent ?? '').startsWith('40.00');
    },
    undefined,
    { timeout: TIMEOUT },
  );
  check(
    (await readValue(page, 'value-kick-tonePitch')).startsWith('40.00'),
    'the reset restores the factory parameters',
  );

  /* The sensitivity decides whether a channel speaks. A soft hit does not
   * reach a channel that asks for more. */
  await setSlider(page, 'hit-strength', 200);
  await setSlider(page, 'param-kick-sens', 600);
  await page.waitForTimeout(200);
  await page.locator('#trigger-kick').click();
  await page.waitForTimeout(300);
  check(
    (await readPeak(page)) === 0,
    'a soft hit does not make a sensitive channel speak',
  );

  /* A full-strength hit always plays. */
  await page.keyboard.press('s');
  await page.waitForFunction(
    () => {
      const element = document.querySelector('#engine-status');
      const match = /peak (\d+)/.exec(element?.textContent ?? '');
      return match !== null && Number(match[1]) > 0;
    },
    undefined,
    { timeout: TIMEOUT },
  );
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
