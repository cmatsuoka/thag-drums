# Tweaker for Hive Audio Generators

THAG is a browser recreation of a vintage analog percussion sound-generation
unit, powered by [libhive](https://github.com/cmatsuoka/libhive).

## Features

- Seven voices and eight instruments, including a shared Hi-Hat voice with
  closed and open positions.
- Configurable voice parameters with four memory positions.
- Per-channel volume, pan and strike sensitivity.
- Keyboard and web MIDI triggering.

The engine is a one-shot sound generator: there are no presets, no sequencer,
no note-off and no master effects. Everything outside the sound parameters is
host-side.

## Requirements

- Node 20+ and npm.
- Emscripten (emsdk) on `PATH` to build the WebAssembly module.
- The libhive checkout in the sibling directory `../sdsv` (override with
  `LIBHIVE_DIR`).

## Development

```sh
npm install
npm run build:wasm   # compile libhive from ../sdsv and build build/hive.wasm
npm run dev          # Vite dev server
```

Use `npm run dev:secure` for an HTTPS dev server (self-signed certificate),
needed to reach the page from another device, because the AudioWorklet only
exists in a secure context.

Other useful scripts:

```sh
npm run build        # production build (runs build:wasm first)
npm run typecheck    # tsc --noEmit
npm run smoke        # Node smoke test of the built engine
npm run e2e          # browser check of the audio path (Chromium)
```

## Architecture

The engine runs inside an `AudioWorklet`, which owns the wasm context; UI
controls send messages over its port, and the worklet posts the engine's
parameter snapshot back. The main thread compiles the wasm module and hands it
to the processor, so the audio thread never has to fetch or compile anything.
All engine calls happen on the audio thread.
