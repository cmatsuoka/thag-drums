/*
 * smoke-test.mjs - the acceptance check of Phase 0.
 *
 * The wasm binary is instantiated directly, the way the worklet does it:
 * a context is created, the five instruments are triggered and a second of
 * audio is rendered. The output has to be non-silent, and the parameter
 * probe has to agree with the library's own table.
 *
 * The Emscripten glue is not used here. It is built for the worker
 * environment only, and the glue is not importable outside a browser: this
 * test drives the binary itself, which is what the browser runs anyway.
 *
 * Run it with `npm run smoke` after `npm run build:wasm`.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const Q16 = 65536;
const SAMPLE_RATE = 44100;
const BLOCK_FRAMES = 128;

/* The library's own enums, mirrored here so the test fails when the
 * library's numbering changes. */
const VOICE = {
  KICK: 0,
  SNARE: 1,
  TOM_1: 2,
  TOM_2: 3,
  TOM_3: 4,
};
const PARAM = {
  NOISE_PITCH: 0,
  TONE_PITCH: 1,
  BEND: 2,
  DECAY: 3,
  NOISE_TONE: 4,
  CLICK_TONE: 5,
  SWEEP: 6,
  VOLUME: 7,
  PAN: 8,
};
const VOICE_COUNT = 5;
const PARAM_COUNT = 9;
const PANEL_STRIDE = 2;
const PARAM_INFO_STRIDE = 3;
const PARAM_UNSUPPORTED = 2147483647;
const STATUS = {
  OK: 0,
  UNSUPPORTED: 5,
  RANGE: 6,
};

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

/* The imports the Emscripten runtime needs. The names differ a little
 * between the Emscripten versions, so they are resolved from the module
 * itself. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = await readFile(path.join(root, 'build', 'hive.wasm'));
const module = await WebAssembly.compile(bytes);

let memory = null;

const env = {};
for (const entry of WebAssembly.Module.imports(module)) {
  const name = entry.name.replace(/^_/, '');
  switch (name) {
    case 'emscripten_memcpy_js':
      env[entry.name] = (dest, src, num) => {
        new Uint8Array(memory.buffer).copyWithin(dest, src, src + num);
      };
      break;
    case 'emscripten_resize_heap':
      // The engine never grows its heap: the context and the sine table
      // fit into the memory the build reserved.
      env[entry.name] = () => 0;
      break;
    case 'fd_write':
      env[entry.name] = () => 0;
      break;
    default:
      throw new Error(
        `the engine wants an unknown import: ${entry.module}.${entry.name}`,
      );
  }
}

const instance = await WebAssembly.instantiate(module, {
  env,
  wasi_snapshot_preview1: env,
});
const engine = instance.exports;
memory = engine.memory;

if (typeof engine.__wasm_call_ctors === 'function') {
  engine.__wasm_call_ctors();
}

/* A fresh view every time: the heap may grow under a pointer, and a view
 * over an old buffer would be detached. */
function readI32(pointer) {
  return new Int32Array(engine.memory.buffer, pointer, 1)[0] ?? 0;
}

function paramInfo(pointer, voice, param) {
  const base = pointer + (voice * PARAM_COUNT + param) * PARAM_INFO_STRIDE * 4;
  return {
    min: readI32(base),
    max: readI32(base + 4),
    default: readI32(base + 8),
  };
}

/* The version of the linked library. */
const version = engine.hive_version_number();
check(version > 0, `the library reports its version (${version})`);

const context = engine.hive_create(SAMPLE_RATE);
check(context !== 0, 'the context is created');

/* The parameter probe has to agree with the library's own table. */
const infoPtr = engine.hive_param_info();

const kickTone = paramInfo(infoPtr, VOICE.KICK, PARAM.TONE_PITCH);
equal(kickTone.min, 10 * Q16, 'the Kick tone pitch starts at 10 Hz');
equal(kickTone.max, 440 * Q16, 'the Kick tone pitch ends at 440 Hz');
equal(kickTone.default, 40 * Q16, 'the Kick tone pitch defaults to 40 Hz');

const snareSweep = paramInfo(infoPtr, VOICE.SNARE, PARAM.SWEEP);
equal(snareSweep.min, 0, 'the Snare sweep starts at 0');
equal(snareSweep.max, Q16, 'the Snare sweep ends at 1');

const kickSweep = paramInfo(infoPtr, VOICE.KICK, PARAM.SWEEP);
equal(kickSweep.min, PARAM_UNSUPPORTED, 'the Kick has no sweep');

