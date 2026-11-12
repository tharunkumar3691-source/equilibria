// Pre-flight check for generated scenes: builds the scene exactly as the live view would (lib/headless.ts),
// runs it for a few seconds without drawing it, and reports what is wrong.
// - A fatal error means the scene cannot be shown at all (it throws, builds nothing, or blows up).
// - Issues are quality problems the viewer would notice (objects overlapping or falling through the
//   ground, nothing happening, no readout, a badly framed shot...). The scene runs, but the AI is asked
//   to fix them. Each issue is written as an instruction the AI can act on.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SimulationData } from '../types';
import { buildHeadless, HeadlessScene, DEFAULT_CAMERA } from './headless';
import { MATERIAL_NAMES } from './sceneKit';
import { inView } from './framing';

export interface SceneCheck {
  ok: boolean;          // false: a fatal error, the scene cannot be used
  error?: string;
  issues: string[];     // Quality problems (may be present even when ok)
  objects: number;
}

const CHECK_SECONDS = 5;
const POSITION_LIMIT = 1e5;     // Anything further out than this has been flung by an unstable setup
const OVERLAP_LIMIT = 0.03;     // m of interpenetration at the start that counts as an overlap
const MOVE_SPEED = 0.1;         // m/s: below this, nothing is visibly happening
const MAX_LISTED = 3;

// Every problem of a check, fatal first, as one list
export const problemsOf = (check: SceneCheck): string[] => [...(check.error ? [check.error] : []), ...check.issues];

// Lower is better: a fatal error is worst, then the number of issues
export const checkScore = (check: SceneCheck): number => (check.ok ? check.issues.length : 1000);

const fmt = (n: number) => n.toFixed(2);
const at = (b: CANNON.Body) => `(${fmt(b.position.x)}, ${fmt(b.position.y)}, ${fmt(b.position.z)})`;

