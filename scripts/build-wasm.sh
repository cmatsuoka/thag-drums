#!/usr/bin/env bash
#
# Fetch the engine and build the wasm glue.
#
# The engine is libhive. Its sources are taken from LIBHIVE_SOURCE and copied
# into LIBHIVE_DIR, where they are compiled. The source tree is never written
# to: it may be a checkout that belongs to somebody else.
#
# The source is the sibling checkout of the library when there is one
# (../sdsv), because it carries the newest API. Otherwise the pinned commit
# is fetched into vendor/libhive-src. Update LIBHIVE_COMMIT deliberately.
#
# The library is built with its own warning set, so the build fails when the
# library drifts from its rules (C99, no floating point, no new warnings).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIBHIVE_REPO="${LIBHIVE_REPO:-https://github.com/cmatsuoka/libhive.git}"
LIBHIVE_COMMIT="${LIBHIVE_COMMIT:-0ca3a21895a95b612746071552be386a7b1a3ae0}"
# The checkout of the library that carries the newest API.
LIBHIVE_SIBLING="${LIBHIVE_SIBLING:-$ROOT/../sdsv}"
# The pristine sources the build is made from.
LIBHIVE_SOURCE="${LIBHIVE_SOURCE:-}"
# The sources the build actually compiles: a copy of the sources above.
LIBHIVE_DIR="${LIBHIVE_DIR:-$ROOT/vendor/libhive}"
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

# Where the pristine sources come from.
if [ -z "$LIBHIVE_SOURCE" ]; then
    if [ -f "$LIBHIVE_SIBLING/include/h5.h" ]; then
        # The sibling checkout is the working copy of the library, and it
        # carries the API this panel is written against.
        LIBHIVE_SOURCE="$LIBHIVE_SIBLING"
    else
        LIBHIVE_SOURCE="$ROOT/vendor/libhive-src"
    fi
fi

if [ ! -f "$LIBHIVE_SOURCE/include/h5.h" ]; then
    # No local checkout: fetch the pinned commit.
    if [ ! -d "$LIBHIVE_SOURCE/.git" ]; then
        mkdir -p "$(dirname "$LIBHIVE_SOURCE")"
        git clone "$LIBHIVE_REPO" "$LIBHIVE_SOURCE"
    fi

    if ! git -C "$LIBHIVE_SOURCE" fetch --depth 1 origin "$LIBHIVE_COMMIT"; then
        cat >&2 <<EOF
error: the pinned engine commit could not be fetched.

  $LIBHIVE_COMMIT

The commit has to be in the upstream repository:

  git -C $LIBHIVE_SOURCE fetch origin $LIBHIVE_COMMIT

A local checkout of the library can be used instead:

  LIBHIVE_SOURCE=/path/to/libhive npm run build:wasm
EOF
        exit 1
    fi
    # The checkout is forced, so a tree that has drifted from the pinned
    # commit cannot leak into the build.
    git -C "$LIBHIVE_SOURCE" checkout --force --detach "$LIBHIVE_COMMIT"
fi

if [ ! -d "$LIBHIVE_SOURCE/src" ]; then
    echo "error: the library sources are missing: $LIBHIVE_SOURCE" >&2
    exit 1
fi

# The build compiles a copy of the sources, so the checkout the sources
# come from stays untouched.
if [ -e "$LIBHIVE_DIR/.git" ]; then
    cat >&2 <<EOF
error: LIBHIVE_DIR ($LIBHIVE_DIR) is a git checkout.

LIBHIVE_DIR is the build copy, not the source. Point LIBHIVE_SOURCE at the
sources instead:

  LIBHIVE_SOURCE=$LIBHIVE_DIR npm run build:wasm
EOF
    exit 1
fi
rm -rf "$LIBHIVE_DIR"
mkdir -p "$LIBHIVE_DIR"
cp -R "$LIBHIVE_SOURCE/include" "$LIBHIVE_DIR/include"
cp -R "$LIBHIVE_SOURCE/src" "$LIBHIVE_DIR/src"
if [ -f "$LIBHIVE_SOURCE/LICENSE" ]; then
    cp "$LIBHIVE_SOURCE/LICENSE" "$LIBHIVE_DIR/LICENSE"
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

# The FX bus is compiled in, the way the library's own Makefile does: without
# the reverb the bus renders silence and its parameters report themselves
# unsupported, so the effects module of the panel would do nothing.
FX_DEFS="-DLIBHIVE_FX_REVERB -DLIBHIVE_FX_NOISE_GATE"

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
    $FX_DEFS \
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
