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
  VOLUME: 6,
  PAN: 7,
  SENSITIVITY: 8,
};
const VOICE_COUNT = 5;
const PARAM_COUNT = 9;
const PANEL_STRIDE = 2;
const PARAM_INFO_STRIDE = 3;
const STATUS = {
  OK: 0,
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

const snareSens = paramInfo(infoPtr, VOICE.SNARE, PARAM.SENSITIVITY);
equal(snareSens.min, 0, 'the Snare sensitivity starts at 0');
equal(snareSens.max, Q16, 'the Snare sensitivity ends at 1');
equal(snareSens.default, Q16, 'the Snare sensitivity defaults to 1');

const kickSens = paramInfo(infoPtr, VOICE.KICK, PARAM.SENSITIVITY);
equal(kickSens.min, 0, 'the Kick sensitivity starts at 0');
equal(kickSens.max, Q16, 'the Kick sensitivity ends at 1');
equal(kickSens.default, Q16, 'the Kick sensitivity defaults to 1');

for (const voice of Object.values(VOICE)) {
  equal(
    engine.hive_param_supported(voice, PARAM.SENSITIVITY),
    1,
    `the voice ${voice} supports the sensitivity`,
  );
}

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
  readI32(panelPtr + panelIndex(VOICE.KICK, PARAM.SENSITIVITY) + 4),
  1,
  'the panel snapshot marks the sensitivity as supported',
);

/* The kit plays: every instrument is triggered and a second of audio is
 * rendered. */
const outPtr = engine.malloc(BLOCK_FRAMES * 2 * Int16Array.BYTES_PER_ELEMENT);

for (const instrument of Object.values(VOICE)) {
  const status = engine.hive_trigger(context, instrument);
  equal(status, STATUS.OK, `the instrument ${instrument} is triggered`);
}

/* The velocity is the strike level of the hit, in the MIDI scale. */
const tooLoud = engine.hive_trigger_velocity(context, VOICE.KICK, 200);
equal(tooLoud, STATUS.RANGE, 'a velocity above 127 is rejected');
const withVelocity = engine.hive_trigger_velocity(context, VOICE.KICK, 64);
equal(withVelocity, STATUS.OK, 'a velocity inside the range is accepted');

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

/* A soft hit is quieter than a full hit, and the sensitivity of the
 * channel decides how much of that response the velocity gets. The renders
 * are deterministic, so the peaks can be compared directly. */
function renderSeconds(seconds) {
  let peakValue = 0;
  const blocks = Math.ceil((SAMPLE_RATE * seconds) / BLOCK_FRAMES);
  for (let block = 0; block < blocks; block += 1) {
    engine.hive_process(context, outPtr, BLOCK_FRAMES);
    const view = new Int16Array(
      engine.memory.buffer,
      outPtr,
      BLOCK_FRAMES * 2,
    );
    for (let index = 0; index < BLOCK_FRAMES * 2; index += 1) {
      const sample = Math.abs(view[index] ?? 0);
      if (sample > peakValue) {
        peakValue = sample;
      }
    }
  }
  return peakValue;
}

engine.hive_reset(context);
engine.hive_trigger_velocity(context, VOICE.KICK, 16);
const softPeak = renderSeconds(0.5);

engine.hive_reset(context);
engine.hive_trigger_velocity(context, VOICE.KICK, 127);
const fullPeak = renderSeconds(0.5);

check(
  softPeak < fullPeak / 2,
  `a soft hit is quieter than a full hit (${softPeak} vs ${fullPeak})`,
);

/* Sensitivity 0: the velocity is ignored and the hit sounds at full
 * strike level. */
engine.hive_reset(context);
engine.hive_set_param(context, VOICE.KICK, PARAM.SENSITIVITY, 0);
engine.hive_trigger_velocity(context, VOICE.KICK, 16);
const insensitivePeak = renderSeconds(0.5);

check(
  insensitivePeak >= fullPeak / 2,
  `with sensitivity 0 a soft hit sounds (${insensitivePeak} vs ${fullPeak})`,
);
engine.hive_reset(context);

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
