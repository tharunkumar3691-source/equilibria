// Realism kit for scene code (AI-generated scenes and the built-in demos): physically based materials
// with procedural textures, and ready-made ground surfaces with matching skies.
// Textures are drawn once and shared, so rebuilding a scene costs nothing and leaks nothing.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- Procedural textures -------------------------------------------------------------------------

type Draw = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => void;

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const shade = (hex: number, amount: number) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return '#' + c.getHexString();
};

// Many small dots of nearly the base colour: concrete, asphalt, sand, granite
const speckle = (base: number, spread: number, count: number, maxDot: number): Draw => (ctx, size, random) => {
  ctx.fillStyle = '#' + new THREE.Color(base).getHexString();
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = shade(base, (random() - 0.5) * spread);
    const r = random() * maxDot + 0.4;
    ctx.fillRect(random() * size, random() * size, r, r);
  }
};

// Soft blotches under a speckle: weathered concrete, dirt, snow
const blotchy = (base: number, spread: number, dots: number): Draw => (ctx, size, random) => {
  speckle(base, spread * 0.6, dots, 2.2)(ctx, size, random);
  for (let i = 0; i < 70; i++) {
    const x = random() * size, y = random() * size, r = 20 + random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, shade(base, (random() - 0.5) * spread) + '40');
    g.addColorStop(1, shade(base, 0) + '00');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
};

const woodGrain = (base: number, planks: number): Draw => (ctx, size, random) => {
  ctx.fillStyle = '#' + new THREE.Color(base).getHexString();
  ctx.fillRect(0, 0, size, size);
  const plankH = size / planks;
  for (let p = 0; p < planks; p++) {
    ctx.fillStyle = shade(base, (random() - 0.5) * 0.08);
    ctx.fillRect(0, p * plankH, size, plankH);
    // Grain: long, gently waving lines along the plank
    for (let i = 0; i < 26; i++) {
      const y0 = p * plankH + random() * plankH, amp = 1 + random() * 3, freq = 0.005 + random() * 0.02;
      ctx.strokeStyle = shade(base, -0.04 - random() * 0.1) + 'aa';
      ctx.lineWidth = 0.6 + random() * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) ctx.lineTo(x, y0 + Math.sin(x * freq + p * 7) * amp);
      ctx.stroke();
    }
    if (planks > 1) {
      ctx.fillStyle = shade(base, -0.22);
      ctx.fillRect(0, p * plankH, size, 2);
      ctx.fillRect(((p * 0.37) % 1) * size, p * plankH, 2, plankH); // Butt joint
    }
  }
};

const bricks: Draw = (ctx, size, random) => {
  ctx.fillStyle = '#b7b1a7'; // Mortar
  ctx.fillRect(0, 0, size, size);
  const rows = 8, cols = 4, h = size / rows, w = size / cols, gap = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c <= cols; c++) {
      const x = c * w + (r % 2) * w / 2;
      ctx.fillStyle = shade(0x8a4630, (random() - 0.5) * 0.12);
      ctx.fillRect(x + gap / 2, r * h + gap / 2, w - gap, h - gap);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = shade(0x8a4630, (random() - 0.5) * 0.2) + '80';
        ctx.fillRect(x + gap / 2 + random() * (w - gap), r * h + gap / 2 + random() * (h - gap), 2, 2);
      }
    }
  }
};

const tiles = (base: number, n: number, grout: number): Draw => (ctx, size, random) => {
  ctx.fillStyle = '#' + new THREE.Color(grout).getHexString();
  ctx.fillRect(0, 0, size, size);
  const t = size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    ctx.fillStyle = shade(base, (random() - 0.5) * 0.05);
    ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
  }
};

const grass: Draw = (ctx, size, random) => {
  ctx.fillStyle = '#2c4720';   // Lawn is darker and less saturated than it seems
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const x = random() * size, y = random() * size, len = 3 + random() * 7;
    ctx.strokeStyle = shade(random() < 0.15 ? 0x5a5a32 : 0x3a5c2a, (random() - 0.5) * 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 3, y - len);
    ctx.stroke();
  }
};

