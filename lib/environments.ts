// Real-world settings for Realistic mode. A simulation is shown where it would really happen: a Newton's cradle
// on a desk in a study, dominoes on a living-room floor, a seesaw in a park, a crate in a warehouse...
//
// Each setting builds, around the simulation's set-up and at its true scale:
// - the surface it stands on (a desk top, floorboards, grass, polished concrete), in place of the plain floor,
// - the place around it (a room with a window, a park with trees and sky, a warehouse with racks),
// - things placed on the surface and nearby (a lamp, books, a mug; a bench; pallets and boxes),
// - lighting to match (window daylight and a lamp; the sun and sky; high-bay lights).
// Everything is visual only and sits outside the set-up's footprint, so the physics is untouched. It is all
// added to one group and every change is recorded, so turning Realistic off restores the scene exactly.
//
// Scale: demos use their own units. 'realSize' is the real size in metres of the set-up's largest dimension,
// from which the units per metre are worked out (e.g. a cradle 19 units wide that is really 0.2 m wide).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { realMaterial } from './sceneKit';

export type SettingId = 'study' | 'living-room' | 'lab' | 'park' | 'bowling-alley' | 'warehouse' | 'space' | 'none';

export interface EnvironmentSpec {
  setting: SettingId;
  realSize?: number;    // Real size (m) of the set-up's largest dimension
  upm?: number;         // Or: scene units per metre directly (1 for scenes built in metres)
  dressOnly?: boolean;  // Keep the scene's own ground, sky and lights; only add the place around it
}

export interface EnvContext {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  top: number;                     // Height of the surface the set-up stands on
  box: THREE.Box3;                 // The set-up (its objects, not the floor)
  floorSize: { x: number; z: number } | null;   // The plain floor to hide (its footprint)
  cameraDistance: number;
}

export interface EnvHandle {
  setting: SettingId;
  ibl: 'sky' | 'none';  // 'sky': outdoors, so the sky does the fill light
  update?(dt: number): void;   // Settings with motion of their own: called with the simulation's time step while it runs
  dispose(): void;
}

// Where each setting is, for the message shown when Realistic mode is turned on
export const SETTING_PLACES: Record<SettingId, string> = {
  'study': 'on a desk in a quiet study',
  'living-room': 'in a sunny living room',
  'lab': 'on a bench in a physics lab',
  'park': 'in a park on a sunny day',
  'bowling-alley': 'in a bowling alley',
  'warehouse': 'in a warehouse',
  'space': 'in deep space',
  'none': ''
};

// ---------------------------------------------------------------------------------------------------------
// Choosing a setting for a scene that does not name one (generated scenes)

const KEYWORDS: [SettingId, RegExp][] = [
  ['warehouse', /\b(warehouse|crate|pallet|forklift|factory|garage|loading dock)\b/i],
  ['living-room', /\b(dominoe?s?|living room|marble run|toy car|toys?)\b/i],
  ['park', /\b(park|playground|garden|field|lawn|swing|seesaw|slide|football|soccer|basketball|cricket|tennis)\b/i]
];

// The setting for a generated scene, from the ground it stands on (the kind it passed to addGround) and what it
// says about itself. Generated scenes are built in metres on their own realistic ground and sky, so only the
// place around them is added: trees and a bench, racks and pallets, a sofa and a rug. Scenes with no floor get
// nothing, except space scenes, which get the Milky Way.
export function chooseSetting(text: string, groundKind: string | null, hasFloor: boolean): EnvironmentSpec {
  const none: EnvironmentSpec = { setting: 'none' };
  if (/\b(space|orbits?|planets?|solar system|galaxy|asteroids?|comet|black hole|astronauts?|satellites?)\b/i.test(text)) return { setting: 'space', upm: 1, dressOnly: true };
  if (!hasFloor) return none;
  let setting: SettingId = 'none';
  if (/\bbowling\b/i.test(text)) setting = 'bowling-alley';
  else if (groundKind) {
    if (/grass|dirt|sand|snow|asphalt/.test(groundKind)) setting = 'park';
    else if (/concrete/.test(groundKind)) setting = 'warehouse';
    else if (/wood|tiles|lab/.test(groundKind)) setting = 'living-room';
  } else {
    for (const [id, re] of KEYWORDS) if (re.test(text)) { setting = id; break; }
  }
  return setting === 'none' ? none : { setting, upm: 1, dressOnly: true };
}

// ---------------------------------------------------------------------------------------------------------
// Building blocks

const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, colour = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const painted = (color: number, roughness = 0.9, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const leafMaterial = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });

// A whiteboard with today's lesson: the simple pendulum, sketched and with its formula, in marker
function whiteboardTexture() {
  return canvasTexture(1024, 512, c => {
    c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, 1024, 512);
    // Faint traces of earlier lessons, wiped off
    c.fillStyle = 'rgba(120,130,150,0.06)';
    for (let i = 0; i < 5; i++) c.fillRect(560 + i * 70, 300 + (i % 2) * 60, 200, 30);
    const hand = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
    c.lineCap = 'round';
    // The sketch: a pivot, a string at an angle, the bob, the vertical and the angle between them
    c.strokeStyle = '#2a5b9a'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(120, 90); c.lineTo(300, 90); c.stroke();
    c.beginPath(); c.moveTo(210, 90); c.lineTo(310, 330); c.stroke();
    c.beginPath(); c.arc(318, 350, 26, 0, Math.PI * 2); c.stroke();
    c.setLineDash([14, 12]); c.lineWidth = 4;
    c.beginPath(); c.moveTo(210, 90); c.lineTo(210, 380); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = '#b8433a';
    c.beginPath(); c.arc(210, 90, 110, Math.PI / 2 - 0.39, Math.PI / 2); c.stroke();
    c.fillStyle = '#b8433a'; c.font = `bold 38px ${hand}`;
    c.fillText('θ', 222, 240);
    c.fillStyle = '#2a5b9a'; c.font = `bold 34px ${hand}`;
    c.fillText('L', 272, 200);
    c.fillText('m', 356, 362);
    // The lesson
    c.fillStyle = '#1f2f4a'; c.font = `bold 46px ${hand}`;
    c.fillText('Simple pendulum', 470, 110);
    c.fillStyle = '#2a5b9a'; c.font = `bold 58px ${hand}`;
    c.fillText('T = 2π √(L / g)', 480, 220);
    c.fillStyle = '#b8433a'; c.font = `36px ${hand}`;
    c.fillText('longer string → slower swing', 480, 300);
    c.fillStyle = '#2a5b9a'; c.font = `34px ${hand}`;
    c.fillText('(small angles: θ < 15°)', 480, 370);
  });
}

// A woven rug: a plain field with a border, and a fine weave
function rugMaterial(palette: { field: string; border: string }, rand: () => number) {
  const map = canvasTexture(512, 512, c => {
    const S = 512;
    c.fillStyle = palette.field; c.fillRect(0, 0, S, S);
    // A plain field with one quiet border band, so the simulation on top stays the thing to look at
    c.strokeStyle = palette.border; c.lineWidth = 22;
    c.strokeRect(11, 11, S - 22, S - 22);
    // The weave: thousands of tiny light and dark flecks
    for (let i = 0; i < 26000; i++) {
      c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
      c.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1);
    }
  });
  map.anisotropy = 8;
  return new THREE.MeshPhysicalMaterial({ map, roughness: 1, sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color(palette.field) });
}
const glowing = (color: number, intensity = 2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 });

