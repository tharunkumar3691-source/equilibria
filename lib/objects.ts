// Reading and editing single objects: live physics figures for the inspector, and the edits the
// object editor offers (size, bounciness, duplicate). Kept free of React and rendering so it can be tested.
import * as CANNON from 'cannon-es';

export interface BodyStats {
  mass: number;
  speed: number;            // Linear speed
  vx: number; vy: number; vz: number;
  spin: number;             // Angular speed, rad/s
  momentum: number;         // mass x speed
  height: number;           // Height of the centre above the floor, measured against gravity
  kinetic: number;          // Linear + rotational kinetic energy
  potential: number;        // mass x gravity x height
  energy: number;           // kinetic + potential
  asleep: boolean;
}

const localSpin = new CANNON.Vec3();

export function bodyStats(b: CANNON.Body, gravity: CANNON.Vec3, floorTop: number): BodyStats {
  const moves = b.type === CANNON.Body.DYNAMIC && b.mass > 0;
  const mass = moves ? b.mass : 0;
  const v = b.velocity, w = b.angularVelocity;
  const speed = v.length();
  // Rotational energy uses the inertia about the body's own axes
  b.quaternion.conjugate().vmult(w, localSpin);
  const I = b.inertia;
  const rotational = moves ? 0.5 * (I.x * localSpin.x * localSpin.x + I.y * localSpin.y * localSpin.y + I.z * localSpin.z * localSpin.z) : 0;
  const g = gravity.length();
  // "Up" is against gravity; with no gravity (space) fall back to the y axis and no potential energy
  const height = g > 1e-6
    ? -(gravity.x * b.position.x + gravity.y * b.position.y + gravity.z * b.position.z) / g - floorTop
    : b.position.y - floorTop;
  const kinetic = 0.5 * mass * speed * speed + rotational;
  const potential = mass * g * height;
  return {
    mass, speed, vx: v.x, vy: v.y, vz: v.z,
    spin: w.length(),
    momentum: mass * speed,
    height, kinetic, potential,
    energy: kinetic + potential,
    asleep: b.sleepState === CANNON.Body.SLEEPING
  };
}

const isHull = (s: CANNON.Shape) => s instanceof CANNON.ConvexPolyhedron && !(s instanceof CANNON.Box);

// Only simple solid shapes can be resized or copied reliably
export function hasEditableShapes(b: CANNON.Body): boolean {
  return b.shapes.length > 0 && b.shapes.every(s => s instanceof CANNON.Sphere || s instanceof CANNON.Box || isHull(s));
}

export function isConstrained(world: CANNON.World, b: CANNON.Body): boolean {
  return world.constraints.some(c => c.bodyA === b || c.bodyB === b);
}

// Resizes a body's collision shapes by 'ratio', keeping its lowest point at the same height so a
// grown object does not end up inside whatever it is standing on. Returns false if nothing was done.
export function scaleBody(b: CANNON.Body, ratio: number): boolean {
  if (!hasEditableShapes(b) || !(ratio > 0) || Math.abs(ratio - 1) < 1e-6) return false;
  b.updateAABB();
  const bottomBefore = b.position.y - b.aabb.lowerBound.y;

  b.shapes.forEach((shape, i) => {
    if (shape instanceof CANNON.Sphere) {
      shape.radius *= ratio;
    } else if (shape instanceof CANNON.Box) {
      shape.halfExtents.scale(ratio, shape.halfExtents);
      shape.updateConvexPolyhedronRepresentation();
    } else {
      const hull = shape as CANNON.ConvexPolyhedron;
      hull.vertices.forEach(v => v.scale(ratio, v));
      hull.worldVerticesNeedsUpdate = true;
      hull.worldFaceNormalsNeedsUpdate = true;
      // A cylinder also remembers its dimensions
      const c = hull as any;
      if (typeof c.radiusTop === 'number') { c.radiusTop *= ratio; c.radiusBottom *= ratio; c.height *= ratio; }
    }
    shape.updateBoundingSphereRadius();
    b.shapeOffsets[i].scale(ratio, b.shapeOffsets[i]);
  });

  b.updateBoundingRadius();
  b.aabbNeedsUpdate = true;
  b.updateAABB();
  b.updateMassProperties();
  b.position.y += bottomBefore * (ratio - 1);
  b.aabbNeedsUpdate = true;
  b.wakeUp();
  return true;
}

