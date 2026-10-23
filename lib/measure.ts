// Measures a problem scene's answers: builds the scene without drawing it (lib/headless.ts), at a physics
// step ten times finer than the live view's, and runs the scene's measurement code on it. The code steps
// the physics itself (runUntil / runFor) and reads the bodies, so every number comes from the simulation.
import * as CANNON from 'cannon-es';
import { SimulationData } from '../types';
import { buildHeadless, HeadlessScene } from './headless';

const MEASURE_STEP = 1 / 600;
const MAX_SECONDS = 120;          // Simulated time a measurement may use in all

export const MEASURE_PARAMS = ['world', 'CANNON', 'get', 'objects', 'runFor', 'runUntil', 'time'] as const;

export interface Measurement {
  values: Record<string, number>;
  error?: string;                  // Why the measurement could not be made (written for the model to fix)
}

export function measureScene(data: SimulationData, code: string): Measurement {
  let h: HeadlessScene;
  try {
    h = buildHeadless(data, { stepSize: MEASURE_STEP });
  } catch (e: any) {
    return { values: {}, error: `The scene code threw an error while building the scene: ${e?.message || e}` };
  }
  try {
    const t0 = h.world.time;
    let steps = 0;
    const limit = Math.round(MAX_SECONDS / MEASURE_STEP);
    const advance = () => {
      if (++steps > limit) throw new Error(`the measurement ran past ${MAX_SECONDS} s of simulated time`);
      h.step();
    };
    const time = () => h.world.time - t0;
    const runFor = (seconds: number) => {
      const end = time() + Math.max(0, Number(seconds) || 0);
      while (time() < end - MEASURE_STEP / 2) advance();
      return time();
    };
    // An event that never happens, or has "happened" before anything moved, means the scene or the condition
    // is wrong: either stops the measurement with a reason the model can act on
    const runUntil = (condition: () => unknown, maxSeconds = 30) => {
      if (typeof condition !== 'function') throw new Error('runUntil needs a function as its condition');
      if (condition()) {
        if (steps === 0) throw new Error('a runUntil condition was already true at the start (time 0), before anything moved: the condition is wrong, or the objects do not start where the problem says');
        return time();
      }
      const limit = Math.max(0, Number(maxSeconds) || 0);
      const end = time() + limit;
      while (time() < end) {
        advance();
        if (condition()) return time();
      }
      throw new Error(`a runUntil condition never became true within ${limit} s: the event did not happen in the simulation (an object stuck, fell through a surface or went the wrong way), or the condition is wrong`);
    };
    const labels = h.objects.map(o => o.label);
    const get = (label: string) => {
      const found = h.objects.find(o => o.label === label);
      if (!found) throw new Error(`there is no object labelled '${label}' (the labels are: ${labels.join(', ') || 'none'})`);
      return found.body;
    };
    const objects = h.objects.map(o => ({ label: o.label, body: o.body }));

    const run = new Function(...MEASURE_PARAMS, code);
    const result = run(h.world, CANNON, get, objects, runFor, runUntil, time);
    if (!result || typeof result !== 'object' || result instanceof Promise) {
      return { values: {}, error: 'The measurement code must return an object with one number per measured quantity, keyed by its id (and must not be async).' };
    }
    if (steps === 0) {
      return { values: {}, error: 'The measurement code returned without running the simulation. It must measure each quantity by running the physics (runUntil / runFor) and reading the bodies, never by computing it from the given values.' };
    }
    const values: Record<string, number> = {};
    // Only real numbers count
    for (const [id, value] of Object.entries(result)) {
      if (typeof value === 'number' && Number.isFinite(value)) values[id] = value;
    }
    return { values };
  } catch (e: any) {
    return { values: {}, error: `The measurement code failed: ${e?.message || e}` };
  } finally {
    h.dispose();
  }
}

// Whether a measured value agrees with the solution's answer
export function agrees(answer: number, measured: number, tolerance: number): boolean {
  const scale = Math.max(Math.abs(answer), Math.abs(measured));
  if (scale < 1e-6) return true;
  // An answer of (nearly) zero is compared absolutely: within 1 % of a unit
  if (Math.abs(answer) < 1e-3) return Math.abs(measured) < 0.01;
  return Math.abs(measured - answer) / Math.abs(answer) <= tolerance;
}