class Builder {
  root = new THREE.Group();
  private materials = new Map<string, THREE.Material>();
  constructor(public scene: THREE.Scene, public upm: number) {
    this.root.name = 'real-world-setting';
    scene.add(this.root);
  }
  m(metres: number) { return metres * this.upm; }
  // One material per look, shared by every prop that uses it (books, leaves, pins)
  mat(name: string, options: Parameters<typeof realMaterial>[1] = {}) {
    const key = name + JSON.stringify(options);
    let material = this.materials.get(key);
    if (!material) { material = realMaterial(name, options); this.materials.set(key, material); }
    return material;
  }

  add<T extends THREE.Object3D>(obj: T, parent: THREE.Object3D = this.root): T {
    parent.add(obj);
    return obj;
  }
  // A box with its base at y (all in units), sized in metres
  box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, opts: { cast?: boolean; receive?: boolean; rotY?: number; parent?: THREE.Object3D } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(this.m(w), this.m(h), this.m(d)), material);
    mesh.position.set(x, y + this.m(h) / 2, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = opts.receive !== false;
    return this.add(mesh, opts.parent);
  }
  cyl(rTop: number, rBottom: number, h: number, material: THREE.Material, x: number, y: number, z: number, segments = 24, opts: { cast?: boolean; parent?: THREE.Object3D } = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(this.m(rTop), this.m(rBottom), this.m(h), segments), material);
    mesh.position.set(x, y + this.m(h) / 2, z);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    return this.add(mesh, opts.parent);
  }
  // A clump of leaves: a faceted ball, so foliage catches the light in many small planes
  foliage(r: number, material: THREE.Material, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1]) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(this.m(r), 1), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(...scale);
    mesh.rotation.set(x * 0.37, z * 0.23, y * 0.11);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.add(mesh);
  }
  sphere(r: number, material: THREE.Material, x: number, y: number, z: number, opts: { scale?: [number, number, number]; cast?: boolean; parent?: THREE.Object3D } = {}) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(this.m(r), 24, 16), material);
    mesh.position.set(x, y, z);
    if (opts.scale) mesh.scale.set(...opts.scale);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    return this.add(mesh, opts.parent);
  }
  // A flat surface (floor or rug) lying at height y, sized in units
  floor(width: number, depth: number, material: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    return this.add(mesh);
  }
  // A wall seen from inside the room only (from outside it is invisible, like an architect's cut-away)
  wall(width: number, height: number, material: THREE.Material, x: number, y: number, z: number, facing: 'north' | 'south' | 'east' | 'west' | 'down') {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(x, y + (facing === 'down' ? 0 : height / 2), z);
    if (facing === 'south') mesh.rotation.y = 0;               // Faces +z
    if (facing === 'north') mesh.rotation.y = Math.PI;         // Faces -z
    if (facing === 'east') mesh.rotation.y = Math.PI / 2;      // Faces +x
    if (facing === 'west') mesh.rotation.y = -Math.PI / 2;     // Faces -x
    if (facing === 'down') mesh.rotation.x = Math.PI / 2;      // A ceiling
    mesh.receiveShadow = true;
    return this.add(mesh);
  }

  // --- Furniture and props, all in metres from a base point (units) ---

  pottedPlant(x: number, y: number, z: number, height: number, rand: () => number) {
    const potH = height * 0.3;
    this.cyl(height * 0.13, height * 0.1, potH, this.mat('ceramic', { color: 0xc8714a }), x, y, z);
    const leaf = leafMaterial(0x3d7a45);
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2, r = height * (0.04 + rand() * 0.12);
      this.foliage(height * (0.12 + rand() * 0.08), leaf, x + Math.cos(a) * this.m(r), y + this.m(potH + height * (0.15 + rand() * 0.45)), z + Math.sin(a) * this.m(r), [1, 1.5, 1]);
    }
  }
  books(x: number, y: number, z: number, count: number, rand: () => number, standing = false, rotY = 0) {
    const colours = [0x7b2d26, 0x2f4b6e, 0x3e5e3a, 0xb08a3c, 0x5a3d63, 0x8c8c84, 0x1f3a3f];
    const group = this.add(new THREE.Group());
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const w = 0.03 + rand() * 0.03, h = 0.2 + rand() * 0.08, d = 0.15 + rand() * 0.05;
      const mat = this.mat('fabric', { color: colours[Math.floor(rand() * colours.length)], size: 0.3 });
      if (standing) this.box(w, h, d, mat, this.m(offset), 0, 0, { parent: group });
      else this.box(d, w, h * 0.75, mat, 0, this.m(offset), 0, { parent: group, rotY: (rand() - 0.5) * 0.3 });
      offset += w + 0.002;
    }
  }
  windowPane(width: number, height: number, x: number, y: number, z: number, facing: 'south' | 'east' | 'west') {
    // A bright sky seen through glass, with a wooden frame and cross bars
    const sky = canvasTexture(8, 256, ctx => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#7fb2e8'); g.addColorStop(0.7, '#d9ecfb'); g.addColorStop(1, '#eef6ee');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 256);
    });
    const group = this.add(new THREE.Group());
    group.position.set(x, y, z);
    group.rotation.y = facing === 'south' ? 0 : facing === 'east' ? Math.PI / 2 : -Math.PI / 2;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false }));
    pane.position.z = 0.002 * this.upm;
    group.add(pane);
    const frame = realMaterial('light-wood', { color: 0xf1ece2, size: 1 });
    const t = this.m(0.06), dz = this.m(0.04);
    [[width + 2 * t, t, 0, height / 2 + t / 2], [width + 2 * t, t, 0, -height / 2 - t / 2], [t, height, -width / 2 - t / 2, 0], [t, height, width / 2 + t / 2, 0], [t * 0.6, height, 0, 0], [width, t * 0.6, 0, 0]].forEach(([w, h, fx, fy]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, dz), frame);
      bar.position.set(fx, fy, dz / 2);
      bar.castShadow = true;
      group.add(bar);
    });
    return group;
  }
}

// Records what a setting changes, so it can all be put back
interface Lights {
  sun: { color: THREE.Color; intensity: number; position: THREE.Vector3 };
  ambient: { color: THREE.Color; intensity: number };
}
interface Saved extends Lights {
  background: THREE.Scene['background'];
  fog: { near: number; far: number; color: THREE.Color } | null;
  hidden: THREE.Object3D[];
  dimmed: { light: THREE.Light; was: number; now: number }[];
  applied: Lights | null;   // The lighting the setting left, to tell whether the user changed it since
}

const readLights = (ctx: EnvContext): Lights => ({
  sun: { color: ctx.sun.color.clone(), intensity: ctx.sun.intensity, position: ctx.sun.position.clone() },
  ambient: { color: ctx.ambient.color.clone(), intensity: ctx.ambient.intensity }
});