const marble: Draw = (ctx, size, random) => {
  ctx.fillStyle = '#eceae6';
  ctx.fillRect(0, 0, size, size);
  for (let v = 0; v < 14; v++) {
    let x = random() * size, y = random() * size;
    ctx.strokeStyle = `rgba(110,110,120,${0.15 + random() * 0.3})`;
    ctx.lineWidth = 0.5 + random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 60; s++) {
      x += (random() - 0.3) * 14; y += (random() - 0.5) * 14;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
};

const brushed: Draw = (ctx, size, random) => {
  ctx.fillStyle = '#c9cdd2';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    ctx.strokeStyle = `rgba(${random() > 0.5 ? '255,255,255' : '60,64,70'},${0.05 + random() * 0.12})`;
    ctx.lineWidth = 0.6;
    const y = random() * size, x = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 40 + random() * 160, y);
    ctx.stroke();
  }
};

const ice: Draw = (ctx, size, random) => {
  ctx.fillStyle = '#e8f1f8';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(160,190,215,${0.08 + random() * 0.18})`;
    ctx.lineWidth = 0.5 + random();
    const x = random() * size, y = random() * size, a = random() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 60, y + Math.sin(a) * 60);
    ctx.stroke();
  }
};

const fabric = (base: number): Draw => (ctx, size, random) => {
  ctx.fillStyle = '#' + new THREE.Color(base).getHexString();
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 3) {
    ctx.fillStyle = shade(base, -0.05) + '90';
    ctx.fillRect(0, i, size, 1);
    ctx.fillStyle = shade(base, 0.04) + '70';
    ctx.fillRect(i, 0, 1, size);
  }
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = shade(base, (random() - 0.5) * 0.1) + '60';
    ctx.fillRect(random() * size, random() * size, 2, 2);
  }
};

const basketball: Draw = (ctx, size, random) => {
  speckle(0xc8571b, 0.1, 30000, 1.6)(ctx, size, random);
  ctx.strokeStyle = '#1c1410';
  ctx.lineWidth = size * 0.012;
  [0, 0.25, 0.5, 0.75, 1].forEach(u => { ctx.beginPath(); ctx.moveTo(u * size, 0); ctx.lineTo(u * size, size); ctx.stroke(); });
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
};

const cardboard: Draw = (ctx, size, random) => {
  speckle(0xb48a5a, 0.08, 6000, 1.4)(ctx, size, random);
  for (let y = 0; y < size; y += 12) {
    ctx.fillStyle = 'rgba(80,55,30,0.06)';
    ctx.fillRect(0, y, size, 5);
  }
};

const textureCache = new Map<string, THREE.CanvasTexture>();

// A colour texture drawn once per name (and once more per repeat), shared by every material that uses it
function texture(name: string, draw: Draw, repeat: [number, number], colour = true): THREE.CanvasTexture {
  const baseKey = name + (colour ? '' : ':data');
  let base = textureCache.get(baseKey);
  if (!base) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, 512, seeded(name.length * 7919 + name.charCodeAt(0)));
    base = new THREE.CanvasTexture(canvas);
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.anisotropy = 8;
    if (colour) base.colorSpace = THREE.SRGBColorSpace;
    base.userData.shared = true;
    textureCache.set(baseKey, base);
  }
  const key = `${baseKey}@${repeat[0].toFixed(2)},${repeat[1].toFixed(2)}`;
  let tex = textureCache.get(key);
  if (!tex) {
    tex = base.clone();
    tex.repeat.set(repeat[0], repeat[1]);
    tex.userData.shared = true;
    textureCache.set(key, tex);
  }
  return tex;
}

// --- Materials -----------------------------------------------------------------------------------

interface MaterialSpec {
  color: number;
  metalness: number;
  roughness: number;
  draw?: Draw;        // Procedural colour texture
  bump?: number;      // Uses the texture as a bump map too, at this strength
  period?: number;    // Metres the texture spans before it repeats
  physical?: Partial<THREE.MeshPhysicalMaterialParameters>;
  note: string;       // For the AI's guide
}

const MATERIALS: Record<string, MaterialSpec> = {
  // Metals
  'steel':          { color: 0xc4c8cc, metalness: 1, roughness: 0.32, note: 'machined steel, bearings, wrecking balls' },
  'polished-steel': { color: 0xe8eaec, metalness: 1, roughness: 0.08, note: 'mirror-like: Newton\'s cradle balls, chrome' },
  'brushed-steel':  { color: 0xffffff, metalness: 1, roughness: 0.38, draw: brushed, period: 0.6, note: 'appliances, panels, rails' },
  'iron':           { color: 0x5b5d61, metalness: 0.85, roughness: 0.6, note: 'cast iron: weights, anvils, cannonballs, chains' },
  'aluminium':      { color: 0xd8dadd, metalness: 1, roughness: 0.28, note: 'frames, cans, ladders' },
  'copper':         { color: 0xd8916a, metalness: 1, roughness: 0.3, note: 'pipes, wire, coins' },
  'brass':          { color: 0xd6b25a, metalness: 1, roughness: 0.28, note: 'weights, instruments, pendulum bobs' },
  'gold':           { color: 0xf3c662, metalness: 1, roughness: 0.18, note: 'gold' },
  'painted-metal':  { color: 0x2563eb, metalness: 0.35, roughness: 0.45, physical: { clearcoat: 0.6, clearcoatRoughness: 0.25 }, note: 'car bodies, machinery, playground frames (pass color)' },
  // Wood
  'wood':           { color: 0xa47448, metalness: 0, roughness: 0.62, draw: woodGrain(0xa47448, 1), bump: 0.4, period: 1.2, note: 'oak: ramps, crates, tables, pins, dominoes' },
  'light-wood':     { color: 0xd8b98a, metalness: 0, roughness: 0.6, draw: woodGrain(0xd8b98a, 1), bump: 0.4, period: 1.2, note: 'pine or birch: blocks, rulers, shelves' },
  'dark-wood':      { color: 0x5c3a21, metalness: 0, roughness: 0.55, draw: woodGrain(0x5c3a21, 1), bump: 0.4, period: 1.2, note: 'walnut: furniture, handles' },
  'wood-floor':     { color: 0xb07f4f, metalness: 0, roughness: 0.42, draw: woodGrain(0xb07f4f, 6), bump: 0.3, period: 2.4, note: 'varnished floorboards, gym floors, bowling lanes' },
  // Masonry and stone
  'brick':          { color: 0xffffff, metalness: 0, roughness: 0.9, draw: bricks, bump: -1, period: 0.6, note: 'brick walls' },  // Negative: the light mortar sits lower
  'concrete':       { color: 0xffffff, metalness: 0, roughness: 0.92, draw: blotchy(0x9a9893, 0.18, 26000), bump: 0.5, period: 3, note: 'floors, walls, blocks, ramps' },
  'asphalt':        { color: 0xffffff, metalness: 0, roughness: 0.95, draw: speckle(0x3b3b3d, 0.25, 60000, 1.6), bump: 0.6, period: 2, note: 'roads, car parks' },
  'stone':          { color: 0xffffff, metalness: 0, roughness: 0.85, draw: speckle(0x8a8580, 0.3, 50000, 2.2), bump: 0.7, period: 1, note: 'granite: boulders, statues, stone blocks' },
  'marble':         { color: 0xffffff, metalness: 0, roughness: 0.15, draw: marble, period: 1.5, note: 'polished marble: plinths, floors, counters' },
  'tiles':          { color: 0xffffff, metalness: 0, roughness: 0.25, draw: tiles(0xe9e6df, 4, 0x9c968c), bump: 0.4, period: 1.2, note: 'ceramic floor or wall tiles' },
  // Ground
  'grass':          { color: 0xffffff, metalness: 0, roughness: 1, draw: grass, bump: 0.5, period: 2, note: 'lawn, playing fields' },
  'sand':           { color: 0xffffff, metalness: 0, roughness: 0.95, draw: speckle(0xd9c49a, 0.18, 70000, 1.3), bump: 0.4, period: 1.5, note: 'beach, long-jump pit' },
  'dirt':           { color: 0xffffff, metalness: 0, roughness: 1, draw: blotchy(0x6b5139, 0.25, 40000), bump: 0.6, period: 2, note: 'soil, tracks, construction sites' },
  'snow':           { color: 0xffffff, metalness: 0, roughness: 0.9, draw: blotchy(0xf4f7fb, 0.06, 20000), bump: 0.3, period: 3, note: 'snow' },
  'ice':            { color: 0xffffff, metalness: 0, roughness: 0.1, draw: ice, period: 3, note: 'ice rinks, frozen ponds' },
  // Everyday materials
  'rubber':         { color: 0x1d1d1f, metalness: 0, roughness: 0.88, note: 'tyres, mats, bumpers (pass color for coloured rubber)' },
  'plastic':        { color: 0xe11d48, metalness: 0, roughness: 0.35, physical: { clearcoat: 0.3 }, note: 'toys, crates, cones, helmets (pass color)' },
  'glass':          { color: 0xffffff, metalness: 0, roughness: 0.03, physical: { transmission: 1, thickness: 0.05, ior: 1.5 }, note: 'windows, bottles, marbles, beakers' },
  'water':          { color: 0x6fa8c8, metalness: 0, roughness: 0.05, physical: { transmission: 0.85, thickness: 1, ior: 1.33 }, note: 'water in tanks, pools, glasses' },
  'fabric':         { color: 0x334155, metalness: 0, roughness: 1, draw: fabric(0xffffff), period: 0.3, physical: { sheen: 0.6, sheenRoughness: 0.8 }, note: 'cloth, cushions, sofas, sails (pass color)' },
  'leather':        { color: 0x6b3f22, metalness: 0, roughness: 0.55, note: 'footballs, gloves, seats' },
  'felt':           { color: 0x0f6b3a, metalness: 0, roughness: 1, physical: { sheen: 0.5 }, note: 'billiard tables, tennis balls (pass color 0xcde04a)' },
  'cardboard':      { color: 0xffffff, metalness: 0, roughness: 0.9, draw: cardboard, period: 0.8, note: 'boxes, packaging' },
  'ceramic':        { color: 0xf5f5f0, metalness: 0, roughness: 0.15, physical: { clearcoat: 0.8 }, note: 'mugs, plates, vases' },
  'basketball':     { color: 0xffffff, metalness: 0, roughness: 0.75, draw: basketball, bump: 0.3, period: 1, note: 'a basketball (use on a SphereGeometry)' },
  'glow':           { color: 0xfff1c1, metalness: 0, roughness: 0.5, note: 'light sources, screens, lamps (pass color; it glows)' }
};

export const MATERIAL_NAMES = Object.keys(MATERIALS);

export interface RealMaterialOptions {
  color?: number | string;            // Tint (multiplies the texture, if the material has one)
  size?: number | [number, number];   // Metres the surface spans, so textures come out at their real scale
  roughness?: number;
  metalness?: number;
  opacity?: number;
}

export function realMaterial(name: string, options: RealMaterialOptions = {}): THREE.MeshStandardMaterial {
  const spec = MATERIALS[name] || MATERIALS['plastic'];
  if (!MATERIALS[name]) console.warn(`[Scene kit] realMaterial: unknown material '${name}'. Known: ${MATERIAL_NAMES.join(', ')}`);
  const params: THREE.MeshPhysicalMaterialParameters = {
    color: options.color !== undefined ? new THREE.Color(options.color as any) : new THREE.Color(spec.color),
    metalness: options.metalness ?? spec.metalness,
    roughness: options.roughness ?? spec.roughness,
    ...(spec.physical || {})
  };
  if (spec.draw) {
    const size = options.size ?? 1;
    const [w, h] = Array.isArray(size) ? size : [size, size];
    const period = spec.period || 1;
    const repeat: [number, number] = [Math.max(0.05, Math.abs(w) / period), Math.max(0.05, Math.abs(h) / period)];
    params.map = texture(name, spec.draw, repeat);
    if (spec.bump) {
      params.bumpMap = texture(name, spec.draw, repeat, false);
      params.bumpScale = spec.bump;
    }
  }
  if (name === 'glow') {
    params.emissive = (params.color as THREE.Color).clone();
    params.emissiveIntensity = 1.5;
  }
  if (options.opacity !== undefined && options.opacity < 1) {
    params.transparent = true;
    params.opacity = options.opacity;
  }
  const physical = !!spec.physical;
  const material = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  material.name = name;
  return material;
}

// --- Grounds and skies ---------------------------------------------------------------------------

interface GroundSpec {
  material: string;
  sky: [string, string];   // Backdrop gradient, top to horizon
  fog: string;
  outdoor: boolean;
  friction: number;        // Typical friction against everyday objects (shoes, wood, rubber)
  restitution: number;
}

const GROUNDS: Record<string, GroundSpec> = {
  grass:    { material: 'grass', sky: ['#4f8fd6', '#cfe3f3'], fog: '#cfe3f3', outdoor: true, friction: 0.55, restitution: 0.3 },
  dirt:     { material: 'dirt', sky: ['#5d93cf', '#dcd6c8'], fog: '#dcd6c8', outdoor: true, friction: 0.6, restitution: 0.15 },
  sand:     { material: 'sand', sky: ['#3f8be0', '#e8eef2'], fog: '#e8eef2', outdoor: true, friction: 0.6, restitution: 0.05 },
  snow:     { material: 'snow', sky: ['#8fb1d6', '#eef2f6'], fog: '#eef2f6', outdoor: true, friction: 0.2, restitution: 0.05 },
  asphalt:  { material: 'asphalt', sky: ['#5b8fc9', '#d6dde4'], fog: '#d6dde4', outdoor: true, friction: 0.7, restitution: 0.25 },
  ice:      { material: 'ice', sky: ['#1e293b', '#475569'], fog: '#475569', outdoor: false, friction: 0.03, restitution: 0.1 },
  concrete: { material: 'concrete', sky: ['#1f2328', '#4b4f55'], fog: '#4b4f55', outdoor: false, friction: 0.6, restitution: 0.3 },
  wood:     { material: 'wood-floor', sky: ['#2a2420', '#5a4c40'], fog: '#5a4c40', outdoor: false, friction: 0.45, restitution: 0.4 },
  tiles:    { material: 'tiles', sky: ['#2b2f33', '#5d6268'], fog: '#5d6268', outdoor: false, friction: 0.4, restitution: 0.35 },
  lab:      { material: 'concrete', sky: ['#1b2230', '#3f4a5c'], fog: '#3f4a5c', outdoor: false, friction: 0.5, restitution: 0.3 }
};

export const GROUND_NAMES = Object.keys(GROUNDS);

const skyCache = new Map<string, THREE.CanvasTexture>();
function skyTexture(top: string, horizon: string): THREE.CanvasTexture {
  const key = top + horizon;
  let tex = skyCache.get(key);
  if (!tex) {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top);
    g.addColorStop(0.75, horizon);
    g.addColorStop(1, horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.shared = true;
    skyCache.set(key, tex);
  }
  return tex;
}

const GROUND_HALF = 40; // An 80 x 80 m ground: its edge is lost in the haze

export interface Ground {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  material: CANNON.Material;  // Use in CANNON.ContactMaterial pairs with your objects
}

// The scene's ground with its top at y = 0, plus a matching sky, haze and (outdoors) daylight.
// 'scene' should be the tracked scene proxy, so everything added here is removed on rebuild.
export function addGround(scene: THREE.Scene, world: CANNON.World, kind: string): Ground {
  const spec = GROUNDS[kind] || GROUNDS.lab;
  if (!GROUNDS[kind]) console.warn(`[Scene kit] addGround: unknown ground '${kind}'. Known: ${GROUND_NAMES.join(', ')}`);

  const material = new CANNON.Material('ground');
  const body = new CANNON.Body({ mass: 0, material, shape: new CANNON.Box(new CANNON.Vec3(GROUND_HALF, 1, GROUND_HALF)) });
  body.position.set(0, -1, 0);
  world.addBody(body);
  // Everyday objects meet this ground with its typical friction and bounce unless the scene says otherwise
  world.defaultContactMaterial.friction = spec.friction;
  world.defaultContactMaterial.restitution = spec.restitution;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(GROUND_HALF * 2, 2, GROUND_HALF * 2),
    realMaterial(spec.material, { size: GROUND_HALF * 2 })
  );
  mesh.position.set(0, -1, 0);
  mesh.receiveShadow = true;
  scene.add(mesh);

  scene.background = skyTexture(spec.sky[0], spec.sky[1]);
  const fog = scene.fog as THREE.Fog | null;
  if (fog) {
    fog.color.set(spec.fog);
    fog.near = spec.outdoor ? 35 : 30;
    fog.far = spec.outdoor ? 110 : 90;
  }
  if (spec.outdoor) {
    // Daylight: blue sky above, light bounced off the ground below
    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.35));
  }
  return { body, mesh, material };
}

// The guide text the AI reads: every material and ground with what it is for
export const SCENE_KIT_MATERIALS_DOC = Object.entries(MATERIALS).map(([name, s]) => `'${name}' (${s.note})`).join(', ');
export const SCENE_KIT_GROUNDS_DOC = GROUND_NAMES.map(n => `'${n}'`).join(', ');
