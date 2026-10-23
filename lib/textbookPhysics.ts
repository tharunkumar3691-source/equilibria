// Contact physics as textbooks have it, for problem scenes, whose answers are compared with worked solutions.
// cannon-es departs from it in ways that are small in a demo and large in a measured answer:
// - Friction is capped at mu x m x g (the full size of gravity) whatever presses the surfaces together, so a
//   block on a 30° slope gets mu·m·g instead of mu·m·g·cos 30°, and every contact point of a box gets the
//   whole cap. The solver then compares that cap, a force, with an impulse (GSSolver clamps lambda and reports
//   lambda / dt as the force), which makes friction 1/dt times too strong: 60 times at 60 steps a second.
// - The two friction directions come from Vec3.tangents, which does not normalise them (n x x-axis has length
//   sqrt(1 - nx²)), and each is limited on its own, so friction depends on the direction of sliding.
// - Bounces are soft: SPOOK scales the bounce target by b = 4d / (1 + 4d) (d = relaxation, 3 by default), so the
//   coefficient of restitution comes out as b(1 + e) - 1: an elastic collision (e = 1) gives 0.85.
// - Forces applied in 'preStep' arrive after the solver, so contacts never feel them: a block pulled upward at
//   an angle hops off the floor every few steps instead of pressing on it less.
// - Overlaps are pushed apart with velocity, which adds a speed that depends on how deep two bodies happened to
//   overlap when a collision was found: up to 5 % of a bounce's energy, and a drift apart after a collision that
//   should leave them together.
// - Fast objects sink deep into each other within one 1/60 s step before they collide, and softness counted in
//   steps makes a finer step a stiffer, more violent world.
// Here, while 'enabled' says so: every step is taken as 1/600 s steps; forces from 'preStep' are applied before
// the solve; the solver first finds each contact's normal force N, then solves again with every contact's
// friction limited to mu x N, acting along the sliding; contacts and friction are as soft in seconds as
// cannon's defaults at 60 steps a second, and ask for e' = (1 + e) / b - 1, so e comes out as given; overlaps
// are moved apart by position, never by velocity. Checked against worked answers in lib/textbookPhysicsChecks.ts:
// slopes with and without friction, pulls at an angle, sliding at any angle, springs, projectiles, bounces and
// collisions with e = 0, 0.5 and 1 agree within 0.5 %, the same at 1/60 s and at 1/600 s.
import * as CANNON from 'cannon-es';

const LIVE_STEP = 1 / 60;   // The step cannon's default softness is tuned for, and the live view's
export const FINE_STEP = 1 / 600;   // Every step is taken in steps this long: collisions and friction come out exact
const CONTACT_STIFFNESS = 1e7;      // cannon's defaults (ContactMaterial)
const CONTACT_RELAXATION = 3;
const OVERLAP_SLOP = 0.0005;        // m of overlap left alone (so resting contacts stay touching)
const OVERLAP_SHARE = 0.2;          // Share of the remaining overlap removed each step

const pairKey = (a: CANNON.Body, b: CANNON.Body) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);

type TextbookFriction = CANNON.FrictionEquation & { __contact?: CANNON.ContactEquation; __mu?: number };

// Unit friction directions, the first one along the sliding, so sliding meets exactly mu x N.
// (cannon's vadd / vsub return nothing when given a target, so these are not chained)
const slip = new CANNON.Vec3(), spinI = new CANNON.Vec3(), spinJ = new CANNON.Vec3(), along = new CANNON.Vec3();
function alignWithSlip(contact: CANNON.ContactEquation, t1: CANNON.Vec3, t2: CANNON.Vec3) {
  const { bi, bj, ri, rj, ni } = contact;
  // Velocity of bj's contact point relative to bi's, along the surface
  bi.angularVelocity.cross(ri, spinI);
  bj.angularVelocity.cross(rj, spinJ);
  slip.copy(bj.velocity);
  slip.vadd(spinJ, slip);
  slip.vsub(bi.velocity, slip);
  slip.vsub(spinI, slip);
  ni.scale(slip.dot(ni), along);
  slip.vsub(along, slip);
  if (slip.length() > 1e-6) t1.copy(slip);
  t1.normalize();
  ni.cross(t1, t2);
  t2.normalize();
}

