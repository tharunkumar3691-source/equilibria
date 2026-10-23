// Checks lib/textbookPhysics.ts against answers worked out by hand: each case is a small scene, run headless the
// way problem scenes are (lib/headless.ts), at the measuring step (1/600 s) and the live view's (1/60 s).
// Run in the browser console on the dev server:
//   (await import('/lib/textbookPhysicsChecks.ts')).runTextbookPhysicsChecks()
import * as CANNON from 'cannon-es';
import { buildHeadless } from './headless';

interface Check {
  name: string;
  code: string;                                                    // Scene code
  measure: (get: (label: string) => CANNON.Body, until: (done: () => boolean, max?: number) => number | null, run: (s: number) => void) => number;
  expected: number;
  tolerance: number;                                               // Relative, or absolute when expected is 0
}

const g = 9.8;
const rad = (deg: number) => deg * Math.PI / 180;

const floor = (mu: number, e: number, body: string) => `
world.gravity.set(0, -9.8, 0); world.solver.iterations = 30;
const fm = new CANNON.Material('floor'), bm = new CANNON.Material('body');
world.addContactMaterial(new CANNON.ContactMaterial(fm, bm, { friction: ${mu}, restitution: ${e} }));
world.addBody(new CANNON.Body({ mass: 0, material: fm, shape: new CANNON.Box(new CANNON.Vec3(40, 0.1, 40)), position: new CANNON.Vec3(0, -0.1, 0) }));
${body}`;

const slope = (deg: number, mu: number) => `
world.gravity.set(0, -9.8, 0); world.solver.iterations = 30;
const th = ${rad(deg)}, L = 5.0, s = 0.2;
const slopeMat = new CANNON.Material('slope'), blockMat = new CANNON.Material('block');
world.addContactMaterial(new CANNON.ContactMaterial(slopeMat, blockMat, { friction: ${mu}, restitution: 0 }));
const block = new CANNON.Body({ mass: 2, material: blockMat, shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)), linearDamping: 0, angularDamping: 0 });
const dir = new CANNON.Vec3(Math.cos(th), -Math.sin(th), 0), nrm = new CANNON.Vec3(Math.sin(th), Math.cos(th), 0);
const q = new CANNON.Quaternion(); q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -th);
const T = 0.2, top = new CANNON.Vec3(-L * Math.cos(th), 0.3 + L * Math.sin(th), 0);
const slab = new CANNON.Body({ mass: 0, material: slopeMat, shape: new CANNON.Box(new CANNON.Vec3(L / 2 + 0.3, T / 2, 0.5)) });
slab.quaternion.copy(q); slab.position.copy(top.vadd(dir.scale(L / 2)).vsub(nrm.scale(T / 2))); world.addBody(slab);
block.quaternion.copy(q); block.position.copy(top.vadd(nrm.scale(s / 2 + 0.001)));
addSimulationObject('Block', new THREE.Mesh(new THREE.BoxGeometry(s, s, s)), block, { main: true });`;

// Two balls in a head-on collision on a frictionless table; gap 0.937 m so the overlap when they meet is uneven
const collision = (e: number) => `
world.gravity.set(0, -9.81, 0); world.solver.iterations = 30;
const ballMat = new CANNON.Material('ball'), tableMat = new CANNON.Material('table');
world.addContactMaterial(new CANNON.ContactMaterial(ballMat, ballMat, { friction: 0, restitution: ${e} }));
world.addContactMaterial(new CANNON.ContactMaterial(ballMat, tableMat, { friction: 0, restitution: 0 }));
world.addBody(new CANNON.Body({ mass: 0, material: tableMat, shape: new CANNON.Box(new CANNON.Vec3(4, 0.02, 0.5)), position: new CANNON.Vec3(0.5, 0.78, 0) }));
const y = 0.851;
const a = new CANNON.Body({ mass: 0.5, material: ballMat, shape: new CANNON.Sphere(0.05), position: new CANNON.Vec3(-0.937, y, 0), velocity: new CANNON.Vec3(4, 0, 0), linearDamping: 0, angularDamping: 0, fixedRotation: true });
const b = new CANNON.Body({ mass: 1.5, material: ballMat, shape: new CANNON.Sphere(0.05), position: new CANNON.Vec3(0, y, 0), linearDamping: 0, angularDamping: 0, fixedRotation: true });
addSimulationObject('A', new THREE.Mesh(new THREE.SphereGeometry(0.05)), a, { main: true });
addSimulationObject('B', new THREE.Mesh(new THREE.SphereGeometry(0.05)), b);`;
// After the collision: vA = (m1 - e m2) u / (m1 + m2), vB = (1 + e) m1 u / (m1 + m2), with u = 4, m1 = 0.5, m2 = 1.5
const vA = (e: number) => (0.5 - 1.5 * e) * 4 / 2;
const vB = (e: number) => (1 + e) * 0.5 * 4 / 2;

