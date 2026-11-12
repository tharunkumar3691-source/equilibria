// Backdrops: a painted sky all the way round, with fog and lighting to match, swapped in under any scene.
// 'original' is whatever the scene itself set up (used when someone picks a plain background colour);
// the backdrops replace only the sky and the lights, never the scene's own objects.
import * as THREE from 'three';

export type BackdropId = 'space' | 'nebula' | 'aurora' | 'sunset' | 'eclipse' | 'galaxy';
export type ThemeId = 'original' | BackdropId;

// The look every scene opens with, generated ones included
export const DEFAULT_SCENE_THEME: ThemeId = 'space';

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

interface ThemeSpec {
  label: string;
  blurb: string;                  // One line for the picker
  swatch: string;                 // CSS background for the picker tile
  fog: string;
  ambient: [string, number];
  sun: [string, number];
  hemisphere?: [string, string, number];
  stars: number;                  // Crisp stars drawn over the painted sky
  starsFrom?: number;             // Lowest height for those stars (-1 below the horizon .. 1 overhead)
  tint: [string, string];         // Sky and horizon colours for the reflections on shiny objects
  paint: (c: Ctx, rand: Rand) => void;
}

// ---------------------------------------------------------------------------------------------------------
// Painting the skies. Each is an equirectangular picture (longitude across, latitude down) wrapped round
// the scene. The main feature sits a quarter of the way across and a little below the true horizon: scenes are
// seen from above, so that strip is the sky that shows past the floor. The sky is then turned so the feature
// stands just to the right of where the camera looks (see aim).

const W = 2048, H = 1024;
const AHEAD = W * 0.25, BEHIND = W * 0.75;

const seeded = (seed: number): Rand => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const gauss = (rand: Rand) => (rand() + rand() + rand() + rand() - 2) / 2;  // Roughly -1..1, most near 0

function rgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function skyGradient(c: Ctx, stops: [number, string][]) {
  const g = c.createLinearGradient(0, 0, 0, H);
  stops.forEach(([at, colour]) => g.addColorStop(at, colour));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

// Pictures near the top and bottom are spread wider round the sky; this widens a shape drawn at height y so
// it comes out round
const widen = (y: number) => 1 / Math.max(0.2, Math.cos((0.5 - y / H) * Math.PI));

// A soft round glow at (x, y) on the sky, repeated across the seam so it wraps round
function glow(c: Ctx, x: number, y: number, r: number, colour: string, alpha: number, flat = 1) {
  const sx = widen(y);
  for (const dx of [-W, 0, W]) {
    const cx = x + dx;
    if (cx + r * sx < 0 || cx - r * sx > W) continue;
    c.save();
    c.translate(cx, y);
    c.scale(sx, flat);
    spot(c, 0, 0, r, colour, alpha);
    c.restore();
  }
}

// A soft round glow in whatever coordinates are current
function spot(c: Ctx, x: number, y: number, r: number, colour: string, alpha: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(colour, alpha));
  g.addColorStop(0.45, rgba(colour, alpha * 0.45));
  g.addColorStop(1, rgba(colour, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

// Draws a feature (a galaxy, an eclipse) centred at (x, y) in its own undistorted coordinates
function feature(c: Ctx, x: number, y: number, draw: () => void) {
  c.save();
  c.translate(x, y);
  c.scale(widen(y), 1);
  draw();
  c.restore();
}

// Faint star dust spread evenly over the sphere; 'near' gathers it round a height curve instead
function dust(c: Ctx, rand: Rand, count: number, bright: number, near?: (x: number) => number, spread = 60) {
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const y = near ? near(x) + gauss(rand) * spread : H * (0.5 - Math.asin(rand() * 2 - 1) / Math.PI);
    const a = bright * (0.25 + rand() * 0.75);
    c.fillStyle = rand() < 0.15 ? rgba('#ffd9b0', a) : rand() < 0.3 ? rgba('#b9c8ff', a) : rgba('#ffffff', a);
    const s = rand() < 0.04 ? 1.6 : 1;
    c.fillRect(x, y, s, s);
  }
}

function paintSpace(c: Ctx, rand: Rand) {
  skyGradient(c, [[0, '#010104'], [0.45, '#04050d'], [0.53, '#080a18'], [0.59, '#03040a'], [1, '#010103']]);
  // The Milky Way: a broad, faint, clumpy band of starlight, warmest round the galaxy's core, split by dark rifts
  const band = (x: number) => H * (0.525 - 0.035 * Math.sin((x / W) * Math.PI * 2 + 0.9));
  c.globalCompositeOperation = 'lighter';
  for (let x = 0; x < W; x += 20) glow(c, x, band(x), 150, '#3d4c8a', 0.035, 0.55);
  for (let i = 0; i < 1800; i++) {
    const x = rand() * W, y = band(x) + gauss(rand) * 70;
    glow(c, x, y, 8 + rand() * 34, rand() < 0.65 ? '#9fb0ec' : '#f0d2b0', 0.01 + rand() * 0.018);
  }
  glow(c, AHEAD, band(AHEAD), 260, '#ffc68a', 0.07, 0.5);
  glow(c, AHEAD, band(AHEAD), 110, '#ffe2bd', 0.1, 0.55);
  // A couple of faint coloured nebulae elsewhere in the sky
  glow(c, BEHIND, H * 0.5, 170, '#7c3aed', 0.05, 0.7);
  glow(c, BEHIND + 90, H * 0.52, 90, '#ec4899', 0.045, 0.8);
  c.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 280; i++) {
    const x = rand() * W, y = band(x) + gauss(rand) * 16 + Math.sin(x * 0.012) * 12;
    glow(c, x, y, 8 + rand() * 28, '#010104', 0.16, 0.45);
  }
  dust(c, rand, 15000, 0.7, band, 62);
  dust(c, rand, 9000, 0.6);
}

function paintNebula(c: Ctx, rand: Rand) {
  skyGradient(c, [[0, '#05020f'], [0.43, '#0d0520'], [0.53, '#170a2c'], [0.61, '#08031a'], [1, '#030109']]);
  // A cloud of glowing gas built from hundreds of faint, stretched wisps, with dark dust lanes across it
  const cloud = (cx: number, cy: number, size: number, palette: string[]) => {
    c.globalCompositeOperation = 'lighter';
    glow(c, cx, cy, size * 2.2, palette[0], 0.07, 0.6);
    glow(c, cx + size * 0.6, cy - size * 0.1, size * 1.3, palette[2], 0.05, 0.7);
    for (let i = 0; i < 620; i++) {
      const x = cx + gauss(rand) * size * 2.4, y = cy + gauss(rand) * size * 1.0;
      c.save();
      c.translate(x, y);
      c.scale(widen(y), 1);
      c.rotate(rand() * Math.PI);
      c.scale(1, 0.2 + rand() * 0.35);
      spot(c, 0, 0, 30 + rand() * size * 0.6, palette[Math.floor(rand() * palette.length)], 0.02 + rand() * 0.026);
      c.restore();
    }
    c.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 80; i++) {
      const x = cx + gauss(rand) * size * 1.8, y = cy + gauss(rand) * size * 0.7;
      c.save();
      c.translate(x, y);
      c.rotate(rand() * Math.PI);
      c.scale(1, 0.18 + rand() * 0.2);
      spot(c, 0, 0, 14 + rand() * 46, '#06020f', 0.28);
      c.restore();
    }
    c.globalCompositeOperation = 'lighter';
    glow(c, cx, cy, size * 0.2, '#ffd0f4', 0.14);
    dust(c, rand, 2200, 0.6, () => cy, size * 0.9);
    // A few bright young stars inside it
    for (let i = 0; i < 14; i++) glow(c, cx + gauss(rand) * size * 1.6, cy + gauss(rand) * size * 0.6, 5 + rand() * 6, '#ffffff', 0.85);
    c.globalCompositeOperation = 'source-over';
  };
  cloud(AHEAD, H * 0.53, 300, ['#c026d3', '#d946ef', '#a855f7', '#7c3aed', '#ec4899', '#3b82f6', '#22d3ee']);
  cloud(BEHIND, H * 0.52, 220, ['#4f46e5', '#3b82f6', '#06b6d4', '#a855f7', '#f472b6']);
  dust(c, rand, 7000, 0.6);
}