function save(ctx: EnvContext): Saved {
  const fog = ctx.scene.fog as THREE.Fog | null;
  return {
    ...readLights(ctx),
    background: ctx.scene.background,
    fog: fog && 'near' in fog ? { near: fog.near, far: fog.far, color: fog.color.clone() } : null,
    hidden: [],
    dimmed: [],
    applied: null
  };
}

// The scene's own studio lights (a demo's key spotlight) mostly give way to the setting's daylight and lamps
function dimStudioLights(ctx: EnvContext, saved: Saved) {
  ctx.scene.traverse(o => {
    const light = o as THREE.Light;
    if (!light.isLight || light === ctx.sun || light === (ctx.ambient as THREE.Light)) return;
    const was = light.intensity;
    light.intensity = was * 0.3;
    saved.dimmed.push({ light, was, now: light.intensity });
  });
}

// Hides the plain floor (and its edge outline) the setting replaces
function hideFloor(ctx: EnvContext, saved: Saved, root: THREE.Object3D) {
  if (!ctx.floorSize) return;
  const box = new THREE.Box3(), size = new THREE.Vector3();
  ctx.scene.children.forEach(o => {
    if (o === root || !o.visible || (o as any).isLight) return;
    if (o.name === 'floor-outline') { o.visible = false; saved.hidden.push(o); return; }
    if (!(o as any).isMesh) return;
    box.setFromObject(o);
    box.getSize(size);
    if (size.x >= ctx.floorSize!.x * 0.9 && size.z >= ctx.floorSize!.z * 0.9 && Math.abs(box.max.y - ctx.top) < 0.6 && size.y < 4) {
      o.visible = false;
      saved.hidden.push(o);
    }
  });
}

function restore(ctx: EnvContext, saved: Saved, b: Builder, extra: THREE.Texture[]) {
  ctx.scene.remove(b.root);
  b.root.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => {
      if (m.map && !m.map.userData?.shared) m.map.dispose();
      m.dispose();
    });
  });
  extra.forEach(t => t.dispose());
  saved.hidden.forEach(o => { o.visible = true; });
  saved.dimmed.forEach(d => { if (d.light.intensity === d.now) d.light.intensity = d.was; });
  ctx.scene.background = saved.background;
  const fog = ctx.scene.fog as THREE.Fog | null;
  if (fog && saved.fog && 'near' in fog) { fog.near = saved.fog.near; fog.far = saved.fog.far; fog.color.copy(saved.fog.color); }
  // Lighting goes back to how it was, except what the user changed in the lighting panel meanwhile
  const applied = saved.applied;
  ctx.sun.color.copy(saved.sun.color);
  ctx.ambient.color.copy(saved.ambient.color);
  if (!applied || ctx.sun.intensity === applied.sun.intensity) ctx.sun.intensity = saved.sun.intensity;
  if (!applied || ctx.sun.position.equals(applied.sun.position)) ctx.sun.position.copy(saved.sun.position);
  if (!applied || ctx.ambient.intensity === applied.ambient.intensity) ctx.ambient.intensity = saved.ambient.intensity;
}

function setFog(ctx: EnvContext, colour: number, near: number, far: number) {
  const fog = ctx.scene.fog as THREE.Fog | null;
  if (fog && 'near' in fog) { fog.color.set(colour); fog.near = near; fog.far = far; }
}

function setSun(ctx: EnvContext, colour: number, intensity: number, dir: [number, number, number]) {
  ctx.sun.color.set(colour);
  ctx.sun.intensity = intensity;
  ctx.sun.position.set(dir[0], dir[1], dir[2]).normalize().multiplyScalar(60);
}

// ---------------------------------------------------------------------------------------------------------
// The settings

const SETTINGS: SettingId[] = ['study', 'living-room', 'lab', 'park', 'bowling-alley', 'warehouse', 'space'];