const slideTo = (L: number) => (get: any, until: any) => {
  const b = get('Block'), start = b.position.clone();
  return until(() => b.position.distanceTo(start) >= L, 20) ?? NaN;
};
const aRough = g * (Math.sin(rad(30)) - 0.2 * Math.cos(rad(30)));
const pullA = (deg: number) => (30 * Math.cos(rad(deg)) - 0.3 * (5 * g - 30 * Math.sin(rad(deg)))) / 5;
const vy = 15 * Math.sin(rad(30)), flight = (vy + Math.sqrt(vy * vy + 2 * g * 20)) / g;

const box = (mass: number, y: number, extra = '') =>
  `const b = new CANNON.Body({ mass: ${mass}, material: bm, shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)), position: new CANNON.Vec3(0, ${y}, 0), linearDamping: 0, angularDamping: 0${extra} });`;

const CHECKS: Check[] = [
  { name: 'slope 30°, mu 0.2: time to slide 5 m', code: slope(30, 0.2), measure: slideTo(5), expected: Math.sqrt(10 / aRough), tolerance: 0.005 },
  { name: 'slope 30°, frictionless: time to slide 5 m', code: slope(30, 0), measure: slideTo(5), expected: Math.sqrt(10 / (g * 0.5)), tolerance: 0.005 },
  { name: 'slope 30°, mu 0.7 holds: distance moved in 3 s (m)', code: slope(30, 0.7),
    measure: (get, until, run) => { const b = get('Block'), s0 = b.position.clone(); run(3); return b.position.distanceTo(s0); }, expected: 0, tolerance: 0.005 },
  { name: 'diagonal slide, mu 0.25 from 6 m/s: stopping distance', code: floor(0.25, 0, `${box(3, 0.1)} b.velocity.set(6 / Math.SQRT2, 0, 6 / Math.SQRT2); addSimulationObject('Block', new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)), b, { main: true });`),
    measure: (get, until) => { const b = get('Block'), p0 = b.position.clone(); until(() => b.velocity.length() < 1e-3, 20); return b.position.distanceTo(p0); }, expected: 36 / (2 * 0.25 * g), tolerance: 0.01 },
  { name: 'pull 30 N at 37° on 5 kg, mu 0.3: speed after 2 s', code: floor(0.3, 0, `${box(5, 0.1)} world.addEventListener('preStep', () => b.applyForce(new CANNON.Vec3(30 * Math.cos(${rad(37)}), 30 * Math.sin(${rad(37)}), 0))); addSimulationObject('Block', new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)), b, { main: true });`),
    measure: (get, until, run) => { run(2); return get('Block').velocity.x; }, expected: 2 * pullA(37), tolerance: 0.005 },
  { name: 'spring k 200, 0.5 kg: period', code: floor(0, 0, `${box(0.5, 0.1)} const wall = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(-1, 0.1, 0) }); world.addBody(wall); b.position.x = 0.3;
const sp = new CANNON.Spring(wall, b, { restLength: 1.0, stiffness: 200, damping: 0 }); world.addEventListener('preStep', () => sp.applyForce());
addSimulationObject('Block', new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)), b, { main: true });`),
    measure: (get, until) => { const b = get('Block'); const turns: number[] = []; let prev = b.velocity.x; let t = 0;
      until(() => { t += 1; const v = b.velocity.x; if (prev > 0 && v <= 0) turns.push(t); prev = v; return turns.length >= 3; }, 10);
      return NaN; }, expected: 2 * Math.PI * Math.sqrt(0.5 / 200), tolerance: 0.01 },
  { name: 'projectile from 20 m at 15 m/s, 30°: range', code: `world.gravity.set(0, -9.8, 0);
const b = new CANNON.Body({ mass: 0.3, shape: new CANNON.Sphere(0.05), position: new CANNON.Vec3(0, 20, 0), linearDamping: 0, angularDamping: 0 });
b.velocity.set(15 * Math.cos(${rad(30)}), 15 * Math.sin(${rad(30)}), 0);
addSimulationObject('Stone', new THREE.Mesh(new THREE.SphereGeometry(0.05)), b, { main: true });`,
    measure: (get, until) => { const b = get('Stone'); until(() => b.position.y <= 0, 20); return b.position.x; }, expected: 15 * Math.cos(rad(30)) * flight, tolerance: 0.005 },
  ...[1, 0.5, 0].flatMap(e => [
    { name: `collision e = ${e}: velocity of the 0.5 kg ball`, code: collision(e), measure: (get: any, until: any, run: any) => { run(0.6); return get('A').velocity.x; }, expected: vA(e), tolerance: e === 0 ? 0.01 : 0.01 },
    { name: `collision e = ${e}: velocity of the 1.5 kg ball`, code: collision(e), measure: (get: any, until: any, run: any) => { run(0.6); return get('B').velocity.x; }, expected: vB(e), tolerance: 0.01 }
  ]),
  { name: 'ball dropped 2 m, e 0.8: rebound height', code: floor(0.3, 0.8, `const b = new CANNON.Body({ mass: 0.5, material: bm, shape: new CANNON.Sphere(0.1), position: new CANNON.Vec3(0, 2.1, 0), linearDamping: 0, angularDamping: 0 });
addSimulationObject('Ball', new THREE.Mesh(new THREE.SphereGeometry(0.1)), b, { main: true });`),
    measure: (get, until) => { const b = get('Ball'); until(() => b.velocity.y > 0, 5); let top = 0; until(() => { top = Math.max(top, b.position.y); return b.velocity.y < 0; }, 5); return top - 0.1; },
    expected: 0.64 * 2, tolerance: 0.01 },
  { name: 'block started 5 cm into the floor: highest point (m)', code: floor(0.2, 0, `${box(2, 0.05, ', fixedRotation: true')} addSimulationObject('Block', new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)), b, { main: true });`),
    measure: (get, until) => { const b = get('Block'); let top = 0; until(() => { top = Math.max(top, b.position.y); return false; }, 1); return top; }, expected: 0.1, tolerance: 0.01 },
  { name: 'three stacked boxes: drift of the top one in 5 s (m)', code: floor(0.5, 0, `
[0.1, 0.3, 0.5].forEach((y, i) => { const b = new CANNON.Body({ mass: 3, material: bm, shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)), position: new CANNON.Vec3(0, y, 0) });
  addSimulationObject('Box' + i, new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)), b); });`),
    measure: (get, until, run) => { const b = get('Box2'), p0 = b.position.clone(); run(5); return b.position.distanceTo(p0); }, expected: 0, tolerance: 0.002 }
];

