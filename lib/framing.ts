// Camera framing shared by the live view (PhysicsRunner) and the headless preview (lib/headless.ts):
// if any person or moving object is outside the shot, keep the camera's viewing direction but step back
// and re-aim so that all of them, and the point it was aimed at, fit in the view.
import * as THREE from 'three';

// The points a generated scene's shot must contain: the aim point, every moving object, and every person
// standing straight in the scene (people inside a body's group are covered by that body)
export function shotPoints(target: THREE.Vector3, bodies: { position: { x: number; y: number; z: number } }[], meshes: THREE.Object3D[], root: THREE.Object3D | null): THREE.Vector3[] {
  const points: THREE.Vector3[] = [target.clone()];
  bodies.forEach(b => points.push(new THREE.Vector3(b.position.x, b.position.y, b.position.z)));
  meshes.forEach(m => {
    if (m.name.startsWith('human_') && m.parent === root) {
      // The whole person, not just a line from feet to head: shoulders, back and reaching arms included
      const feet = m.getWorldPosition(new THREE.Vector3());
      points.push(feet, feet.clone().add(new THREE.Vector3(0, 1.8, 0)));
      [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]].forEach(([x, z]) => points.push(feet.clone().add(new THREE.Vector3(x, 1.0, z))));
    }
  });
  return points;
}

// Moves the camera (and 'target') so every point is in view; leaves them alone when all already are
export function frameShot(cam: THREE.PerspectiveCamera, target: THREE.Vector3, points: THREE.Vector3[]) {
  cam.lookAt(target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  if (points.every(p => inView(cam, p))) return;
  const box = new THREE.Box3().setFromPoints(points);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1.5);
  const direction = cam.position.clone().sub(target);
  if (direction.lengthSq() < 1e-6) direction.set(0.6, 0.4, 1);
  direction.normalize();
  const vertical = THREE.MathUtils.degToRad(cam.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * cam.aspect);
  const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.1;
  cam.position.copy(center).addScaledVector(direction, distance);
  target.copy(center);
}

// The part of the picture the opening shot keeps everything inside, in normalised screen units (-1..1).
// The live view draws nothing over the scene (its controls sit around it), so this is just a calm,
// even margin: a medium shot in which the set-up fills most of the picture without touching its edges.
const SAFE_TOP = 0.84, SAFE_BOTTOM = 0.86;
// The width (in pixels) is kept for callers; the margin no longer depends on it
export const safeWidth = (_viewWidthPx: number) => 0.86;
// Anything this large is the ground, a backdrop or a sky dome, not part of the set-up to show
const BACKDROP_SIZE = 60;
// A wide slab whose top is at floor level is a floor (scenes put the ground's top at y = 0)
const FLOOR_WIDTH = 12, FLOOR_TOP = 0.25;

// Light effects (glows, beams, tails, trails) are drawn by adding light: they are not part of the set-up
const isGlow = (material: any) => (Array.isArray(material) ? material : [material])
  .every((m: any) => m && m.blending === THREE.AdditiveBlending);

// The box around a root's solid parts, in world space
function solidBox(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  const piece = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((o: any) => {
    // Sprites (labels, icons, glows) and fat or overlay lines are annotations, not part of the set-up
    if (!o.visible || !o.geometry || o.isPoints || o.isSprite || o.isLine2 || isGlow(o.material)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    out.union(piece.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return out;
}

// The box around everything that makes up the set-up: every object the scene added (except floors,
// backdrop-sized things and light effects), plus the given points (people, moving bodies, the aim point)
export function sceneBox(roots: THREE.Object3D[], points: THREE.Vector3[]): THREE.Box3 {
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const size = new THREE.Vector3();
  roots.forEach(root => {
    if (!root.visible || (root as any).isPoints || (root as any).isLight) return;
    solidBox(root, part);
    if (part.isEmpty()) return;
    part.getSize(size);
    if (Math.max(size.x, size.y, size.z) >= BACKDROP_SIZE) return;
    if (Math.max(size.x, size.z) >= FLOOR_WIDTH && part.max.y <= FLOOR_TOP) return;
    box.union(part);
  });
  points.forEach(p => box.expandByPoint(p));
  return box;
}

// Opening shot: keeps the camera's viewing direction and aim, and moves it in or out to the closest
// distance at which the whole box sits inside the safe part of the picture (a medium shot, neither
// cramped nor distant). It never comes nearer than minDistance or a third of the scene's own distance.
export function fitWholeScene(cam: THREE.PerspectiveCamera, target: THREE.Vector3, box: THREE.Box3, maxDistance: number, viewWidthPx: number, minDistance = 3) {
  const safeX = safeWidth(viewWidthPx);
  if (box.isEmpty()) return;
  const direction = cam.position.clone().sub(target);
  let distance = direction.length();
  if (distance < 1e-3) { direction.set(0.6, 0.4, 1); distance = 10; }
  direction.normalize();
  const original = distance;
  const limit = Math.max(Math.min(maxDistance, original * 4), original);
  const nearest = Math.min(Math.max(minDistance, original / 3), original);
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(
    i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const p = new THREE.Vector3();
  const fits = () => {
    cam.position.copy(target).addScaledVector(direction, distance);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return corners.every(c => {
      p.copy(c).project(cam);
      return p.z > -1 && p.z < 1 && Math.abs(p.x) <= safeX && p.y <= SAFE_TOP && p.y >= -SAFE_BOTTOM;
    });
  };
  // Smallest fitting distance between nearest and limit (things only get smaller with distance)
  let lo = nearest, hi = limit;
  distance = hi;
  if (!fits()) return;   // Even the farthest allowed shot cannot hold it all: stay there
  distance = lo;
  if (fits()) return;
  for (let i = 0; i < 24; i++) {
    distance = (lo + hi) / 2;
    if (fits()) hi = distance; else lo = distance;
  }
  distance = hi;
  fits();
}

// Whether a point is inside the camera's current view (the camera's matrices must be up to date)
export function inView(cam: THREE.PerspectiveCamera, p: THREE.Vector3): boolean {
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  return frustum.containsPoint(p);
}