function paintAurora(c: Ctx, rand: Rand) {
  skyGradient(c, [[0, '#01030c'], [0.33, '#030a1d'], [0.475, '#06203a'], [0.535, '#0b3446'], [0.575, '#04111c'], [1, '#01050a']]);
  dust(c, rand, 7000, 0.6);
  // Curtains of light: thousands of thin vertical streaks, green at the foot fading to violet at the top
  c.globalCompositeOperation = 'lighter';
  const ribbons = [
    { base: 0.565, height: 0.2, phase: 0.4, strength: 0.6 },
    { base: 0.525, height: 0.15, phase: 2.1, strength: 0.42 },
    { base: 0.595, height: 0.11, phase: 4.3, strength: 0.35 }
  ];
  for (const r of ribbons) {
    for (let x = 0; x < W; x += 1.5) {
      const t = (x / W) * Math.PI * 2;
      const foot = H * (r.base + 0.03 * Math.sin(t * 3 + r.phase) + 0.012 * Math.sin(t * 8 + r.phase * 2));
      const reach = H * r.height * (0.55 + 0.45 * Math.sin(t * 5 + r.phase * 3) ** 2);
      const shimmer = 0.35 + 0.65 * Math.abs(Math.sin(x * 0.045 + r.phase) * Math.sin(x * 0.011 + r.phase * 1.7));
      const a = r.strength * shimmer;
      const g = c.createLinearGradient(0, foot, 0, foot - reach);
      g.addColorStop(0, rgba('#5bffb4', 0));
      g.addColorStop(0.06, rgba('#5bffb4', a));
      g.addColorStop(0.35, rgba('#2dd4bf', a * 0.45));
      g.addColorStop(0.7, rgba('#a855f7', a * 0.18));
      g.addColorStop(1, rgba('#a855f7', 0));
      c.fillStyle = g;
      c.fillRect(x, foot - reach, 1.5, reach);
    }
  }
  // Their glow on the haze along the horizon
  for (let x = 0; x < W; x += 60) glow(c, x, H * 0.585, 120, '#14b88a', 0.07, 0.4);
  c.globalCompositeOperation = 'source-over';
}

function paintSunset(c: Ctx, rand: Rand) {
  skyGradient(c, [[0, '#070a26'], [0.25, '#1a1550'], [0.375, '#4a2178'], [0.455, '#a23d7d'], [0.505, '#f2784e'],
    [0.535, '#ffbe73'], [0.55, '#f08a55'], [0.595, '#4a2340'], [0.73, '#1d0f22'], [1, '#0b0610']]);
  dust(c, rand, 2500, 0.45, () => H * 0.12, 90);
  // The sun on the horizon, with a wide warm glow
  c.globalCompositeOperation = 'lighter';
  glow(c, AHEAD, H * 0.535, 520, '#ff6a3d', 0.25, 0.55);
  glow(c, AHEAD, H * 0.53, 220, '#ffb36b', 0.45, 0.8);
  glow(c, AHEAD, H * 0.525, 70, '#fff1c9', 0.9);
  glow(c, BEHIND, H * 0.535, 600, '#c4457a', 0.12, 0.4);   // The afterglow behind
  c.globalCompositeOperation = 'source-over';
  glow(c, AHEAD, H * 0.523, 22, '#fff8e6', 1);
  // Long thin clouds, lit pink and gold from below
  for (let i = 0; i < 90; i++) {
    const x = rand() * W, y = H * (0.395 + rand() * 0.11);
    const near = 1 - Math.min(1, Math.abs(((x - AHEAD + W * 1.5) % W) - W / 2) / (W * 0.35));
    const colour = y > H * 0.475 ? (rand() < 0.5 ? '#ff9a6b' : '#ffc38a') : (rand() < 0.5 ? '#e0668e' : '#5a2a6a');
    glow(c, x, y, 90 + rand() * 220, colour, 0.18 + 0.3 * near, 0.07 + rand() * 0.05);
  }
}