const PRE_STEP = { type: 'preStep' };

// Moves overlapping bodies apart by position alone, a share of the overlap each step (shared by inverse mass),
// so the correction never changes a velocity. A pair's deepest contact point counts, once.
const gap = new CANNON.Vec3(), pointI = new CANNON.Vec3(), pointJ = new CANNON.Vec3();
function separateOverlaps(world: CANNON.World) {
  const deepest = new Map<string, { contact: CANNON.ContactEquation; depth: number }>();
  for (const c of world.contacts) {
    const { bi, bj } = c;
    if (bi.invMass + bj.invMass <= 0) continue;
    bi.position.vadd(c.ri, pointI);
    bj.position.vadd(c.rj, pointJ);
    pointJ.vsub(pointI, gap);
    const depth = -gap.dot(c.ni);
    if (depth <= OVERLAP_SLOP) continue;
    const key = pairKey(bi, bj);
    const known = deepest.get(key);
    if (!known || depth > known.depth) deepest.set(key, { contact: c, depth });
  }
  for (const { contact, depth } of deepest.values()) {
    const { bi, bj, ni } = contact;
    const move = (depth - OVERLAP_SLOP) * OVERLAP_SHARE / (bi.invMass + bj.invMass);
    if (bi.invMass > 0) { bi.position.x -= ni.x * move * bi.invMass; bi.position.y -= ni.y * move * bi.invMass; bi.position.z -= ni.z * move * bi.invMass; }
    if (bj.invMass > 0) { bj.position.x += ni.x * move * bj.invMass; bj.position.y += ni.y * move * bj.invMass; bj.position.z += ni.z * move * bj.invMass; }
  }
}