function cloneShape(shape: CANNON.Shape): CANNON.Shape | null {
  let copy: CANNON.Shape | null = null;
  if (shape instanceof CANNON.Sphere) copy = new CANNON.Sphere(shape.radius);
  else if (shape instanceof CANNON.Box) copy = new CANNON.Box(shape.halfExtents.clone());
  else if (shape instanceof CANNON.ConvexPolyhedron) {
    copy = new CANNON.ConvexPolyhedron({
      vertices: shape.vertices.map(v => v.clone()),
      faces: shape.faces.map(f => f.slice())
    });
  }
  if (copy) {
    copy.material = shape.material;
    copy.collisionResponse = shape.collisionResponse;
    copy.collisionFilterGroup = shape.collisionFilterGroup;
    copy.collisionFilterMask = shape.collisionFilterMask;
  }
  return copy;
}

// A separate body with the same shapes and physical settings, at rest, placed just above the original.
// Returns null when the body has a shape that cannot be copied.
export function duplicateBody(b: CANNON.Body): CANNON.Body | null {
  if (!hasEditableShapes(b)) return null;
  b.updateAABB();
  const height = b.aabb.upperBound.y - b.aabb.lowerBound.y;
  const copy = new CANNON.Body({
    mass: b.mass,
    type: b.type,
    material: b.material || undefined,
    linearDamping: b.linearDamping,
    angularDamping: b.angularDamping,
    allowSleep: b.allowSleep,
    sleepSpeedLimit: b.sleepSpeedLimit,
    sleepTimeLimit: b.sleepTimeLimit,
    collisionFilterGroup: b.collisionFilterGroup,
    collisionFilterMask: b.collisionFilterMask,
    fixedRotation: b.fixedRotation
  });
  for (let i = 0; i < b.shapes.length; i++) {
    const shape = cloneShape(b.shapes[i]);
    if (!shape) return null;
    copy.addShape(shape, b.shapeOffsets[i].clone(), b.shapeOrientations[i].clone());
  }
  copy.position.set(b.position.x, b.position.y + height + 0.05, b.position.z);
  copy.quaternion.copy(b.quaternion);
  copy.linearFactor.copy(b.linearFactor);
  copy.angularFactor.copy(b.angularFactor);
  copy.updateMassProperties();
  return copy;
}

// --- Per-object bounciness ---
// The engine decides bounce per PAIR of materials, so one object gets its own material plus a contact
// rule against every other material in the scene. Friction for each pair is carried over unchanged.
const edited = new WeakMap<CANNON.Body, { material: CANNON.Material; original: CANNON.Material | null; value: number }>();
const fallbackMaterial = new WeakMap<CANNON.World, CANNON.Material>();

export function getBodyBounce(world: CANNON.World, b: CANNON.Body): number {
  const entry = edited.get(b);
  if (entry) return entry.value;
  return world.defaultContactMaterial.restitution;
}

export function setBodyBounce(world: CANNON.World, b: CANNON.Body, restitution: number) {
  const value = Math.min(Math.max(restitution, 0), 1.2);
  let entry = edited.get(b);
  if (!entry) {
    const original = b.material;
    const material = new CANNON.Material('edited');
    if (original) { material.friction = original.friction; material.restitution = original.restitution; }
    entry = { material, original, value };
    edited.set(b, entry);
    b.material = material;
  }
  entry.value = value;
  const mine = entry.material;

  // Bodies without a material only ever get the world's default rule, so give them a shared neutral
  // one (it changes nothing between themselves) that a rule can be written against.
  let neutral = fallbackMaterial.get(world);
  const others = new Set<CANNON.Material>([mine]);
  for (const other of world.bodies) {
    if (other === b) continue;
    if (!other.material) {
      if (!neutral) { neutral = new CANNON.Material('neutral'); fallbackMaterial.set(world, neutral); }
      other.material = neutral;
    }
    others.add(other.material);
  }

  others.forEach(other => {
    const existing = world.getContactMaterial(mine, other);
    if (existing) { existing.restitution = value; return; }
    const reference = (entry!.original && world.getContactMaterial(entry!.original, other)) || world.defaultContactMaterial;
    world.addContactMaterial(new CANNON.ContactMaterial(mine, other, {
      friction: reference.friction,
      restitution: value,
      contactEquationStiffness: reference.contactEquationStiffness,
      contactEquationRelaxation: reference.contactEquationRelaxation,
      frictionEquationStiffness: reference.frictionEquationStiffness,
      frictionEquationRelaxation: reference.frictionEquationRelaxation
    }));
  });
  b.wakeUp();
}