function paintEclipse(c: Ctx, rand: Rand) {
  skyGradient(c, [[0, '#000002'], [0.41, '#02030a'], [0.51, '#071026'], [0.535, '#0d1a38'], [0.565, '#03050d'], [1, '#000001']]);
  dust(c, rand, 8000, 0.55);
  feature(c, AHEAD, H * 0.548, () => {
    c.scale(0.62, 0.62);
    c.globalCompositeOperation = 'lighter';
    spot(c, 0, 0, 300, '#5b8cff', 0.12);
    spot(c, 0, 0, 140, '#cfe2ff', 0.3);
    spot(c, 0, 0, 80, '#fff4dc', 0.75);
    // Streamers of the corona
    for (let i = 0; i < 36; i++) {
      const angle = rand() * Math.PI * 2, length = 70 + rand() * 170;
      c.save();
      c.rotate(angle);
      c.scale(1, 0.06 + rand() * 0.05);
      spot(c, length * 0.5, 0, length * 0.6, rand() < 0.5 ? '#dbe9ff' : '#fff1d6', 0.12 + rand() * 0.1);
      c.restore();
    }
    c.globalCompositeOperation = 'source-over';
    // The moon's disc, with a bright rim
    c.fillStyle = '#000000';
    c.beginPath(); c.arc(0, 0, 44, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,248,230,0.95)';
    c.lineWidth = 2;
    c.shadowColor = '#fff4dc'; c.shadowBlur = 14;
    c.beginPath(); c.arc(0, 0, 44, 0, Math.PI * 2); c.stroke();
    c.shadowBlur = 0;
    // The diamond ring: the last bead of sunlight, with its flare
    const bx = Math.cos(-0.75) * 44, by = Math.sin(-0.75) * 44;
    c.globalCompositeOperation = 'lighter';
    spot(c, bx, by, 34, '#ffffff', 1);
    spot(c, bx, by, 12, '#ffffff', 1);
    c.save(); c.translate(bx, by); c.scale(1, 0.025); spot(c, 0, 0, 150, '#ffffff', 0.6); c.restore();
    c.save(); c.translate(bx, by); c.scale(0.025, 1); spot(c, 0, 0, 90, '#ffffff', 0.45); c.restore();
    c.globalCompositeOperation = 'source-over';
  });
}

function paintGalaxy(c: Ctx, rand: Rand) {
  skyGradient(c, [[0, '#010008'], [0.43, '#04031a'], [0.53, '#0a0d2c'], [0.58, '#030312'], [1, '#010006']]);
  dust(c, rand, 7000, 0.55);
  const spiral = (x: number, y: number, size: number, tilt: number, flat: number) => feature(c, x, y, () => {
    c.rotate(tilt);
    c.scale(1, flat);
    c.globalCompositeOperation = 'lighter';
    spot(c, 0, 0, size * 1.1, '#6d7fd8', 0.1);
    // Two arms winding out from the core: gold near the middle, blue further out, pink star-forming knots
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 520; i++) {
        const t = i / 520, angle = t * Math.PI * 3.4 + arm * Math.PI;
        const r = size * (0.08 + 0.92 * t), jitter = size * 0.05 * (1 + t);
        const px = Math.cos(angle) * r + gauss(rand) * jitter, py = Math.sin(angle) * r + gauss(rand) * jitter;
        const colour = t < 0.3 ? '#ffd9a8' : rand() < 0.08 ? '#ff7ac0' : t < 0.55 ? '#d8dcff' : '#8fb4ff';
        spot(c, px, py, size * (0.04 + 0.07 * (1 - t)), colour, 0.11 * (1 - t * 0.55));
      }
    }
    // Dust lanes along the inside of each arm
    c.globalCompositeOperation = 'source-over';
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 90; i++) {
        const t = 0.15 + (i / 90) * 0.7, angle = t * Math.PI * 3.4 + arm * Math.PI - 0.25;
        const r = size * (0.08 + 0.92 * t);
        spot(c, Math.cos(angle) * r, Math.sin(angle) * r, size * 0.035, '#03020c', 0.25);
      }
    }
    c.globalCompositeOperation = 'lighter';
    spot(c, 0, 0, size * 0.4, '#ffcf8a', 0.35);
    spot(c, 0, 0, size * 0.14, '#fff2d6', 0.8);
    spot(c, 0, 0, size * 0.04, '#ffffff', 1);
    c.globalCompositeOperation = 'source-over';
  });
  spiral(AHEAD, H * 0.545, 240, -0.3, 0.36);
  spiral(BEHIND + 120, H * 0.51, 90, 0.6, 0.55);
}

// ---------------------------------------------------------------------------------------------------------

