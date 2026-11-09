/*
 * hivedrum_wasm.c - the only place where Hivedrum's h5.h meets the JS boundary.
 *
 * Every exported function is called from the AudioWorklet thread only.
 * Snapshots are written into static buffers, so the JS side never allocates
 * or frees wasm memory for them.
 *
 * The values on the boundary are the library's own: Q16.16 physical units
 * (Hz, seconds, signed semitones, 0..1 balances) for the parameters, and
 * plain integers for the enums, the statuses and the flags.
 */

#include <emscripten/emscripten.h>
#include <stdbool.h>
#include <stdint.h>

#include "h5.h"

#define WASM_EXPORT EMSCRIPTEN_KEEPALIVE

/* The panel snapshot: for every voice and every parameter, the value the
 * engine holds and whether the pair is supported at all. */
#define PANEL_STRIDE 2
static int32_t panel_out[H5_VOICE_COUNT * H5_PARAM_COUNT * PANEL_STRIDE];

/* The parameter table: for every voice and every parameter, the minimum,
 * the maximum and the default of the engine. */
#define PARAM_INFO_STRIDE 3
static int32_t param_info_out[H5_VOICE_COUNT * H5_PARAM_COUNT * PARAM_INFO_STRIDE];

/* The FX bus snapshot: the value the engine holds for every bus parameter. */
static int32_t fx_state_out[H5_FX_PARAM_COUNT];

/* The FX bus table: the minimum, the maximum and the default of every bus
 * parameter. */
#define FX_PARAM_INFO_STRIDE 3
static int32_t fx_param_info_out[H5_FX_PARAM_COUNT * FX_PARAM_INFO_STRIDE];

/* The level of every instrument, in Q16.16: the peak of the instrument's
 * own voice in the last rendered block, after its own volume and before
 * the pan and the mix. */
static int32_t instrument_levels_out[H5_INSTR_COUNT];

/* The minimum of a parameter the voice does not support. It is out of every
 * range, so the JS side can tell an unsupported pair from a real bound. */
#define PARAM_UNSUPPORTED INT32_MAX

WASM_EXPORT uint32_t hivedrum_version_number(void)
{
    return h5_version_number();
}

WASM_EXPORT void *hivedrum_create(uint32_t sample_rate)
{
    return h5_create_context(sample_rate);
}

WASM_EXPORT void hivedrum_destroy(void *ctx)
{
    h5_destroy_context(ctx);
}

WASM_EXPORT void hivedrum_set_sample_rate(void *ctx, uint32_t sample_rate)
{
    h5_set_sample_rate(ctx, sample_rate);
}

WASM_EXPORT void hivedrum_reset(void *ctx)
{
    h5_reset(ctx);
}

WASM_EXPORT int32_t hivedrum_set_param(void *ctx, int32_t voice, int32_t param,
    int32_t value)
{
    return (int32_t)h5_set_param(ctx, (h5_voice)voice, (h5_param)param,
        value);
}

WASM_EXPORT int32_t hivedrum_get_param(void *ctx, int32_t voice, int32_t param,
    int32_t *out)
{
    return (int32_t)h5_get_param(ctx, (h5_voice)voice, (h5_param)param,
        out);
}

WASM_EXPORT int32_t hivedrum_param_supported(int32_t voice, int32_t param)
{
    return h5_param_supported((h5_voice)voice, (h5_param)param) ? 1 : 0;
}

WASM_EXPORT int32_t hivedrum_fx_param_count(void)
{
    return (int32_t)H5_FX_PARAM_COUNT;
}

WASM_EXPORT int32_t hivedrum_set_fx_param(void *ctx, int32_t param, int32_t value)
{
    return (int32_t)h5_set_fx_param(ctx, (h5_fx_param)param, value);
}

WASM_EXPORT int32_t hivedrum_get_fx_param(void *ctx, int32_t param, int32_t *out)
{
    return (int32_t)h5_get_fx_param(ctx, (h5_fx_param)param, out);
}

WASM_EXPORT int32_t hivedrum_set_instrument_volume(void *ctx, int32_t instrument,
    int32_t volume_q16)
{
    return (int32_t)h5_set_instrument_volume(ctx, (h5_instrument)instrument,
        volume_q16);
}

