import {
  PARAM_COUNT,
  paramIndex,
  voiceIndex,
  type EngineState,
  type Param,
  type Voice,
} from '../audio/protocol';
import { fromQ16 } from '../audio/units';
import { INSTRUMENT_NAMES } from '../audio/keyboard';
import { PARAM_SPECS } from './params';

/**
 * The export of a module's settings.
 *
 * The engine has no memory storage, so the settings of a module are the
 * values the engine holds for that voice right now. They are read from the
 * engine's own snapshot, never from a copy the panel keeps, so an exported
 * module is the module as the engine has it.
 *
 * The file carries the physical value of every control the engine supports
 * on that voice, with its unit, and the exact Q16.16 integer next to it:
 * the physical value is what a person reads, the integer is what the
 * engine holds and what a program needs to write the value back without
 * rounding it twice.
 */

/**
 * A physical value, rounded for the file.
 *
 * The engine's Q16.16 integer divides into a float that carries the
 * binary fraction with it: 95.8 Hz comes back as 95.80000305175781. The
 * file carries a number a person reads, and the exact integer next to it,
 * so nothing is lost.
 */
function physical(q16: number): number {
  return Number(fromQ16(q16).toFixed(6));
}

/** One control of the exported module. */
export interface ExportedParameter {
  /** The physical value, in the unit of the control. */
  readonly value: number;
  /** The unit of the control: Hz, s, st or none. */
  readonly unit: string;
  /** The exact value the engine holds, in Q16.16. */
  readonly q16: number;
}

/** The file that holds the settings of a module. */
export interface ModuleExport {
  /** The name of the module, as the panel prints it. */
  readonly module: string;
  /** The voice of the module, as the engine names it. */
  readonly voice: Voice;
  /** The engine the settings belong to. */
  readonly engine: {
    readonly name: string;
    readonly version: string;
  };
  /** The controls of the module, by the name of the engine's parameter. */
  readonly parameters: Readonly<Record<string, ExportedParameter>>;
}

/** The version of the engine, as the panel shows it. */
function versionText(version: number): string {
  const major = (version >> 16) & 0xff;
  const minor = (version >> 8) & 0xff;
  const patch = version & 0xff;
  return `${major}.${minor}.${patch}`;
}

/**
 * The settings of a module, as the engine holds them.
 *
 * Only the controls the engine supports on that voice go into the file:
 * a control the engine does not have is not a setting of the module.
 */
export function buildModuleExport(
  voice: Voice,
  state: EngineState,
  supported: readonly Param[],
): ModuleExport {
  const parameters: Record<string, ExportedParameter> = {};
  const base = voiceIndex(voice) * PARAM_COUNT;

  for (const param of supported) {
    const q16 = state.values[base + paramIndex(param)] ?? 0;
    parameters[param] = {
      value: physical(q16),
      unit: PARAM_SPECS[param].unit,
      q16,
    };
  }

  return {
    module: INSTRUMENT_NAMES[voice],
    voice,
    engine: {
      name: 'libhive',
      version: versionText(state.version),
    },
    parameters,
  };
}

/** The name of the file a module is written to. */
export function exportFileName(voice: Voice): string {
  return `${voice}.json`;
}

/**
 * Write the settings of a module to a file and hand it to the browser.
 *
 * The file is a download like any other: the browser asks where to put it.
 */
export function downloadModuleExport(voice: Voice, data: ModuleExport): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(voice);
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();

  /* The object URL is released once the browser has taken the file. */
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