equal(
  engine.hive_param_supported(VOICE.SNARE, PARAM.SWEEP),
  1,
  'the Snare supports the sweep',
);
equal(
  engine.hive_param_supported(VOICE.KICK, PARAM.SWEEP),
  0,
  'the Kick does not support the sweep',
);

/* An unsupported pair changes nothing and is reported. */
const unsupported = engine.hive_set_param(context, VOICE.KICK, PARAM.SWEEP, 0);
equal(unsupported, STATUS.UNSUPPORTED, 'the Kick rejects the sweep');

/* An out-of-range value is clamped, stored clamped and reported. The value
 * has to stay inside the int32 range of the API. */
const outOfRange = engine.hive_set_param(
  context,
  VOICE.KICK,
  PARAM.TONE_PITCH,
  1000 * Q16,
);
equal(outOfRange, STATUS.RANGE, 'a value above the range is reported');
const scratchPtr = engine.malloc(4);
engine.hive_get_param(context, VOICE.KICK, PARAM.TONE_PITCH, scratchPtr);
equal(readI32(scratchPtr), 440 * Q16, 'the clamped value is stored');

/* The panel snapshot carries the engine's own values. */
const panelPtr = engine.hive_panel_state(context);
const panelIndex = (voice, param) =>
  (voice * PARAM_COUNT + param) * PANEL_STRIDE * 4;
equal(
  readI32(panelPtr + panelIndex(VOICE.KICK, PARAM.TONE_PITCH)),
  440 * Q16,
  'the panel snapshot carries the clamped value',
);
equal(
  readI32(panelPtr + panelIndex(VOICE.KICK, PARAM.TONE_PITCH) + 4),
  1,
  'the panel snapshot marks the parameter as supported',
);
equal(
  readI32(panelPtr + panelIndex(VOICE.KICK, PARAM.SWEEP) + 4),
  0,
  'the panel snapshot marks the sweep as unsupported',
);

/* The kit plays: every instrument is triggered and a second of audio is
 * rendered. */
const outPtr = engine.malloc(BLOCK_FRAMES * 2 * Int16Array.BYTES_PER_ELEMENT);

for (const instrument of Object.values(VOICE)) {
  const status = engine.hive_trigger(context, instrument);
  equal(status, STATUS.OK, `the instrument ${instrument} is triggered`);
}

let peak = 0;
let blocks = 0;
const totalBlocks = Math.ceil((SAMPLE_RATE * 1) / BLOCK_FRAMES);
while (blocks < totalBlocks) {
  engine.hive_process(context, outPtr, BLOCK_FRAMES);
  const view = new Int16Array(
    engine.memory.buffer,
    outPtr,
    BLOCK_FRAMES * 2,
  );
  for (let index = 0; index < BLOCK_FRAMES * 2; index += 1) {
    const sample = Math.abs(view[index] ?? 0);
    if (sample > peak) {
      peak = sample;
    }
  }
  blocks += 1;
}

check(peak > 0, `the rendered audio is not silent (peak ${peak})`);
check(peak <= 32768, `the rendered audio stays inside the int16 range (peak ${peak})`);

/* The engine reports the level of every instrument by itself: the peak of
 * the instrument's own voice, after its own volume and before the pan and
 * the mix. That is the level the lamp of a module is lit by. The glue
 * hands the levels over in a static buffer, so the export has to be called
 * again to read them after a block has been rendered. */
engine.hive_reset(context);
engine.hive_process(context, outPtr, BLOCK_FRAMES);
let levelsPtr = engine.hive_instrument_levels(context);
equal(
  readI32(levelsPtr),
  0,
  'no instrument reports a level while the kit is silent',
);

engine.hive_trigger(context, VOICE.KICK);
for (let block = 0; block < 4; block += 1) {
  engine.hive_process(context, outPtr, BLOCK_FRAMES);
}
levelsPtr = engine.hive_instrument_levels(context);
const kickLevel = readI32(levelsPtr);
check(
  kickLevel > 0,
  `the triggered instrument reports its own level (${kickLevel})`,
);
check(
  kickLevel <= Q16,
  `the level of an instrument stays inside the Q16.16 range (${kickLevel})`,
);
equal(
  readI32(levelsPtr + 4),
  0,
  'the instruments that are silent report no level',
);

/* The reset restores the factory parameters. */
engine.hive_reset(context);
engine.hive_get_param(context, VOICE.KICK, PARAM.TONE_PITCH, scratchPtr);
equal(readI32(scratchPtr), 40 * Q16, 'the reset restores the factory parameters');

engine.free(outPtr);
engine.free(scratchPtr);
engine.hive_destroy(context);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log('\nall checks passed');