WASM_EXPORT int32_t hivedrum_get_instrument_volume(void *ctx, int32_t instrument,
    int32_t *out)
{
    return (int32_t)h5_get_instrument_volume(ctx, (h5_instrument)instrument,
        out);
}

WASM_EXPORT int32_t hivedrum_set_instrument_pan(void *ctx, int32_t instrument,
    int32_t pan_q16)
{
    return (int32_t)h5_set_instrument_pan(ctx, (h5_instrument)instrument,
        pan_q16);
}

WASM_EXPORT int32_t hivedrum_get_instrument_pan(void *ctx, int32_t instrument,
    int32_t *out)
{
    return (int32_t)h5_get_instrument_pan(ctx, (h5_instrument)instrument,
        out);
}

WASM_EXPORT int32_t hivedrum_set_instrument_fx_send(void *ctx,
    int32_t instrument, int32_t send_q16)
{
    return (int32_t)h5_set_instrument_fx_send(ctx,
        (h5_instrument)instrument, send_q16);
}

WASM_EXPORT int32_t hivedrum_get_instrument_fx_send(void *ctx,
    int32_t instrument, int32_t *out)
{
    return (int32_t)h5_get_instrument_fx_send(ctx,
        (h5_instrument)instrument, out);
}

WASM_EXPORT int32_t hivedrum_trigger(void *ctx, int32_t instrument)
{
    return (int32_t)h5_trigger(ctx, (h5_instrument)instrument);
}

WASM_EXPORT int32_t hivedrum_trigger_velocity(void *ctx, int32_t instrument,
    int32_t velocity)
{
    if (velocity < 0 || velocity > 127) {
        return (int32_t)H5_ERR_RANGE;
    }
    return (int32_t)h5_trigger_velocity(ctx, (h5_instrument)instrument,
        (uint8_t)velocity);
}

WASM_EXPORT void hivedrum_process(void *ctx, int16_t *stereo_out, int32_t frames)
{
    h5_process(ctx, stereo_out, (size_t)frames);
}

WASM_EXPORT int32_t hivedrum_is_active(void *ctx)
{
    return h5_is_active(ctx) ? 1 : 0;
}

/*
 * The level of every instrument, in Q16.16, as the engine reports it for
 * the last rendered block.
 *
 * The engine knows the contribution of every instrument before it sums the
 * voices into the mix, so the level of a single instrument is the level of
 * that instrument alone. The JS side reads the array and lights the lamp of
 * the module with it.
 */
WASM_EXPORT int32_t *hivedrum_instrument_levels(void *ctx)
{
    int instrument;

    if (h5_get_instrument_levels(ctx, instrument_levels_out) != H5_OK) {
        for (instrument = 0; instrument < (int)H5_INSTR_COUNT; instrument++) {
            instrument_levels_out[instrument] = 0;
        }
    }
    return instrument_levels_out;
}

/*
 * The panel snapshot: the values the engine holds, read back from the
 * engine itself. The JS side never keeps a parallel copy.
 */
WASM_EXPORT int32_t *hivedrum_panel_state(void *ctx)
{
    int voice;
    int param;

    for (voice = 0; voice < (int)H5_VOICE_COUNT; voice++) {
        for (param = 0; param < (int)H5_PARAM_COUNT; param++) {
            int32_t value = 0;
            int supported = 0;
            int32_t *slot = &panel_out[(voice * (int)H5_PARAM_COUNT + param)
                * PANEL_STRIDE];

            if (h5_param_supported((h5_voice)voice, (h5_param)param)
                && h5_get_param(ctx, (h5_voice)voice, (h5_param)param,
                    &value) == H5_OK) {
                supported = 1;
            } else {
                value = 0;
            }

            slot[0] = value;
            slot[1] = supported;
        }
    }
    return panel_out;
}

/*
 * The FX bus snapshot: the values the engine holds for the shared reverb
 * and gate, read back from the engine itself.
 */
WASM_EXPORT int32_t *hivedrum_fx_state(void *ctx)
{
    int param;

    for (param = 0; param < (int)H5_FX_PARAM_COUNT; param++) {
        int32_t value = 0;

        if (h5_get_fx_param(ctx, (h5_fx_param)param, &value) != H5_OK) {
            value = 0;
        }
        fx_state_out[param] = value;
    }
    return fx_state_out;
}