// Asynchronous only so the page stays responsive: it pauses briefly every few steps
export async function checkSimulation(data: SimulationData): Promise<SceneCheck> {
  let h: HeadlessScene;
  try {
    h = buildHeadless(data);
  } catch (e: any) {
    return { ok: false, issues: [], objects: 0, error: `The scene code threw an error while building the scene: ${e && e.message ? e.message : String(e)}` };
  }
  const { world, objects } = h;
  const issues: string[] = [];
  const fatal = (error: string): SceneCheck => ({ ok: false, error, issues, objects: objects.length });
  const name = (b: CANNON.Body) => {
    const o = objects.find(x => x.body === b);
    if (o) return `'${o.label}'`;
    if (b === h.ground) return 'the ground';
    return `a fixed body at ${at(b)}`;
  };

  try {
    if (world.bodies.length === 0) return fatal('The scene code created no physics bodies');
    if (objects.length === 0) return fatal('No object was registered with addSimulationObject, so nothing can move or be interacted with');

    const kit = !data.demoMode;   // The realism-kit rules apply to generated scenes, not to the built-in demos
    const space = h.ambience === 'space' || world.gravity.length() < 0.01;

    if (kit && h.groundCalls === 0 && !space) issues.push("There is no ground from addGround. Call addGround(kind) exactly once, with the kind of ground this would really happen on (do not build your own floor).");
    if (h.groundCalls > 1) issues.push(`addGround was called ${h.groundCalls} times. Call it exactly once.`);
    if (kit && data.startMode === 'click' && !h.declaredMain) issues.push("startMode is 'click' but no object is marked { main: true }. Mark the one object the user sets off.");

    // Plain, untextured materials make a scene look like a toy
    if (kit) {
      let plain = 0, total = 0;
      h.scene.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        total++;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!materials.some((m: any) => m && MATERIAL_NAMES.includes(m.name))) plain++;
      });
      if (total > 0 && plain >= 3 && plain / total > 0.25) {
        issues.push(`${plain} of ${total} meshes use plain materials instead of realMaterial(...). Use realMaterial with the true material and colour on every mesh.`);
      }
    }

    // The shot the scene chose, before the app's own framing fixes it up
    if (kit) {
      if (h.camera.position.distanceTo(DEFAULT_CAMERA) < 1e-6) {
        issues.push('The camera was never placed. Set camera.position and camera.userData.lookAt so the whole action is framed from the side and a little above.');
      } else {
        h.camera.lookAt(h.lookAt || new THREE.Vector3());
        h.camera.updateMatrixWorld();
        h.camera.updateProjectionMatrix();
        const subjects = (h.main ? objects.filter(o => o.body === h.main) : objects.filter(o => o.body.type === CANNON.Body.DYNAMIC)).slice(0, 12);
        const hidden = subjects.filter(o => !inView(h.camera, new THREE.Vector3(o.body.position.x, o.body.position.y, o.body.position.z)));
        if (hidden.length) {
          issues.push(`At the start, ${hidden.slice(0, MAX_LISTED).map(o => `'${o.label}' at ${at(o.body)}`).join(', ')} ${hidden.length === 1 ? 'is' : 'are'} outside the camera's view (camera at ${fmt(h.camera.position.x)}, ${fmt(h.camera.position.y)}, ${fmt(h.camera.position.z)}). Move the camera and lookAt so the moving objects and where they end up are both in view.`);
        }
        if (h.ground && h.camera.position.y < 0.2) issues.push('The camera is at or below the ground (y < 0.2). Raise it.');
      }
    }

    // Overlaps at the start: contacts found on the first step, measured from where the bodies started
    const start = new Map<CANNON.Body, CANNON.Vec3>();
    world.bodies.forEach(b => start.set(b, b.position.clone()));
    h.step();
    const overlaps = new Map<string, number>();
    const d = new CANNON.Vec3();
    for (const c of world.contacts) {
      const pi = start.get(c.bi), pj = start.get(c.bj);
      if (!pi || !pj) continue;
      d.set(pj.x + c.rj.x - pi.x - c.ri.x, pj.y + c.rj.y - pi.y - c.ri.y, pj.z + c.rj.z - pi.z - c.ri.z);
      const depth = -d.dot(c.ni);
      if (depth < OVERLAP_LIMIT) continue;
      const key = `${name(c.bi)} and ${name(c.bj)}`;
      overlaps.set(key, Math.max(overlaps.get(key) || 0, depth));
    }
    if (overlaps.size) {
      const list = [...overlaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LISTED).map(([k, v]) => `${k} (${Math.round(v * 100)} cm)`);
      issues.push(`Objects overlap at the start: ${list.join('; ')}${overlaps.size > MAX_LISTED ? ` and ${overlaps.size - MAX_LISTED} more pairs` : ''}. Rest each object on its support (centre y = support top + half its height + 0.001) and keep them apart.`);
    }

    // Run it, watching for blow-ups and for whether anything happens at all
    let moved = false;
    const steps = Math.round(CHECK_SECONDS * 60);
    for (let step = 1; step < steps; step++) {
      if (step > 1) h.step();
      if (step % 30 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      for (const b of world.bodies) {
        const p = b.position;
        if (!Number.isFinite(p.x + p.y + p.z)) return fatal(`${name(b)}'s position became NaN (not a number) while the physics ran`);
        if (Math.abs(p.x) > POSITION_LIMIT || Math.abs(p.y) > POSITION_LIMIT || Math.abs(p.z) > POSITION_LIMIT) {
          return fatal(`${name(b)} was flung out of the scene (unstable constraint or overlapping bodies)`);
        }
      }
      if (!moved) {
        moved = objects.some(({ body }) => {
          if (body.type === CANNON.Body.STATIC) return false;
          const s = start.get(body);
          return body.velocity.length() > MOVE_SPEED || body.angularVelocity.length() * Math.max(body.boundingRadius, 0.05) > MOVE_SPEED ||
            (!!s && s.distanceTo(body.position) > 0.05);
        });
      }
    }

    if (!moved) issues.push(`Nothing moves in the first ${CHECK_SECONDS} seconds after the start. Give the moving object its real starting velocity or pose (raised, pulled back, tilted) so the action happens by itself as soon as time runs.`);

    if (h.bounds) {
      // (Bodies parked below the ground on purpose, waiting to be used, are not counted)
      const below = (p: { y: number }) => p.y < h.bounds!.top - 1;
      const fell = objects.filter(o => o.body.type === CANNON.Body.DYNAMIC && below(o.body.position) && !below(start.get(o.body)!));
      if (fell.length) {
        issues.push(`${fell.slice(0, MAX_LISTED).map(o => `'${o.label}'`).join(', ')} fell through or off the ground within ${CHECK_SECONDS} s (now at y = ${fmt(fell[0].body.position.y)}). Keep objects on the ground and check their collision shapes match their meshes.`);
      }
    }

    if (kit && h.readoutCalls === 0) issues.push('setReadout is never called. Add a report() function with 3 to 6 key quantities and units, call it once at build time and pass it to addFrameCallback.');

    return { ok: true, issues, objects: objects.length };
  } catch (e: any) {
    return fatal(`The scene code threw an error while running: ${e && e.message ? e.message : String(e)}`);
  } finally {
    h.dispose();
  }
}
