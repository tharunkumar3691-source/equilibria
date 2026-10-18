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
      const feet = m.getWorldPosition(new THREE.Vector3());
      points.push(feet, feet.clone().add(new THREE.Vector3(0, 1.8, 0)));
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

// Whether a point is inside the camera's current view (the camera's matrices must be up to date)
export function inView(cam: THREE.PerspectiveCamera, p: THREE.Vector3): boolean {
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  return frustum.containsPoint(p);
}