export function buildEnvironment(spec: EnvironmentSpec, ctx: EnvContext): EnvHandle | null {
  if (!SETTINGS.includes(spec.setting)) return null;
  const size = ctx.box.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.01);
  const upm = spec.upm ?? (spec.realSize ? largest / spec.realSize : 1);
  const b = new Builder(ctx.scene, upm);
  const saved = save(ctx);
  const textures: THREE.Texture[] = [];
  const rand = seeded(1234);
  const centre = ctx.box.getCenter(new THREE.Vector3());
  const top = ctx.top;
  const hx = Math.max(size.x / 2, b.m(0.05)), hz = Math.max(size.z / 2, b.m(0.05));
  const full = !spec.dressOnly;
  if (full) {
    hideFloor(ctx, saved, b.root);
    dimStudioLights(ctx, saved);   // Before the setting adds its own lights
  }
  // Rooms are made big enough that the camera is inside them (walls are invisible from outside anyway)
  const roomReach = (metres: number) => Math.max(b.m(metres), ctx.cameraDistance * 1.25);
  let ibl: EnvHandle['ibl'] = 'none';

  const indoorLights = (warmth: number, sunDir: [number, number, number], sunIntensity: number) => {
    // Daylight through the window, and the soft light a room bounces around (shadows indoors are never black)
    setSun(ctx, warmth, sunIntensity, sunDir);
    ctx.ambient.color.set(0xfff4e6);
    ctx.ambient.intensity = 0.5;
    b.add(new THREE.HemisphereLight(0xfff3e0, 0x8a7a68, 0.85));
    setFog(ctx, 0x2a2622, 1e6, 2e6);   // No haze indoors
    ctx.scene.background = new THREE.Color(0x1d1a17);   // Only seen when zoomed out of the room
  };

  // A room: floor, four walls (seen from inside), ceiling, skirting
  const room = (floorY: number, halfX: number, halfZ: number, height: number, floorMat: THREE.Material, wallColour: number, cx = centre.x, cz = centre.z) => {
    b.floor(halfX * 2, halfZ * 2, floorMat, cx, floorY, cz);
    const wallMat = painted(wallColour, 0.92);
    b.wall(halfX * 2, height, wallMat, cx, floorY, cz - halfZ, 'south');
    b.wall(halfX * 2, height, wallMat, cx, floorY, cz + halfZ, 'north');
    b.wall(halfZ * 2, height, wallMat, cx - halfX, floorY, cz, 'east');
    b.wall(halfZ * 2, height, wallMat, cx + halfX, floorY, cz, 'west');
    b.wall(halfX * 2, halfZ * 2, painted(0xf3efe8, 0.95), cx, floorY + height, cz, 'down');
    const skirt = painted(0xf2eee6, 0.6);
    b.box(halfX * 2 / upm, 0.1, 0.02, skirt, cx, floorY, cz - halfZ + b.m(0.01), { cast: false });
    b.box(0.02, 0.1, halfZ * 2 / upm, skirt, cx - halfX + b.m(0.01), floorY, cz, { cast: false });
    b.box(0.02, 0.1, halfZ * 2 / upm, skirt, cx + halfX - b.m(0.01), floorY, cz, { cast: false });
  };

  let update: EnvHandle['update'];
  // A setting that fails part-way is taken down again, leaving the scene as it was
  try {
  if (spec.setting === 'study') {
    // A walnut desk under a window in a calm study, with a desk lamp; a bookshelf and a plant at the side.
    // The desk top stays clear around the set-up, so nothing competes with the physics.
    const deskW = Math.max(b.m(1.5), hx * 2 * 1.6), deskD = Math.max(b.m(0.75), hz * 2 * 1.9);
    const deskH = b.m(0.75), floorY = full ? top - deskH : top;
    if (full) {
      const desk = realMaterial('dark-wood', { size: [deskW / upm, deskD / upm] });
      b.box(deskW / upm, 0.035, deskD / upm, desk, centre.x, top - b.m(0.035), centre.z);
      const legMat = realMaterial('dark-wood', { size: 0.1 });
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => b.box(0.05, 0.75 - 0.035, 0.05, legMat, centre.x + sx * (deskW / 2 - b.m(0.05)), floorY, centre.z + sz * (deskD / 2 - b.m(0.05))));
      b.box(deskW / upm * 0.4, 0.12, 0.02, realMaterial('dark-wood', { size: 0.4 }), centre.x + deskW * 0.2, top - b.m(0.17), centre.z + deskD / 2 - b.m(0.01));   // Drawer front
      // The desk stands against the wall, under a window: daylight comes in from behind the set-up
      const wallZ = centre.z - deskD / 2 - b.m(0.08);
      const halfX = roomReach(2.3), halfZ = roomReach(2.0);
      room(floorY, halfX, halfZ, b.m(2.7), realMaterial('wood-floor', { size: [halfX * 2 / upm, halfZ * 2 / upm], color: 0xd8c8b4 }), 0xe0d5c3, centre.x, wallZ + halfZ);
      b.windowPane(b.m(1.2), b.m(1.15), centre.x, top + b.m(0.12 + 0.575), wallZ + b.m(0.005), 'south');
      // A bookshelf beside the desk and a plant in the corner
      const shelfX = centre.x + deskW / 2 + b.m(0.6), shelfZ = wallZ + b.m(0.17);
      b.box(1.0, 1.9, 0.32, b.mat('light-wood', { size: 1 }), shelfX, floorY, shelfZ);
      for (let i = 0; i < 4; i++) b.books(shelfX - b.m(0.42), floorY + b.m(0.25 + i * 0.45), shelfZ + b.m(0.17), 12 + Math.floor(rand() * 6), rand, true);
      b.pottedPlant(centre.x - deskW / 2 - b.m(0.45), floorY, wallZ + b.m(0.4), 1.1, rand);
      indoorLights(0xfff1dc, [-0.45, 1.0, -0.9], 2.1);
    }
    // A desk lamp (with real light) at the back corner of the desk, clear of the set-up
    const left = centre.x - hx - b.m(0.15), back = centre.z - hz - b.m(0.1);
    const lampMetal = realMaterial('painted-metal', { color: 0x2f4f4f });
    b.cyl(0.07, 0.08, 0.02, lampMetal, left - b.m(0.05), top, back);
    b.cyl(0.008, 0.008, 0.38, lampMetal, left - b.m(0.05), top + b.m(0.02), back);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(b.m(0.08), b.m(0.12), 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2f4f4f, roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }));
    shade.position.set(left - b.m(0.0), top + b.m(0.42), back + b.m(0.03));
    shade.rotation.z = 0.5;
    shade.castShadow = true;
    b.add(shade);
    b.sphere(0.022, glowing(0xffe0a8, 3), left + b.m(0.005), top + b.m(0.39), back + b.m(0.03), { cast: false });
    const lamp = new THREE.PointLight(0xffd9a0, 1, 0, 2);
    lamp.intensity = 1.8 * b.m(0.45) * b.m(0.45);
    lamp.position.set(left + b.m(0.01), top + b.m(0.37), back + b.m(0.03));
    b.add(lamp);
  }

  else if (spec.setting === 'living-room') {
    // A sunny living room: floorboards, a plain rug under the set-up, a sofa behind, a plant, a window, a lamp
    const floorY = top;
    if (full) {
      const halfX = roomReach(3.2), halfZ = roomReach(2.8);
      room(floorY, halfX, halfZ, b.m(2.7), realMaterial('wood-floor', { size: [halfX * 2 / upm, halfZ * 2 / upm], color: 0xd8c8b4 }), 0xe3d8c6);
      b.windowPane(b.m(1.6), b.m(1.5), centre.x - b.m(0.6), floorY + b.m(1.35), centre.z - halfZ + b.m(0.02), 'south');
      indoorLights(0xfff0d8, [-0.4, 1.0, -0.9], 1.8);
    }
    const rugW = Math.max(hx * 2 * 1.35, b.m(1.6)), rugD = Math.max(hz * 2 * 1.35, b.m(1.2));
    b.floor(rugW, rugD, rugMaterial({ field: '#a9a08f', border: '#56656b' }, rand), centre.x, floorY + b.m(0.0015), centre.z);
    // Sofa behind the rug
    const sofaZ = centre.z - rugD / 2 - b.m(0.65), fabric = realMaterial('fabric', { color: 0x5d7a7f, size: 0.5 });
    b.box(2.1, 0.42, 0.9, fabric, centre.x, floorY, sofaZ);
    b.box(2.1, 0.45, 0.22, fabric, centre.x, floorY + b.m(0.42), sofaZ - b.m(0.34));
    b.box(0.22, 0.25, 0.9, fabric, centre.x - b.m(0.95), floorY + b.m(0.42), sofaZ);
    b.box(0.22, 0.25, 0.9, fabric, centre.x + b.m(0.95), floorY + b.m(0.42), sofaZ);
    [-0.5, 0.5].forEach(o => b.box(0.45, 0.35, 0.14, realMaterial('fabric', { color: 0xd9b26f, size: 0.3 }), centre.x + b.m(o), floorY + b.m(0.47), sofaZ - b.m(0.15)));
    b.pottedPlant(centre.x - rugW / 2 - b.m(0.5), floorY, centre.z - rugD / 2 - b.m(0.3), 1.2, rand);
    // Floor lamp with real light
    const lampX = centre.x + rugW / 2 + b.m(0.3), lampZ = sofaZ;
    b.cyl(0.14, 0.16, 0.03, realMaterial('brass'), lampX, floorY, lampZ);
    b.cyl(0.012, 0.012, 1.5, realMaterial('brass'), lampX, floorY, lampZ);
    b.cyl(0.14, 0.2, 0.28, new THREE.MeshStandardMaterial({ color: 0xf3e6c8, emissive: 0xffd8a0, emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide }), lampX, floorY + b.m(1.45), lampZ, 24, { cast: false });
    const lamp = new THREE.PointLight(0xffd9a0, 1, 0, 2);
    lamp.intensity = 3 * b.m(1.0) * b.m(1.0);
    lamp.position.set(lampX, floorY + b.m(1.5), lampZ);
    b.add(lamp);
  }

  else if (spec.setting === 'lab') {
    // A school physics lab: a black resin bench, white cabinets, a whiteboard with the lesson, ceiling panels
    const benchW = Math.max(b.m(2.4), hx * 2 * 1.4), benchD = Math.max(b.m(0.9), hz * 2 * 1.4);
    const benchH = b.m(0.9), floorY = full ? top - benchH : top;
    if (full) {
      b.box(benchW / upm, 0.03, benchD / upm, new THREE.MeshPhysicalMaterial({ color: 0x1c1e21, roughness: 0.35, clearcoat: 0.6 }), centre.x, top - b.m(0.03), centre.z);
      b.box(benchW / upm - 0.05, 0.87, benchD / upm - 0.08, painted(0xeef0ee, 0.6), centre.x, floorY, centre.z);
      for (let i = 0; i < 4; i++) b.box(0.18, 0.015, 0.01, realMaterial('brushed-steel'), centre.x - benchW / 2 + benchW * (i + 0.5) / 4, floorY + b.m(0.7), centre.z + benchD / 2 - b.m(0.03));
      const halfX = roomReach(3.5), halfZ = roomReach(3.0), wallZ = centre.z - halfZ;
      room(floorY, halfX, halfZ, b.m(3.0), realMaterial('tiles', { size: [halfX * 2 / upm, halfZ * 2 / upm], color: 0xdedbd4 }), 0xd9e2dc);
      // Whiteboard with the lesson on it, in an aluminium frame with a marker tray
      const boardTexture = whiteboardTexture();
      b.box(2.2, 1.1, 0.02, new THREE.MeshStandardMaterial({ map: boardTexture, roughness: 0.2 }), centre.x, floorY + b.m(1.0), wallZ + b.m(0.02), { cast: false });
      const frame = b.mat('aluminium');
      [[2.26, 0.03, 0, -0.015], [2.26, 0.03, 0, 1.085]].forEach(([w, h, dx, dy]) => b.box(w, h, 0.035, frame, centre.x + b.m(dx), floorY + b.m(1.0 + dy), wallZ + b.m(0.025), { cast: false }));
      [-1.115, 1.115].forEach(dx => b.box(0.03, 1.1, 0.035, frame, centre.x + b.m(dx), floorY + b.m(1.0), wallZ + b.m(0.025), { cast: false }));
      b.box(0.8, 0.02, 0.07, frame, centre.x + b.m(0.5), floorY + b.m(0.97), wallZ + b.m(0.05), { cast: false });
      b.windowPane(b.m(1.4), b.m(1.3), centre.x - halfX + b.m(0.02), floorY + b.m(1.5), centre.z, 'east');
      // Ceiling light panels
      for (let i = -1; i <= 1; i++) b.box(1.2, 0.03, 0.6, glowing(0xf5f8ff, 1.6), centre.x + b.m(i * 1.8), floorY + b.m(2.95), centre.z, { cast: false });
      setSun(ctx, 0xf4f7ff, 2.0, [-0.6, 1.4, 0.4]);
      ctx.ambient.color.set(0xf4f7ff);
      ctx.ambient.intensity = 0.3;
      b.add(new THREE.HemisphereLight(0xf8fbff, 0x8a8a84, 0.55));
      setFog(ctx, 0xe8ebea, 1e6, 2e6);
      ctx.scene.background = new THREE.Color(0x1d1f21);
    }
    // One beaker on the bench beside the set-up
    const right = centre.x + hx + b.m(0.15), back = centre.z - hz;
    b.cyl(0.04, 0.04, 0.12, b.mat('glass'), right, top, back, 24);
    b.cyl(0.036, 0.036, 0.07, b.mat('water', { color: 0x4f9fbf }), right, top + b.m(0.004), back, 24, { cast: false });
  }

  else if (spec.setting === 'park') {
    // A sunny park: grass, a path, a bench, a fence, a few trees and soft clouds in a blue sky
    ibl = 'sky';
    if (full) {
      b.floor(b.m(160), b.m(160), realMaterial('grass', { size: 160, color: 0xe2f0cf }), centre.x, top, centre.z);
      const sky = canvasTexture(8, 512, c => {
        const g = c.createLinearGradient(0, 0, 0, 512);
        g.addColorStop(0, '#3f7fcf'); g.addColorStop(0.55, '#8ec0ee'); g.addColorStop(0.8, '#d6e9f7'); g.addColorStop(1, '#eef4ec');
        c.fillStyle = g; c.fillRect(0, 0, 8, 512);
      });
      textures.push(sky);
      ctx.scene.background = sky;
      setFog(ctx, 0xd9e8f2, b.m(45), b.m(150));
      setSun(ctx, 0xfff2d6, 3.0, [0.6, 1.1, 0.5]);
      ctx.ambient.color.set(0xffffff);
      ctx.ambient.intensity = 0.25;
      b.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a6b3e, 0.6));
    }
    // A gravel path behind the set-up
    b.floor(b.m(60), b.m(1.8), realMaterial('dirt', { size: [60, 1.8], color: 0xc9b89a }), centre.x, top + b.m(0.01), centre.z - hz - b.m(3.5));
    // Bench beside the path
    const benchX = centre.x - hx - b.m(3.5), benchZ = centre.z - hz - b.m(2.2);
    const slat = realMaterial('wood', { size: 1.6 }), iron = realMaterial('iron');
    for (let i = 0; i < 4; i++) b.box(1.6, 0.03, 0.08, slat, benchX, top + b.m(0.45), benchZ - b.m(0.15) + b.m(i * 0.1));
    for (let i = 0; i < 3; i++) b.box(1.6, 0.08, 0.025, slat, benchX, top + b.m(0.58 + i * 0.12), benchZ - b.m(0.24));
    [-0.7, 0.7].forEach(o => b.box(0.05, 0.45, 0.4, iron, benchX + b.m(o), top, benchZ));
    // Fence along the back
    const fenceZ = centre.z - hz - b.m(10);
    const fenceWood = realMaterial('light-wood', { size: 1 });
    for (let i = -14; i <= 14; i++) b.box(0.08, 1.0, 0.08, fenceWood, centre.x + b.m(i * 1.5), top, fenceZ);
    [0.35, 0.75].forEach(h => b.box(43.5, 0.08, 0.04, fenceWood, centre.x, top + b.m(h), fenceZ + b.m(0.05)));
    // A few trees, well behind the fence: a backdrop, not a forest
    const bark = b.mat('dark-wood', { size: 0.5 });
    const leaves = [0x4f7f3f, 0x5f8f45, 0x3f6f3a, 0x6f9a4a];
    const reach = Math.hypot(hx, hz);
    const leafMats = leaves.map(leafMaterial);
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * (0.12 + (i + rand() * 0.6) / 10 * 0.76), r = reach + b.m(22 + rand() * 30);
      const tx = centre.x + Math.cos(a) * r, tz = centre.z - Math.sin(a) * r;
      const h = 4 + rand() * 4;
      b.cyl(0.12, 0.2, h * 0.45, bark, tx, top, tz, 12);
      const leaf = leafMats[i % leafMats.length];
      if (i % 3 === 0) {
        for (let k = 0; k < 3; k++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(b.m(h * (0.3 - k * 0.07)), b.m(h * 0.45), 16), leaf);
          cone.position.set(tx, top + b.m(h * (0.45 + k * 0.2)), tz);
          cone.castShadow = true;
          b.add(cone);
        }
      } else {
        for (let k = 0; k < 6; k++) b.foliage(h * (0.15 + rand() * 0.08), leaf, tx + b.m((rand() - 0.5) * h * 0.4), top + b.m(h * (0.55 + rand() * 0.3)), tz + b.m((rand() - 0.5) * h * 0.4));
      }
    }
    // Soft clouds
    const cloud = canvasTexture(256, 128, c => {
      for (let i = 0; i < 14; i++) {
        const x = 40 + rand() * 176, y = 50 + rand() * 40, r = 22 + rand() * 30;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, 256, 128);
      }
    });
    for (let i = 0; i < 4; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloud, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
      const a = Math.PI * (0.1 + rand() * 0.8), r = b.m(80 + rand() * 40);
      sprite.position.set(centre.x + Math.cos(a) * r, top + b.m(16 + rand() * 14), centre.z - Math.sin(a) * r);
      sprite.scale.set(b.m(34 + rand() * 20), b.m(16 + rand() * 8), 1);
      (sprite as any).isLine2 = true;   // Kept out of the ambient-occlusion pass, which would draw it as a dark square
      sprite.raycast = () => {};
      b.add(sprite);
    }
    textures.push(cloud);
  }

  else if (spec.setting === 'bowling-alley') {
    // A bowling centre: two maple lanes either side with gutters and pins, a dark masking wall, ceiling lights
    // The neighbouring lanes copy the simulation's own lane (its width and pins), whatever its scale
    const alongX = size.x >= size.z;
    const across = alongX ? size.z : size.x, s = across / 7.2;
    const laneLen = (alongX ? size.x : size.z) + b.m(4), laneW = across * 0.82, pitch = across * 1.18;
    const maple = realMaterial('light-wood', { color: 0xf6e6c8, roughness: 0.14, size: [laneLen / upm, laneW / upm] });
    const gutter = realMaterial('brushed-steel', { color: 0x9aa0a6 });
    if (full) {
      // Carpet between the lanes, below the gutters
      b.floor(b.m(80), b.m(80), realMaterial('fabric', { color: 0x1d1b3a, size: 1 }), centre.x, top - 0.3 * s, centre.z);
      setFog(ctx, 0x0f0e1c, 1e6, 2e6);
      ctx.scene.background = new THREE.Color(0x0f0e1c);
      setSun(ctx, 0xf3f0ff, 1.7, [0.1, 1, 0.25]);
      ctx.ambient.color.set(0xd8d0ff);
      ctx.ambient.intensity = 0.18;
      b.add(new THREE.HemisphereLight(0xb8b0ff, 0x241e3c, 0.4));
    }
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;   // The simulation's own lane
      const off = k * pitch;
      const lx = alongX ? centre.x : centre.x + off, lz = alongX ? centre.z + off : centre.z;
      const lane = new THREE.Mesh(new THREE.BoxGeometry(alongX ? laneLen : laneW, 0.1 * s, alongX ? laneW : laneLen), maple);
      lane.position.set(lx, top - 0.03 * s, lz);
      lane.receiveShadow = true;
      b.add(lane);
      const gw = (pitch - laneW) / 2;
      [-1, 1].forEach(side => {
        const g = new THREE.Mesh(new THREE.BoxGeometry(alongX ? laneLen : gw * 0.9, 0.06 * s, alongX ? gw * 0.9 : laneLen), gutter);
        g.position.set(lx + (alongX ? 0 : side * (laneW + gw) / 2), top - 0.12 * s, lz + (alongX ? side * (laneW + gw) / 2 : 0));
        g.receiveShadow = true;
        b.add(g);
      });
    }
    update = bowlingNeighbours(b, { alongX, centre, top, s, pitch, halfAlong: (alongX ? size.x : size.z) / 2, lanes: [-2, -1, 1, 2] }, rand);
    // The masking wall above the pin decks, with one soft neon line
    const endX = alongX ? centre.x + laneLen / 2 + b.m(1.2) : centre.x, endZ = alongX ? centre.z : centre.z + laneLen / 2 + b.m(1.2);
    const span = pitch * 5 + b.m(2);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(alongX ? b.m(0.3) : span, b.m(2.2), alongX ? span : b.m(0.3)), painted(0x14122a, 0.7));
    wall.position.set(endX, top + b.m(1.9), endZ);
    b.add(wall);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(alongX ? b.m(0.05) : span, b.m(0.04), alongX ? span : b.m(0.04)), glowing(0x4fd2ff, 1.6));
    strip.position.set(endX - (alongX ? b.m(0.18) : 0), top + b.m(1.3), endZ - (alongX ? 0 : b.m(0.18)));
    b.add(strip);
    // Ceiling light panels high over each lane
    const panel = glowing(0xf4f2ff, 1.3);
    for (let k = -2; k <= 2; k++) {
      for (let j = -2; j <= 2; j++) {
        const along = j * laneLen * 0.2, sideways = k * pitch;
        const light = new THREE.Mesh(new THREE.BoxGeometry(alongX ? b.m(1.2) : b.m(0.3), b.m(0.04), alongX ? b.m(0.3) : b.m(1.2)), panel);
        light.position.set(centre.x + (alongX ? along : sideways), top + b.m(7), centre.z + (alongX ? sideways : along));
        b.add(light);
      }
    }
  }

  else if (spec.setting === 'warehouse') {
    // A warehouse: polished concrete, yellow safety lines, pallet racking with boxes, high-bay lights
    if (full) {
      b.floor(b.m(70), b.m(70), realMaterial('concrete', { size: 70, color: 0xc4c0b8, roughness: 0.55 }), centre.x, top, centre.z);
      ctx.scene.background = new THREE.Color(0x2b2d30);
      setFog(ctx, 0x2b2d30, b.m(30), b.m(70));
      setSun(ctx, 0xf2f5ff, 2.2, [0.25, 1, 0.35]);
      ctx.ambient.color.set(0xeef2ff);
      ctx.ambient.intensity = 0.25;
      b.add(new THREE.HemisphereLight(0xe8eeff, 0x5a5650, 0.5));
      // Walls of corrugated metal
      const halfX = b.m(24), halfZ = b.m(20), wallMat = realMaterial('brushed-steel', { color: 0x8a96a3, size: 3 });
      b.wall(halfX * 2, b.m(9), wallMat, centre.x, top, centre.z - halfZ, 'south');
      b.wall(halfZ * 2, b.m(9), wallMat, centre.x - halfX, top, centre.z, 'east');
      b.wall(halfZ * 2, b.m(9), wallMat, centre.x + halfX, top, centre.z, 'west');
      b.box(5, 4.5, 0.1, realMaterial('brushed-steel', { color: 0xb8b2a2, size: 1 }), centre.x + b.m(8), top, centre.z - halfZ + b.m(0.06));   // Roll-up door
      for (let i = -2; i <= 2; i++) b.cyl(0.35, 0.45, 0.25, glowing(0xf8f6ee, 2.2), centre.x + b.m(i * 6), top + b.m(8), centre.z - b.m(4), 20, { cast: false });
    }
    // Safety lines around the work area
    const lineMat = painted(0xe6b422, 0.6);
    const ax = hx + b.m(1.5), az = hz + b.m(1.5);
    b.box((ax * 2) / upm, 0.002, 0.1, lineMat, centre.x, top + b.m(0.002), centre.z - az, { cast: false });
    b.box((ax * 2) / upm, 0.002, 0.1, lineMat, centre.x, top + b.m(0.002), centre.z + az, { cast: false });
    b.box(0.1, 0.002, (az * 2) / upm, lineMat, centre.x - ax, top + b.m(0.002), centre.z, { cast: false });
    b.box(0.1, 0.002, (az * 2) / upm, lineMat, centre.x + ax, top + b.m(0.002), centre.z, { cast: false });
    // Pallet racking behind
    const uprightMat = realMaterial('painted-metal', { color: 0x2c5aa0 }), beamMat = realMaterial('painted-metal', { color: 0xe07a2a });
    const box = realMaterial('cardboard', { size: 0.8 }), pallet = realMaterial('light-wood', { size: 1.2 });
    for (let bay = -1; bay <= 1; bay++) {
      const rx = centre.x + b.m(bay * 2.8), rz = centre.z - az - b.m(5.5);
      [-1.35, 1.35].forEach(o => [-0.5, 0.5].forEach(d => b.box(0.08, 5.0, 0.08, uprightMat, rx + b.m(o), top, rz + b.m(d))));
      for (let lvl = 0; lvl < 3; lvl++) {
        const y = top + b.m(0.15 + lvl * 1.65);
        [-0.5, 0.5].forEach(d => b.box(2.7, 0.1, 0.06, beamMat, rx, y, rz + b.m(d)));
        [-0.65, 0.65].forEach(o => {
          if (rand() < 0.15) return;
          b.box(1.2, 0.14, 1.0, pallet, rx + b.m(o), y + b.m(0.1), rz);
          const stack = 1 + Math.floor(rand() * 2);
          for (let s = 0; s < stack; s++) b.box(1.0, 0.5, 0.8, box, rx + b.m(o), y + b.m(0.24 + s * 0.5), rz);
        });
      }
    }
    // A short stack of spare pallets behind the work area (clear of anything moving across it)
    b.box(1.2, 0.14, 1.0, pallet, centre.x + ax * 0.5, top, centre.z - az - b.m(1.6));
    b.box(1.2, 0.14, 1.0, pallet, centre.x + ax * 0.5, top + b.m(0.14), centre.z - az - b.m(1.55), { rotY: 0.1 });
  }

  else if (spec.setting === 'space') {
    // Deep space: a painted nebula and the band of the Milky Way far behind the scene (lighting unchanged)
    const W = 2048, H = 1024;
    const band = (x: number) => H / 2 + Math.sin(x / W * Math.PI * 2) * 90;   // The Milky Way's gentle S across the sky
    const nebula = canvasTexture(W, H, c => {
      c.fillStyle = '#010207'; c.fillRect(0, 0, W, H);
      const glow = (x: number, y: number, r: number, colour: string, alpha: number) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${colour},${alpha})`);
        g.addColorStop(1, `rgba(${colour},0)`);
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      };
      // The band's diffuse glow, then faint coloured nebulae scattered along it
      for (let i = 0; i < 160; i++) { const x = rand() * W; glow(x, band(x) + (rand() - 0.5) * 120, 80 + rand() * 140, '150,160,200', 0.035); }
      const tints = ['90,60,150', '50,90,160', '150,60,110', '40,120,130'];
      for (let i = 0; i < 26; i++) { const x = rand() * W; glow(x, band(x) + (rand() - 0.5) * 260, 60 + rand() * 160, tints[i % tints.length], 0.06 + rand() * 0.08); }
      // Dark dust lanes down the middle of the band
      for (let i = 0; i < 70; i++) { const x = rand() * W; glow(x, band(x) + (rand() - 0.5) * 30, 20 + rand() * 50, '0,0,0', 0.35); }
      // Stars: thick along the band, sparse elsewhere, a few bright ones
      for (let i = 0; i < 22000; i++) {
        const x = rand() * W, inBand = rand() < 0.7;
        const y = inBand ? band(x) + (rand() + rand() + rand() - 1.5) * 110 : rand() * H;
        c.fillStyle = `rgba(255,${225 + Math.floor(rand() * 30)},${205 + Math.floor(rand() * 50)},${0.1 + rand() * (inBand ? 0.45 : 0.6)})`;
        c.fillRect(x, y, 1, 1);
      }
      for (let i = 0; i < 160; i++) glow(rand() * W, rand() * H, 2 + rand() * 3, '255,250,240', 0.9);
    });
    nebula.anisotropy = 8;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(650, 64, 32), new THREE.MeshBasicMaterial({ map: nebula, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sphere.rotation.set(-0.65, 0, 0.3);   // Tilted so the band runs behind a scene seen from above and in front
    sphere.renderOrder = -10;
    sphere.raycast = () => {};
    (sphere as any).isLine2 = true;   // A backdrop: kept out of the ambient-occlusion pass
    b.add(sphere);
  }
  } catch (e) {
    restore(ctx, saved, b, textures);
    throw e;
  }

  saved.applied = readLights(ctx);
  let disposed = false;
  return {
    setting: spec.setting,
    ibl,
    update,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      restore(ctx, saved, b, textures);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------
// The other bowlers. The neighbouring lanes are really bowled: each has a ball and ten pins with real physics,
// in a small world of their own kept apart from the simulation's (so they can never touch its objects, its
// replay or its readings). A bowler throws, the pins fly, the pinsetter racks them again and the bowler throws
// again a few seconds later, each lane on its own rhythm. Measurements follow the simulation's own lane
// ('s' scales the demo's lane, pins and ball; they are the demo's numbers, which give a strike).

interface AlleyLayout {
  alongX: boolean;          // The lanes run along x (else along z), towards +
  centre: THREE.Vector3;
  top: number;              // Lane surface height
  s: number;                // Scale of the simulation's lane relative to the demo's
  pitch: number;            // Distance between lane centres
  halfAlong: number;        // Half the length of the simulation's set-up
  lanes: number[];          // Which neighbours (in lane widths, sideways)
}

function bowlingNeighbours(b: Builder, a: AlleyLayout, rand: () => number): (dt: number) => void {
  const { alongX, centre, top, s, pitch, halfAlong } = a;
  // Lane coordinates (along the lane, sideways, up) to world coordinates
  const place = (v: { set(x: number, y: number, z: number): unknown }, along: number, side: number, y: number) =>
    alongX ? v.set(centre.x + along, y, centre.z + side) : v.set(centre.x + side, y, centre.z + along);
  const halfBox = (along: number, up: number, side: number) => alongX ? new CANNON.Vec3(along, up, side) : new CANNON.Vec3(side, up, along);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20 * s, 0) });
  world.allowSleep = true;
  (world.solver as any).iterations = 30;
  const laneMat = new CANNON.Material(), ballMat = new CANNON.Material(), pinMat = new CANNON.Material();
  world.addContactMaterial(new CANNON.ContactMaterial(laneMat, ballMat, { friction: 0.3, restitution: 0.1 }));
  world.addContactMaterial(new CANNON.ContactMaterial(laneMat, pinMat, { friction: 0.4, restitution: 0.2 }));
  world.addContactMaterial(new CANNON.ContactMaterial(ballMat, pinMat, { friction: 0.2, restitution: 0.4 }));
  world.addContactMaterial(new CANNON.ContactMaterial(pinMat, pinMat, { friction: 0.3, restitution: 0.3 }));
  const ground = new CANNON.Body({ mass: 0, material: laneMat, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.position.set(0, top, 0);
  world.addBody(ground);
  const fixed = (he: CANNON.Vec3, along: number, side: number, y: number) => {
    const body = new CANNON.Body({ mass: 0, material: laneMat, shape: new CANNON.Box(he) });
    place(body.position, along, side, y);
    world.addBody(body);
  };

  // The demo's pin (lathe-turned, with a red band) and ball, at this lane's scale
  const R = 1.1 * s, PIN_H = 2.4 * s, RACK = 0.85;
  const profile = [[0, -1.2], [0.3, -1.2], [0.42, -0.7], [0.45, -0.3], [0.36, 0.15], [0.2, 0.5], [0.18, 0.65], [0.26, 0.9], [0.24, 1.08], [0.12, 1.19], [0, 1.2]];
  const pinGeo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * s, y * s)), 20);
  const bandGeo = new THREE.CylinderGeometry(0.2 * s, 0.215 * s, 0.16 * s, 20);
  const pinLook = b.mat('ceramic', { color: 0xf8f6f0 }), bandLook = b.mat('ceramic', { color: 0xd23c3c });
  const ballGeo = new THREE.SphereGeometry(R, 40, 28), stripeGeo = new THREE.TorusGeometry(R * 0.99, 0.06 * s, 10, 40);
  const ballColours = [0x1f4e9a, 0x8a1c3a, 0x1f6b4a, 0xb8641e];
  const pinSpots: [number, number][] = [];
  for (let row = 0; row < 4; row++) for (let p = 0; p <= row; p++)
    pinSpots.push([halfAlong - 11 * s + row * 1.35 * RACK * s, (p - row / 2) * 1.55 * RACK * s]);   // As in the demo
  const startAlong = -11 * s;

  type Lane = { off: number; ball: CANNON.Body; ballMesh: THREE.Object3D; pins: CANNON.Body[]; pinMeshes: THREE.Object3D[]; rolling: boolean; timer: number };
  const lanes: Lane[] = a.lanes.map((k, i) => {
    const off = k * pitch;
    // Side walls between the lanes keep each lane's pins and ball to itself; a padded backstop ends it
    [-1, 1].forEach(side => fixed(halfBox(halfAlong + 2 * s, 2 * s, 0.1 * s), 0, off + side * pitch / 2, top + 2 * s));
    fixed(halfBox(0.4 * s, 1.6 * s, pitch / 2), halfAlong - 0.4 * s, off, top + 1.6 * s);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(...(alongX ? [0.8 * s, 3.2 * s, pitch * 0.9] : [pitch * 0.9, 3.2 * s, 0.8 * s]) as [number, number, number]), painted(0x15132a, 0.9));
    place(pad.position, halfAlong - 0.4 * s, off, top + 1.6 * s);
    b.add(pad);

    const pins: CANNON.Body[] = [], pinMeshes: THREE.Object3D[] = [];
    pinSpots.forEach(() => {
      const body = new CANNON.Body({ mass: 1.2, material: pinMat, shape: new CANNON.Box(new CANNON.Vec3(0.3 * s, PIN_H / 2, 0.3 * s)), linearDamping: 0.1, angularDamping: 0.1 });
      body.sleepSpeedLimit = 0.2 * s;
      world.addBody(body);
      pins.push(body);
      const mesh = new THREE.Group();
      const shape = new THREE.Mesh(pinGeo, pinLook);
      shape.castShadow = true;
      const band = new THREE.Mesh(bandGeo, bandLook);
      band.position.y = 0.56 * s;
      mesh.add(shape, band);
      pinMeshes.push(b.add(mesh));
    });
    const ball = new CANNON.Body({ mass: 14, material: ballMat, shape: new CANNON.Sphere(R), linearDamping: 0.02, angularDamping: 0.02 });
    world.addBody(ball);
    const ballMesh = new THREE.Group();
    const sphere = new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({ color: ballColours[i % ballColours.length], roughness: 0.15, clearcoat: 0.8 }));
    sphere.castShadow = true;
    const stripe = new THREE.Mesh(stripeGeo, painted(0xf2efe6, 0.4));
    if (alongX) stripe.rotation.y = Math.PI / 2;
    ballMesh.add(sphere, stripe);
    b.add(ballMesh);
    // The first throws come just after the simulation's own, one lane after another
    return { off, ball, ballMesh, pins, pinMeshes, rolling: false, timer: 0.5 + i * 0.8 + rand() * 0.4 };
  });

  // The pinsetter: ten pins standing in the rack, and the ball back at the foul line
  const rack = (lane: Lane) => {
    lane.pins.forEach((pin, j) => {
      place(pin.position, pinSpots[j][0], lane.off + pinSpots[j][1], top + PIN_H / 2 + 0.05 * s);
      pin.quaternion.set(0, 0, 0, 1);
      pin.velocity.setZero();
      pin.angularVelocity.setZero();
      pin.wakeUp();
    });
    place(lane.ball.position, startAlong, lane.off + 0.3 * s, top + R + 0.05 * s);
    lane.ball.quaternion.set(0, 0, 0, 1);
    lane.ball.velocity.setZero();
    lane.ball.angularVelocity.setZero();
    lane.ball.wakeUp();
  };
  // A throw at the pocket, a little to one side or the other, rolling without slipping
  const bowl = (lane: Lane) => {
    const speed = (23.5 + rand()) * s, side = (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.15) * s;
    place(lane.ball.position, startAlong, lane.off + side, top + R + 0.05 * s);
    if (alongX) { lane.ball.velocity.set(speed, 0, 0); lane.ball.angularVelocity.set(0, 0, -speed / R); }
    else { lane.ball.velocity.set(0, 0, speed); lane.ball.angularVelocity.set(speed / R, 0, 0); }
    lane.ball.wakeUp();
  };
  const show = () => lanes.forEach(lane => {
    lane.ballMesh.position.copy(lane.ball.interpolatedPosition as any);
    lane.ballMesh.quaternion.copy(lane.ball.interpolatedQuaternion as any);
    lane.pins.forEach((pin, j) => {
      lane.pinMeshes[j].position.copy(pin.interpolatedPosition as any);
      lane.pinMeshes[j].quaternion.copy(pin.interpolatedQuaternion as any);
    });
  });
  lanes.forEach(rack);
  lanes.forEach(lane => { lane.ball.interpolatedPosition.copy(lane.ball.position); lane.pins.forEach(p => p.interpolatedPosition.copy(p.position)); });
  show();

  return (dt: number) => {
    if (!(dt > 0)) return;
    lanes.forEach(lane => {
      lane.timer -= dt;
      if (lane.timer > 0) return;
      if (!lane.rolling) { bowl(lane); lane.rolling = true; lane.timer = 6; }        // Throw, and let the pins settle
      else { rack(lane); lane.rolling = false; lane.timer = 2.5 + rand() * 5; }      // Pinsetter, then the next throw
    });
    world.step(1 / 60, Math.min(dt, 0.1), 6);
    show();
  };
}
