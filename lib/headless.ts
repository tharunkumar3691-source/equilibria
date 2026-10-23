// Builds a scene the way the live view does, but without the page around it: the same world defaults,
// helpers, slider values, floor boundaries and camera framing as components/PhysicsRunner.tsx.
// The pre-flight check (lib/validate.ts) runs it to find problems, and the preview (lib/preview.ts)
// renders it so the AI can look at what it made.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SimulationData } from '../types';
import { compileScene, createRope } from './sandbox';
import { SweepBroadphase } from './broadphase';
import { realMaterial, addGround } from './sceneKit';
import { createHuman, isHumanKind, Human } from './humans';
import { FloorBounds, findFloor, pickMainBody, addBoundaryWalls, enforceBounds } from './bounds';
import { frameShot, shotPoints, sceneBox, fitWholeScene } from './framing';
import { installTextbookPhysics } from './textbookPhysics';

export const STEP = 1 / 60;                       // The live view's fixed physics step
export const DEFAULT_CAMERA = new THREE.Vector3(20, 20, 30);

export interface HeadlessObject { label: string; mesh: THREE.Object3D; body: CANNON.Body; }

export interface HeadlessScene {
  scene: THREE.Scene;
  world: CANNON.World;
  camera: THREE.PerspectiveCamera;
  objects: HeadlessObject[];
  figures: THREE.Object3D[];      // People added with addHuman
  ground: CANNON.Body | null;     // The body from addGround
  groundCalls: number;
  readoutCalls: number;
  ambience: string | null;
  declaredMain: boolean;          // The scene marked an object with main: true
  main: CANNON.Body | null;
  bounds: FloorBounds | null;
  lookAt: THREE.Vector3 | null;   // camera.userData.lookAt, when the scene set a valid one
  step(): void;                   // One physics step plus the frame callbacks, as the live view runs them
  frame(): void;                  // Aims the camera the way the live view does (including its auto-framing)
  syncMeshes(): void;             // Moves every registered mesh to its body
  humansReady(timeoutMs: number): Promise<void>;
  dispose(): void;
}