const SPECS: Record<BackdropId, ThemeSpec> = {
  space: {
    label: 'Deep space', blurb: 'The Milky Way over a black, starry sky',
    swatch: 'radial-gradient(ellipse 130% 28% at 50% 46%, rgba(150,170,240,.45), transparent 70%), radial-gradient(1px 1px at 20% 25%, #fff, transparent), radial-gradient(1px 1px at 72% 18%, #fff, transparent), radial-gradient(1px 1px at 85% 70%, #fff, transparent), radial-gradient(1px 1px at 35% 78%, #fff, transparent), linear-gradient(#020208, #0a0c1c 55%, #020205)',
    fog: '#05060f', ambient: ['#a5b4fc', 0.24], sun: ['#ffffff', 1.9],
    stars: 2200, tint: ['#1c2350', '#0a0c1c'], paint: paintSpace
  },
  nebula: {
    label: 'Nebula', blurb: 'Glowing violet and magenta gas clouds',
    swatch: 'radial-gradient(circle at 38% 42%, #ffe4fb 0 3%, #e879f9 10%, rgba(168,85,247,.75) 24%, transparent 46%), radial-gradient(circle at 72% 62%, rgba(59,130,246,.8), transparent 38%), radial-gradient(circle at 20% 75%, rgba(34,211,238,.45), transparent 30%), #12062a',
    fog: '#120726', ambient: ['#c4b5fd', 0.32], sun: ['#ffe4f6', 1.8], hemisphere: ['#a78bfa', '#1e1035', 0.4],
    stars: 1800, tint: ['#6d28d9', '#1e0b3a'], paint: paintNebula
  },
  aurora: {
    label: 'Aurora', blurb: 'Northern lights over a polar night',
    swatch: 'linear-gradient(to top, #03101b 0 26%, transparent 26%), linear-gradient(to top, transparent 26%, rgba(91,255,180,.95) 30%, rgba(45,212,191,.45) 50%, rgba(168,85,247,.3) 68%, transparent 86%), radial-gradient(1px 1px at 25% 15%, #fff, transparent), radial-gradient(1px 1px at 70% 10%, #fff, transparent), #020617',
    fog: '#0b2a3a', ambient: ['#a7f3d0', 0.3], sun: ['#d1fae5', 1.3], hemisphere: ['#5eead4', '#0b1a2a', 0.45],
    stars: 1400, tint: ['#14b88a', '#0b3446'], paint: paintAurora
  },
  sunset: {
    label: 'Sunset', blurb: 'A golden sun on a violet horizon',
    swatch: 'radial-gradient(ellipse 60% 30% at 38% 60%, #fff4d6 0 5%, #ffb36b 16%, rgba(255,106,61,.6) 34%, transparent 62%), linear-gradient(#0b1033, #3b1d6e 32%, #b8407a 50%, #ff8a4c 58%, #ffbe73 61%, #4a2340 68%, #140b1c)',
    fog: '#4a2340', ambient: ['#ffd7c2', 0.4], sun: ['#ffb37a', 2.2], hemisphere: ['#ffb199', '#3b1d4a', 0.5],
    stars: 500, starsFrom: 0.45, tint: ['#7a3c8c', '#f08a55'], paint: paintSunset
  },
  eclipse: {
    label: 'Eclipse', blurb: 'A total eclipse and its diamond ring',
    swatch: 'radial-gradient(circle at 34% 30%, #ffffff 0 2%, transparent 6%), radial-gradient(circle at 46% 44%, #000 0 15%, #fff8e7 17%, rgba(207,226,255,.6) 24%, rgba(91,140,255,.25) 36%, transparent 52%), linear-gradient(#000002, #040714 70%, #0d1a38 85%, #02030a)',
    fog: '#03040a', ambient: ['#93c5fd', 0.22], sun: ['#fff1d6', 1.7],
    stars: 2000, tint: ['#1a2a55', '#0d1a38'], paint: paintEclipse
  },
  galaxy: {
    label: 'Galaxy', blurb: 'A spiral galaxy rising over the scene',
    swatch: 'radial-gradient(ellipse 44% 13% at 50% 46%, #fffaf0 0 5%, #ffcf8a 18%, rgba(216,220,255,.6) 40%, rgba(143,180,255,.3) 62%, transparent 80%), radial-gradient(1px 1px at 18% 22%, #fff, transparent), radial-gradient(1px 1px at 80% 75%, #fff, transparent), linear-gradient(#010008, #0a0d2c 60%, #030312)',
    fog: '#05041a', ambient: ['#c7d2fe', 0.3], sun: ['#fff3dc', 1.9],
    stars: 1800, tint: ['#3a3f8c', '#0a0d2c'], paint: paintGalaxy
  }
};

