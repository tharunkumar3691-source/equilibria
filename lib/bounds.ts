// Floor boundaries.
// The "main object" of a simulation (the thing the user launches or releases) must stay on the floor:
// it may not leave the floor's footprint and nothing over the floor may sink through it.
// Kept free of React and rendering so it can be tested on its own.
import * as CANNON from 'cannon-es';

export interface FloorBounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  top: number;      // Height of the floor's upper surface
}

const WALL_THICKNESS = 10;      // Thick enough that nothing fast can step through in one tick
const WALL_HEIGHT = 60;
const WALL_BOUNCE = 0.3;        // Share of speed kept when the main object is turned back at the edge
const MAIN_GROUP = 8;           // Collision bit that only the main object and the boundary walls share
const WALL_GROUP = 4;
const FLOOR_TOLERANCE = 0.06;   // How far a body may sink before it is lifted back onto the floor

// The floor is the largest fixed, level box in the scene. Returns null when there is none (e.g. space scenes).
export function findFloor(world: CANNON.World): FloorBounds | null {
  let floor: FloorBounds | null = null;
  let largest = 0;
  for (const b of world.bodies) {
    if (b.type !== CANNON.Body.STATIC) continue;
    // Level boxes only: a tilted ramp has no single top height
    const q = b.quaternion;
    if (Math.abs(q.x) > 0.01 || Math.abs(q.y) > 0.01 || Math.abs(q.z) > 0.01) continue;
    b.shapes.forEach((shape, i) => {
      if (!(shape instanceof CANNON.Box)) return;
      const he = shape.halfExtents;
      const area = he.x * he.z;
      if (he.x < 3 || he.z < 3 || area <= largest) return;
      const o = b.shapeOffsets[i];
      const cx = b.position.x + o.x, cy = b.position.y + o.y, cz = b.position.z + o.z;
      largest = area;
      floor = { minX: cx - he.x, maxX: cx + he.x, minZ: cz - he.z, maxZ: cz + he.z, top: cy + he.y };
    });
  }
  return floor;
}

// The main object: the one the scene marked, otherwise (for click-to-start scenes) the one that starts
// out moving, or failing that the heaviest. Scenes that run by themselves have none unless they mark one.
export function pickMainBody(bodies: CANNON.Body[], declared: CANNON.Body | null, clickToStart: boolean): CANNON.Body | null {
  if (declared) return declared;
  if (!clickToStart) return null;
  let main: CANNON.Body | null = null;
  let best = -1;
  for (const b of bodies) {
    if (b.type !== CANNON.Body.DYNAMIC || b.mass <= 0) continue;
    const score = (b.velocity.length() > 0.5 ? 1e6 : 0) + b.mass;
    if (score > best) { best = score; main = b; }
  }
  return main;
}

// Invisible walls just outside the floor's edge that only the main object can touch:
// everything else keeps its own collision group and passes straight through them.
export function addBoundaryWalls(world: CANNON.World, bounds: FloorBounds, main: CANNON.Body): CANNON.Body[] {
  main.collisionFilterGroup |= MAIN_GROUP;
  const spanX = (bounds.maxX - bounds.minX) / 2 + WALL_THICKNESS;
  const spanZ = (bounds.maxZ - bounds.minZ) / 2 + WALL_THICKNESS;
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const y = bounds.top + WALL_HEIGHT / 2 - 2;
  const layout: [number, number, number, number][] = [
    [bounds.maxX + WALL_THICKNESS / 2, cz, WALL_THICKNESS / 2, spanZ],
    [bounds.minX - WALL_THICKNESS / 2, cz, WALL_THICKNESS / 2, spanZ],
    [cx, bounds.maxZ + WALL_THICKNESS / 2, spanX, WALL_THICKNESS / 2],
    [cx, bounds.minZ - WALL_THICKNESS / 2, spanX, WALL_THICKNESS / 2]
  ];
  return layout.map(([x, z, hx, hz]) => {
    const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, WALL_HEIGHT / 2, hz)) });
    wall.position.set(x, y, z);
    wall.collisionFilterGroup = WALL_GROUP;
    wall.collisionFilterMask = MAIN_GROUP;
    world.addBody(wall);
    return wall;
  });
}

// How far the main object's centre must stay from the floor's edge (its radius, capped for small floors)
export function edgeMargin(b: CANNON.Body, bounds: FloorBounds): number {
  return Math.max(0, Math.min(b.boundingRadius, (bounds.maxX - bounds.minX) / 2 - 0.1, (bounds.maxZ - bounds.minZ) / 2 - 0.1));
}

// Call after every physics step. The walls and the floor do the normal work; this is the guarantee behind
// them, for anything that still gets through (a very fast object, a solver glitch, a dragged object).
export function enforceBounds(world: CANNON.World, bounds: FloorBounds, main: CANNON.Body | null, bodies: CANNON.Body[]) {
  // 1. The main object never leaves the floor's footprint, and never drops below the floor
  if (main && main.world === world) {
    const r = edgeMargin(main, bounds);
    const p = main.position, v = main.velocity;
    if (p.x > bounds.maxX - r) { p.x = bounds.maxX - r; if (v.x > 0) v.x *= -WALL_BOUNCE; }
    else if (p.x < bounds.minX + r) { p.x = bounds.minX + r; if (v.x < 0) v.x *= -WALL_BOUNCE; }
    if (p.z > bounds.maxZ - r) { p.z = bounds.maxZ - r; if (v.z > 0) v.z *= -WALL_BOUNCE; }
    else if (p.z < bounds.minZ + r) { p.z = bounds.minZ + r; if (v.z < 0) v.z *= -WALL_BOUNCE; }
    liftOntoFloor(main, bounds);
  }

  // 2. Nothing that is wholly over the floor sinks through it. Bodies overhanging the edge are left
  //    alone so they can tip over it and fall naturally.
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b === main || b.type !== CANNON.Body.DYNAMIC || b.sleepState === CANNON.Body.SLEEPING) continue;
    const p = b.position, r = b.boundingRadius;
    if (p.y - r > bounds.top) continue; // Clearly above the floor: skip the exact test
    if (p.x - r < bounds.minX || p.x + r > bounds.maxX || p.z - r < bounds.minZ || p.z + r > bounds.maxZ) continue;
    liftOntoFloor(b, bounds);
  }
}

function liftOntoFloor(b: CANNON.Body, bounds: FloorBounds) {
  if (b.position.y - b.boundingRadius > bounds.top) return;
  b.updateAABB();
  const sunk = bounds.top - b.aabb.lowerBound.y;
  if (sunk > FLOOR_TOLERANCE) {
    b.position.y += sunk;
    if (b.velocity.y < 0) b.velocity.y = 0;
  }
}

// Where a dragged body's centre may go: the main object stays inside the footprint, and nothing can be
// pushed down into the floor. Writes the adjusted goal back into 'goal'.
export function clampDragGoal(goal: CANNON.Vec3, b: CANNON.Body, bounds: FloorBounds, isMain: boolean) {
  if (isMain) {
    const r = edgeMargin(b, bounds);
    goal.x = Math.min(Math.max(goal.x, bounds.minX + r), bounds.maxX - r);
    goal.z = Math.min(Math.max(goal.z, bounds.minZ + r), bounds.maxZ - r);
  }
  if (goal.x >= bounds.minX && goal.x <= bounds.maxX && goal.z >= bounds.minZ && goal.z <= bounds.maxZ) {
    b.updateAABB();
    goal.y = Math.max(goal.y, bounds.top + (b.position.y - b.aabb.lowerBound.y));
  }
}
