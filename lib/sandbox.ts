// How scene code (AI-generated or a built-in demo) is prepared and compiled.
// Shared by the live view (PhysicsRunner) and the headless pre-flight check (lib/validate.ts),
// so both run exactly the same code with the same helper names.
import * as CANNON from 'cannon-es';

// The names scene code can use, in the order they are passed to the compiled function
export const SCENE_PARAMS = [
  'THREE', 'CANNON', 'scene', 'world', 'camera',
  'addSimulationObject', 'addFrameCallback', 'getSimulationObject', 'addClickCallback', 'addRope', 'setAmbience',
  'addHuman', 'setReadout', 'realMaterial', 'addGround'
] as const;

// Models sometimes re-declare what the app already provides (imports, the scene, the helpers).
// Those declarations are removed or renamed so they cannot shadow the real ones.
export function sanitizeSceneCode(code: string): string {
  return code
    .replace(/import\s+.*\s+from\s+.*;/g, '')
    .replace(/require\(.*\);/g, '')
    .replace(/const\s+scene\s*=\s*[^;]+;/g, '')
    .replace(/let\s+scene\s*=\s*[^;]+;/g, '')
    .replace(/var\s+scene\s*=\s*[^;]+;/g, '')
    .replace(/const\s+world\s*=\s*[^;]+;/g, '')
    .replace(/let\s+world\s*=\s*[^;]+;/g, '')
    .replace(/var\s+world\s*=\s*[^;]+;/g, '')
    .replace(/const\s+camera\s*=\s*[^;]+;/g, '')
    .replace(/let\s+camera\s*=\s*[^;]+;/g, '')
    .replace(/var\s+camera\s*=\s*[^;]+;/g, '')
    .replace(/const\s+THREE\s*=\s*[^;]+;/g, '')
    .replace(/const\s+CANNON\s*=\s*[^;]+;/g, '')
    .replace(/(const|let|var|function)\s+(addSimulationObject)/g, '$1 _$2_Ignored')
    .replace(/(const|let|var|function)\s+(addFrameCallback)/g, '$1 _$2_Ignored')
    .replace(/(const|let|var|function)\s+(getSimulationObject)/g, '$1 _$2_Ignored')
    .replace(/(const|let|var|function)\s+(addClickCallback|addRope|setAmbience|addHuman|setReadout|realMaterial|addGround)\b/g, '$1 _$2_Ignored');
}

export function compileScene(code: string): (...args: any[]) => void {
  return new Function(...SCENE_PARAMS, sanitizeSceneCode(code)) as (...args: any[]) => void;
}

// The physics half of addRope: a fixed anchor and a constraint that keeps the body at its current
// distance from it. Returns null when the inputs are unusable.
export function createRope(world: CANNON.World, anchor: any, body: CANNON.Body): { anchorBody: CANNON.Body; constraint: CANNON.DistanceConstraint } | null {
  if (!anchor || !body) return null;
  const a = Array.isArray(anchor) ? { x: anchor[0], y: anchor[1], z: anchor[2] } : anchor;
  const anchorBody = new CANNON.Body({ mass: 0 });
  anchorBody.position.set(Number(a.x) || 0, Number(a.y) || 0, Number(a.z) || 0);
  world.addBody(anchorBody);
  const constraint = new CANNON.DistanceConstraint(anchorBody, body, anchorBody.position.distanceTo(body.position));
  world.addConstraint(constraint);
  return { anchorBody, constraint };
}