// realHumans: load the real people (for pictures). Without it a stand-in of the right size is used.
// stepSize: a finer physics step than the live view's, for measuring (lib/measure.ts).
export function buildHeadless(data: SimulationData, options: { realHumans?: boolean; aspect?: number; stepSize?: number } = {}): HeadlessScene {
  const stepSize = options.stepSize ?? STEP;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141c1e); // The live view's backdrop (components/PhysicsRunner.tsx)
  scene.fog = new THREE.Fog(0x0f172a, 20, 100);
  const camera = new THREE.PerspectiveCamera(45, options.aspect ?? 16 / 9, 0.1, 1000);
  camera.position.copy(DEFAULT_CAMERA);
  camera.lookAt(0, 5, 0);

  // The live view's lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(20, 30, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // The live view's world defaults
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);
  world.broadphase = new SweepBroadphase(world);
  (world.solver as any).iterations = 10;
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0;
  if (data.textbookPhysics) installTextbookPhysics(world);

  const objects: HeadlessObject[] = [];
  const frameCallbacks: (() => void)[] = [];
  const figures: THREE.Object3D[] = [];
  const pending: Promise<void>[] = [];
  let declared: CANNON.Body | null = null;

  const result: HeadlessScene = {
    scene, world, camera, objects, figures,
    ground: null, groundCalls: 0, readoutCalls: 0, ambience: null, declaredMain: false,
    main: null, bounds: null, lookAt: null,
    step() {
      world.step(stepSize);
      frameCallbacks.forEach(cb => cb());
    },
    frame() {
      const target = result.lookAt ? result.lookAt.clone() : new THREE.Vector3();
      if (!data.demoMode) frameShot(camera, target, shotPoints(target, objects.map(o => o.body), figures, scene));
      // The live view's opening shot (components/PhysicsRunner.tsx) also steps back to show the whole set-up
      fitWholeScene(camera, target, sceneBox(scene.children, shotPoints(target, objects.map(o => o.body), figures, scene)), 220, 960);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    },
    syncMeshes() {
      objects.forEach(({ mesh, body }) => {
        mesh.position.set(body.position.x, body.position.y, body.position.z);
        mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      });
    },
    humansReady(timeoutMs) {
      return Promise.race([Promise.all(pending).then(() => {}), new Promise<void>(r => setTimeout(r, timeoutMs))]);
    },
    dispose() {
      scene.traverse((child: any) => {
        if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
        materials.forEach((m: any) => {
          // Textures from the scene kit are shared with the live scene, so they stay
          if (m.map && typeof m.map.dispose === 'function' && !m.map.userData?.shared) m.map.dispose();
          if (typeof m.dispose === 'function') m.dispose();
        });
      });
    }
  };

  const addSimulationObject = (label: string, mesh: THREE.Object3D, body: CANNON.Body, opts?: { sound?: string; main?: boolean }) => {
    if (!mesh || !body) return;
    if (!mesh.parent) scene.add(mesh);
    if (!world.bodies.includes(body)) world.addBody(body);
    if (opts && opts.main === true && !declared) declared = body;
    objects.push({ label: String(label), mesh, body });
  };
  const getSimulationObject = (label: string) => objects.find(o => o.label === label);
  const addFrameCallback = (cb: () => void) => { if (typeof cb === 'function') frameCallbacks.push(cb); };
  const addRope = (anchor: any, body: CANNON.Body) => {
    const rope = createRope(world, anchor, body);
    if (!rope) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xcbd5e1 }));
    line.frustumCulled = false;
    scene.add(line);
    const update = () => {
      const p = geometry.attributes.position as THREE.BufferAttribute;
      p.setXYZ(0, rope.anchorBody.position.x, rope.anchorBody.position.y, rope.anchorBody.position.z);
      p.setXYZ(1, body.position.x, body.position.y, body.position.z);
      p.needsUpdate = true;
    };
    update();
    frameCallbacks.push(update);
    return rope.constraint;
  };
  const setAmbience = (kind: string) => { result.ambience = String(kind); };
  const setReadout = () => { result.readoutCalls++; };

  const humanCounts: Record<string, number> = {};
  const addHuman = (kind: string, opts?: { height?: number; pose?: (h: Human) => void }) => {
    const safeKind = isHumanKind(kind) ? kind : 'man';
    const pose = opts && typeof opts.pose === 'function' ? opts.pose : null;
    if (options.realHumans) {
      let resolve!: () => void;
      pending.push(new Promise<void>(r => { resolve = r; }));
      const variant = humanCounts[safeKind] = (humanCounts[safeKind] ?? -1) + 1;   // As in the live view
      const human = createHuman(safeKind, opts && Number(opts.height), h => {
        try { if (pose) pose(h); } catch (e) { console.warn('[Preview] pose threw:', e); }
        resolve();
      }, variant);
      scene.add(human.object);
      figures.push(human.object);
      if (pose) frameCallbacks.push(() => { if (human.ready) pose(human); });
      return human;
    }
    // A stand-in: right name and place for framing, nothing to pose
    const object = new THREE.Group();
    object.name = 'human_' + safeKind;
    scene.add(object);
    figures.push(object);
    return {
      object, ready: false, clips: [], rest: () => {}, play: () => {}, aim: () => {},
      where: () => new THREE.Vector3(), setPose: () => {}
    } as Human;
  };
  const ground = (kind: string) => {
    result.groundCalls++;
    const g = addGround(scene, world, kind);
    if (!result.ground) result.ground = g.body;
    return g;
  };

  delete camera.userData.lookAt;
  compileScene(data.code)(THREE, CANNON, scene, world, camera, addSimulationObject, addFrameCallback, getSimulationObject, () => {}, addRope,
    setAmbience, addHuman, setReadout, realMaterial, ground);

  const lookAt = camera.userData.lookAt;
  if (Array.isArray(lookAt) && lookAt.length === 3 && lookAt.every((n: unknown) => Number.isFinite(n))) {
    result.lookAt = new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]);
  }
  result.declaredMain = !!declared;

  // The live view's floor boundaries for the main object
  const bounds = findFloor(world);
  const main = bounds ? pickMainBody(objects.map(o => o.body), declared, data.startMode === 'click') : null;
  if (bounds && main) addBoundaryWalls(world, bounds, main);
  result.bounds = bounds;
  result.main = main;
  world.addEventListener('postStep', () => {
    if (bounds) enforceBounds(world, bounds, main, objects.map(o => o.body));
  });

  // Starting slider values, applied as the live view applies them ('scale' is the speed control)
  data.sliders.forEach(slider => {
    const val = slider.value;
    if (slider.property === 'scale') return;
    if (slider.targetLabel === 'world' && slider.property === 'gravity') world.gravity.y = -Math.abs(val);
    else if (slider.targetLabel === 'world' && slider.property === 'damping') world.bodies.forEach(b => { if (b.mass > 0) b.linearDamping = val; });
    objects.filter(o => o.label === slider.targetLabel || o.label.startsWith(slider.targetLabel + '_')).forEach(o => {
      if (slider.property === 'mass') { o.body.mass = val; o.body.updateMassProperties(); }
      else if (slider.property === 'damping') { o.body.linearDamping = val; o.body.angularDamping = val; }
    });
  });

  return result;
}
