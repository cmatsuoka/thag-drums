#!/usr/bin/env bash
#
# Build the wasm glue from the local libhive checkout.
#
# The library is not vendored and not fetched: it is compiled straight from
# the sibling checkout. Point LIBHIVE_DIR at another one to build that.
#
# The library is built with its own warning set, so the build fails when the
# library drifts from its rules (C99, no floating point, no new warnings).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIBHIVE_DIR="${LIBHIVE_DIR:-$ROOT/../sdsv}"
EMCC="${EMCC:-emcc}"
OUT_DIR="$ROOT/build"

if ! command -v "$EMCC" >/dev/null 2>&1; then
    cat >&2 <<'EOF'
error: emcc not found.

Install Emscripten (emsdk) and put it on PATH, or set EMCC=/path/to/emcc:

  git clone https://github.com/emscripten-core/emsdk.git
  cd emsdk && ./emsdk install latest && ./emsdk activate latest
  source ./emsdk_env.sh
EOF
    exit 1
fi

if [ ! -f "$LIBHIVE_DIR/include/h5.h" ]; then
    cat >&2 <<EOF
error: no libhive checkout at $LIBHIVE_DIR

The library is expected in the sibling checkout ../sdsv. Set LIBHIVE_DIR to
the directory that holds include/h5.h and src/*.c.
EOF
    exit 1
fi

mkdir -p "$OUT_DIR"

# The version of the library that is being compiled, so the build log names
# it. The panel reads the version of the linked library at runtime, through
# h5_version_number().
read_version() {
    awk -v key="$1" '$1 == "#define" && $2 == key { print $3; exit }' \
        "$LIBHIVE_DIR/include/h5.h"
}

VERSION_MAJOR="$(read_version H5_VERSION_MAJOR)"
VERSION_MINOR="$(read_version H5_VERSION_MINOR)"
VERSION_PATCH="$(read_version H5_VERSION_PATCH)"

if [ -z "$VERSION_MAJOR" ] || [ -z "$VERSION_MINOR" ] || [ -z "$VERSION_PATCH" ]; then
    echo "error: could not read the library version from $LIBHIVE_DIR/include/h5.h" >&2
    exit 1
fi

# The floating point diagnostics keep the library integer-only. They are
# only used where the compiler knows them.
FLOAT_WARN=""
if "$EMCC" -Wfloat-conversion -Wdouble-promotion -Werror -E -x c /dev/null \
    >/dev/null 2>&1; then
    FLOAT_WARN="-Wfloat-conversion -Wdouble-promotion"
fi

# The metallic engines are compiled in, the way the library's own Makefile
# compiles them: the Hi-hat and the Cymbal are two voices of the library.
# Without the definitions they would stay in the API and render silence.
ENGINE_DEFS="-DLIBHIVE_ENGINE_HIHAT -DLIBHIVE_ENGINE_CYMBAL"

# Only the glue is exported. The allocator stays on: the library calls
# calloc() for its context and malloc() for its sine table.
#
# The environment is the worker only. With "node" in it, the Emscripten
# runtime imports "module" for its require shim, and a browser cannot
# resolve that: the whole worklet module would fail to evaluate. The Node
# smoke test instantiates the wasm binary directly instead of importing
# the glue.
EXPORTED_FUNCTIONS='["_malloc","_free","_hive_version_number","_hive_create","_hive_destroy","_hive_set_sample_rate","_hive_reset","_hive_set_param","_hive_get_param","_hive_param_supported","_hive_set_instrument_volume","_hive_get_instrument_volume","_hive_set_instrument_pan","_hive_get_instrument_pan","_hive_trigger","_hive_process","_hive_is_active","_hive_instrument_levels","_hive_panel_state","_hive_param_info"]'

# shellcheck disable=SC2086
"$EMCC" \
    "$ROOT/wasm/hive_wasm.c" \
    "$LIBHIVE_DIR"/src/*.c \
    -I"$LIBHIVE_DIR/include" \
    -I"$LIBHIVE_DIR/src" \
    -std=c99 -O2 \
    -Wall -Wextra -Werror \
    $ENGINE_DEFS \
    $FLOAT_WARN \
    --no-entry \
    -o "$OUT_DIR/hive.mjs" \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME=createHiveModule \
    -sENVIRONMENT=worker \
    -sFILESYSTEM=0 \
    -sMALLOC=emmalloc \
    -sINITIAL_MEMORY=16777216 \
    -sSTACK_SIZE=131072 \
    -sASSERTIONS=1 \
    -sEXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAP32

echo "built $OUT_DIR/hive.mjs and $OUT_DIR/hive.wasm (libhive ${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH})"
