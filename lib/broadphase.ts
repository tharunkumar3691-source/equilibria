// Collision broadphase (the fast first pass that decides which pairs of bodies might touch).
//
// cannon-es's SAPBroadphase sorts bodies by the lower edge of their bounding box but then stops
// scanning using each body's centre and bounding radius. Those two orderings disagree for long thin
// or rotated bodies next to small ones, and whole pairs are skipped: a ball could fall straight
// through a tilted ramp piece. This version scans with the same bounding boxes it sorts by, so no
// overlapping pair is ever missed.
import * as CANNON from 'cannon-es';

export class SweepBroadphase extends CANNON.SAPBroadphase {
  collisionPairs(_world: CANNON.World, p1: CANNON.Body[], p2: CANNON.Body[]) {
    const bodies = this.axisList;
    const N = bodies.length;
    const axis = this.axisIndex === 0 ? 'x' : this.axisIndex === 1 ? 'y' : 'z';

    // Bounding boxes must be current for every body, including fixed ones that scene code moved by hand
    for (let i = 0; i < N; i++) bodies[i].updateAABB();
    if (this.dirty) {
      this.sortList();
      this.dirty = false;
    }

    for (let i = 0; i < N; i++) {
      const bi = bodies[i];
      const upper = bi.aabb.upperBound[axis];
      for (let j = i + 1; j < N; j++) {
        const bj = bodies[j];
        // The list is sorted by lower edge, so nothing after this one can overlap bi either
        if (bj.aabb.lowerBound[axis] > upper) break;
        if (!this.needBroadphaseCollision(bi, bj)) continue;
        const before = p1.length;
        this.intersectionTest(bi, bj, p1, p2);
        if (p1.length !== before) {
          wakeIfStruck(bi, bj);
          wakeIfStruck(bj, bi);
        }
      }
    }
  }
}

// A sleeping body is treated as immovable for the step in which something hits it (the engine only
// wakes it afterwards), so the first impact was swallowed: a ball could stop dead against a light
// crate. Waking the sleeper as soon as a fast body reaches it lets that first impact count.
function wakeIfStruck(sleeper: CANNON.Body, mover: CANNON.Body) {
  if (sleeper.sleepState !== CANNON.Body.SLEEPING || sleeper.type !== CANNON.Body.DYNAMIC) return;
  if (mover.sleepState === CANNON.Body.SLEEPING || mover.type === CANNON.Body.STATIC) return;
  const speedSquared = mover.velocity.lengthSquared() + mover.angularVelocity.lengthSquared();
  if (speedSquared >= 2 * mover.sleepSpeedLimit * mover.sleepSpeedLimit) sleeper.wakeUp();
}