// 'enabled' is asked on every step and contact, so a world that is reused for other scenes can switch it off
export function installTextbookPhysics(world: CANNON.World, enabled: () => boolean = () => true) {
  const narrowphase = world.narrowphase as any;
  if (narrowphase.__textbook) return;
  narrowphase.__textbook = true;

  const createContact = narrowphase.createContactEquation.bind(narrowphase);
  narrowphase.createContactEquation = (...args: any[]) => {
    const contact: CANNON.ContactEquation = createContact(...args);
    if (enabled()) {
      // cannon's default softness, whatever the scene's materials ask for: the bounce correction below is
      // worked out for it. Relaxation is counted in steps, so it is scaled to be as soft in seconds at any
      // step length (at a fine step an overlap would otherwise be pushed apart ten times as hard).
      const d = CONTACT_RELAXATION * LIVE_STEP / world.dt;
      contact.setSpookParams(CONTACT_STIFFNESS, d, world.dt);
      const b = (4 * d) / (1 + 4 * d);
      contact.restitution = (1 + contact.restitution) / b - 1;
    }
    return contact;
  };

  const createFriction = narrowphase.createFrictionEquationsFromContact.bind(narrowphase);
  narrowphase.createFrictionEquationsFromContact = (contact: CANNON.ContactEquation, out: CANNON.FrictionEquation[]) => {
    const made = createFriction(contact, out);
    if (!made || !enabled()) return made;
    // The coefficient, found as cannon finds it (the contact material's, or the product of the two materials')
    const cm = narrowphase.currentContactMaterial;
    const matA = contact.si.material || contact.bi.material, matB = contact.sj.material || contact.bj.material;
    const mu = matA && matB && matA.friction >= 0 && matB.friction >= 0 ? matA.friction * matB.friction : cm.friction;
    const f1 = out[out.length - 2] as TextbookFriction, f2 = out[out.length - 1] as TextbookFriction;
    alignWithSlip(contact, f1.t, f2.t);
    // As soft in seconds as contacts are (cannon's own setting, counted in steps, lets a resting stack creep)
    const d = CONTACT_RELAXATION * LIVE_STEP / world.dt;
    f1.setSpookParams(CONTACT_STIFFNESS, d, world.dt);
    f2.setSpookParams(CONTACT_STIFFNESS, d, world.dt);
    f1.__contact = f2.__contact = contact;
    f1.__mu = f2.__mu = mu;
    return made;
  };

  // The real 'preStep' is skipped on steps where it already ran before the solve, and 'postStep' runs once
  // per step that was asked for, not for each of its fine steps
  let preStepDone = false;
  let innerStep = false;
  const dispatch = world.dispatchEvent.bind(world);
  world.dispatchEvent = (event: any) => {
    if (event && event.type === 'preStep' && preStepDone) { preStepDone = false; return world; }
    if (event && event.type === 'postStep' && innerStep) return world;
    return dispatch(event);
  };

  // Every step is taken as fine steps, so the live view (1/60 s) moves exactly as the measurement did
  const internalStep = (world as any).internalStep.bind(world);
  (world as any).internalStep = (dt: number) => {
    const n = enabled() ? Math.max(1, Math.round(dt / FINE_STEP)) : 1;
    for (let i = 0; i < n; i++) {
      innerStep = i < n - 1;
      internalStep(dt / n);
      if (enabled()) separateOverlaps(world);
    }
    innerStep = false;
  };

  const velocities: number[] = [];
  const wrap = (solver: CANNON.Solver) => {
    const s = solver as any;
    if (s.__textbook) return solver;
    s.__textbook = true;
    const solve = s.solve.bind(s);
    s.solve = (dt: number, w: CANNON.World) => {
      if (!enabled()) return solve(dt, w);
      // Forces set in 'preStep' join gravity before the solve, so contacts and joints feel them
      dispatch(PRE_STEP);
      preStepDone = true;

      // Contacts set velocities only: overlaps are moved apart after the step (separateOverlaps). Pushing them
      // apart with velocity, as SPOOK does, adds a speed that depends on how deep the bodies happened to overlap
      // when the collision was found: up to 5 % of the energy in a bounce, and a drift apart after a collision
      // that should leave them together.
      for (const e of s.equations) if (e instanceof CANNON.ContactEquation) e.a = 0;
      const frictions = (s.equations as TextbookFriction[]).filter(e => e.__contact);
      if (!frictions.length) return solve(dt, w);

      // 1. Each contact's normal force: solve without friction, read the forces, then undo that solve
      const bodies = w.bodies;
      velocities.length = 0;
      for (const b of bodies) velocities.push(b.velocity.x, b.velocity.y, b.velocity.z, b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z);
      for (const f of frictions) { f.maxForce = 0; f.minForce = 0; }
      solve(dt, w);
      bodies.forEach((b, i) => {
        b.velocity.set(velocities[i * 6], velocities[i * 6 + 1], velocities[i * 6 + 2]);
        b.angularVelocity.set(velocities[i * 6 + 3], velocities[i * 6 + 4], velocities[i * 6 + 5]);
      });

      // 2. The real solve, each contact's friction at most mu x N (given as an impulse, which the solver clamps)
      for (const f of frictions) {
        const limit = f.__mu! * Math.max(0, f.__contact!.multiplier) * dt;
        f.maxForce = limit;
        f.minForce = -limit;
      }
      return solve(dt, w);
    };
    return solver;
  };
  // Scene code may replace the solver; the new one is wrapped too
  let current = wrap(world.solver);
  Object.defineProperty(world, 'solver', { configurable: true, get: () => current, set: (solver: CANNON.Solver) => { current = wrap(solver); } });
}