// The spring's period is read from the turning points, so it gets its own measure with the clock
function springPeriod(h: ReturnType<typeof buildHeadless>, step: number): number {
  const b = h.objects[0].body;
  const turns: number[] = [];
  let prev = b.velocity.x;
  for (let i = 0; i < 10 / step && turns.length < 3; i++) {
    h.step();
    const v = b.velocity.x;
    if (prev > 0 && v <= 0) turns.push(h.world.time);
    prev = v;
  }
  return (turns[2] - turns[0]) / 2;
}

export function runTextbookPhysicsChecks(steps = [1 / 600, 1 / 60]) {
  const rows: Record<string, string | number | boolean>[] = [];
  for (const check of CHECKS) {
    for (const step of steps) {
      const h = buildHeadless({ thought_process: '', code: check.code, sliders: [], startMode: 'click', textbookPhysics: true }, { stepSize: step });
      const get = (label: string) => h.objects.find(o => o.label === label)!.body;
      const t0 = h.world.time, time = () => h.world.time - t0;
      const until = (done: () => boolean, max = 30) => { const end = time() + max; while (time() < end) { h.step(); if (done()) return time(); } return null; };
      const run = (s: number) => { const end = time() + s; while (time() < end - step / 2) h.step(); };
      let got: number;
      try {
        got = check.name.startsWith('spring') ? springPeriod(h, step) : check.measure(get, until, run);
      } finally {
        h.dispose();
      }
      const off = check.expected === 0 ? Math.abs(got) : Math.abs(got - check.expected) / Math.abs(check.expected);
      rows.push({
        check: check.name, step: step === 1 / 600 ? '1/600 s' : '1/60 s',
        expected: Number(check.expected.toPrecision(5)), got: Number(got.toPrecision(5)),
        off: check.expected === 0 ? `${off.toFixed(4)} m` : `${(off * 100).toFixed(2)} %`,
        pass: off <= check.tolerance
      });
    }
  }
  return { passed: rows.filter(r => r.pass).length, total: rows.length, rows };
}