export const THEMES: { id: BackdropId; label: string; blurb: string; swatch: string }[] =
  (Object.keys(SPECS) as BackdropId[]).map(id => ({ id, label: SPECS[id].label, blurb: SPECS[id].blurb, swatch: SPECS[id].swatch }));

// Each sky is painted once, the first time it is used, and kept for the rest of the visit
const skies = new Map<BackdropId, THREE.CanvasTexture>();
function skyTexture(id: BackdropId): THREE.CanvasTexture {
  let texture = skies.get(id);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    SPECS[id].paint(canvas.getContext('2d')!, seeded(9973 + id.length * 131));
    texture = new THREE.CanvasTexture(canvas);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.userData.shared = true;
    texture.userData.tint = SPECS[id].tint;
    skies.set(id, texture);
  }
  return texture;
}

function starField(count: number, from = -1): THREE.Points {
  // Fixed pseudo-random sequence, so the sky looks the same every time
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = from + rnd() * (1 - from), phi = rnd() * Math.PI * 2, r = 420;
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = r * s * Math.cos(phi);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(phi);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}

interface Snapshot {
  background: THREE.Scene['background'];
  fog: THREE.Color | null;
  ambientColor: THREE.Color; ambientIntensity: number;
  sunColor: THREE.Color; sunIntensity: number;
}

export class ThemeController {
  private original: Snapshot;
  private extras: THREE.Object3D[] = [];
  current: ThemeId = 'original';

  constructor(private scene: THREE.Scene, private ambient: THREE.AmbientLight, private sun: THREE.DirectionalLight) {
    this.original = this.read();
  }

  private read(): Snapshot {
    const fog = this.scene.fog as THREE.Fog | null;
    return {
      background: this.scene.background,
      fog: fog && fog.color ? fog.color.clone() : null,
      ambientColor: this.ambient.color.clone(), ambientIntensity: this.ambient.intensity,
      sunColor: this.sun.color.clone(), sunIntensity: this.sun.intensity
    };
  }

  private clearExtras() {
    this.extras.forEach(o => {
      if (o.parent) o.parent.remove(o);
      const mesh = o as THREE.Points;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    });
    this.extras = [];
  }

  // Puts the scene's own look back (call before a scene is rebuilt)
  restore() {
    this.clearExtras();
    const o = this.original;
    this.scene.background = o.background;
    this.scene.backgroundRotation.set(0, 0, 0);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog && fog.color && o.fog) fog.color.copy(o.fog);
    this.ambient.color.copy(o.ambientColor);
    this.ambient.intensity = o.ambientIntensity;
    this.sun.color.copy(o.sunColor);
    this.sun.intensity = o.sunIntensity;
  }

  // Remembers the scene's own look as 'original' (call after a scene has been built, while restored)
  capture() {
    this.original = this.read();
  }

  // Turns the sky round the vertical so its main feature stands a little right of the camera's line of sight
  aim(camera: THREE.Camera) {
    const look = camera.getWorldDirection(new THREE.Vector3());
    if (Math.abs(look.x) + Math.abs(look.z) < 1e-6) return;   // Looking straight down: any turn will do
    const target = Math.atan2(look.z, look.x) + 0.2;             // About 11 degrees to the right
    this.scene.backgroundRotation.set(0, -Math.PI / 2 - target, 0);
  }

  apply(id: ThemeId, camera?: THREE.Camera) {
    this.restore();
    this.current = id;
    const spec = id === 'original' ? undefined : SPECS[id];
    if (!spec) return;
    this.scene.background = skyTexture(id as BackdropId);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog && fog.color) fog.color.set(spec.fog);
    this.ambient.color.set(spec.ambient[0]);
    this.ambient.intensity = spec.ambient[1];
    this.sun.color.set(spec.sun[0]);
    this.sun.intensity = spec.sun[1];
    if (spec.hemisphere) {
      const hemi = new THREE.HemisphereLight(spec.hemisphere[0], spec.hemisphere[1], spec.hemisphere[2]);
      this.scene.add(hemi);
      this.extras.push(hemi);
    }
    if (camera) this.aim(camera);
    if (spec.stars) {
      const stars = starField(spec.stars, spec.starsFrom);
      this.scene.add(stars);
      this.extras.push(stars);
    }
  }

  dispose() {
    this.clearExtras();
  }
}