/*
 * The FX bus table: the minimum, the maximum and the default of every bus
 * parameter, probed from a scratch context through the public API alone.
 */
WASM_EXPORT int32_t *hivedrum_fx_param_info(void)
{
    static int probed = 0;
    h5_context probe;
    int param;

    if (probed) {
        return fx_param_info_out;
    }
    probed = 1;

    probe = h5_create_context(0);
    if (probe == 0) {
        return fx_param_info_out;
    }

    /* The defaults come from the fresh context. */
    for (param = 0; param < (int)H5_FX_PARAM_COUNT; param++) {
        int32_t *slot = &fx_param_info_out[param * FX_PARAM_INFO_STRIDE];
        int32_t value = 0;

        if (h5_get_fx_param(probe, (h5_fx_param)param, &value) != H5_OK) {
            value = 0;
        }
        slot[0] = 0;
        slot[1] = 0;
        slot[2] = value;
    }

    /* The bounds come from the clamping of the setter. */
    for (param = 0; param < (int)H5_FX_PARAM_COUNT; param++) {
        int32_t *slot = &fx_param_info_out[param * FX_PARAM_INFO_STRIDE];
        int32_t value = 0;

        (void)h5_set_fx_param(probe, (h5_fx_param)param, INT32_MIN);
        if (h5_get_fx_param(probe, (h5_fx_param)param, &value) != H5_OK) {
            value = 0;
        }
        slot[0] = value;

        (void)h5_set_fx_param(probe, (h5_fx_param)param, INT32_MAX);
        if (h5_get_fx_param(probe, (h5_fx_param)param, &value) != H5_OK) {
            value = 0;
        }
        slot[1] = value;
    }

    h5_destroy_context(probe);
    return fx_param_info_out;
}

/*
 * The parameter table of the engine: the minimum, the maximum and the
 * default of every voice and parameter.
 *
 * The public header does not export the ranges, so they are taken from a
 * scratch context through the public API alone: the defaults are read from
 * a fresh context, and the bounds are found by letting the setter clamp an
 * out-of-range value and reading the clamped result back.
 */
WASM_EXPORT int32_t *hivedrum_param_info(void)
{
    static int probed = 0;
    h5_context probe;
    int voice;
    int param;

    if (probed) {
        return param_info_out;
    }
    probed = 1;

    probe = h5_create_context(0);
    if (probe == 0) {
        return param_info_out;
    }

    /* The defaults come from the fresh context, before anything is changed. */
    for (voice = 0; voice < (int)H5_VOICE_COUNT; voice++) {
        for (param = 0; param < (int)H5_PARAM_COUNT; param++) {
            int32_t *slot = &param_info_out[(voice * (int)H5_PARAM_COUNT
                + param) * PARAM_INFO_STRIDE];
            int32_t value = 0;

            if (!h5_param_supported((h5_voice)voice, (h5_param)param)) {
                slot[0] = PARAM_UNSUPPORTED;
                slot[1] = 0;
                slot[2] = 0;
                continue;
            }

            if (h5_get_param(probe, (h5_voice)voice, (h5_param)param,
                &value) != H5_OK) {
                value = 0;
            }
            slot[0] = 0;
            slot[1] = 0;
            slot[2] = value;
        }
    }

    /* The bounds come from the clamping of the setter. */
    for (voice = 0; voice < (int)H5_VOICE_COUNT; voice++) {
        for (param = 0; param < (int)H5_PARAM_COUNT; param++) {
            int32_t *slot = &param_info_out[(voice * (int)H5_PARAM_COUNT
                + param) * PARAM_INFO_STRIDE];
            int32_t value = 0;

            if (slot[0] == PARAM_UNSUPPORTED) {
                continue;
            }

            (void)h5_set_param(probe, (h5_voice)voice, (h5_param)param,
                INT32_MIN);
            if (h5_get_param(probe, (h5_voice)voice, (h5_param)param,
                &value) != H5_OK) {
                value = 0;
            }
            slot[0] = value;

            (void)h5_set_param(probe, (h5_voice)voice, (h5_param)param,
                INT32_MAX);
            if (h5_get_param(probe, (h5_voice)voice, (h5_param)param,
                &value) != H5_OK) {
                value = 0;
            }
            slot[1] = value;
        }
    }

    h5_destroy_context(probe);
    return param_info_out;
}
