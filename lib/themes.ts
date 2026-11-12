// Backdrops: a simple painted sky with fog, floor colour and lighting to match, swapped in under any scene.
// They replace only the sky, the floor colour and the lights, never the scene's own objects.
import * as THREE from 'three';

export type ThemeId = 'dark' | 'space' | 'nebula' | 'aurora' | 'sunset' | 'eclipse' | 'galaxy';

// The look every scene opens with, generated ones included, and the one Realistic view always uses
export const DEFAULT_SCENE_THEME: ThemeId = 'dark';

type Ctx = CanvasRenderingContext2D;

interface ThemeSpec {
  label: string;
  swatch: string;                 // CSS background for the picker button
  paint: (c: Ctx) => void;        // The sky, drawn over the view (only the top part shows above the floor)
  floor: string;                  // Colour for the scene's plain floor
  fog: string;
  ambient: [string, number];
  sun: [string, number];
  stars?: number;                 // Crisp stars round the scene
}

// A 1024 x 512 picture, y = 0 at the top of the view
const W = 1024, H = 512;
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function gradient(c: Ctx, stops: [number, string][]) {
  const g = c.createLinearGradient(0, 0, 0, H);
  stops.forEach(([at, colour]) => g.addColorStop(at, colour));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

// A soft glow that fades to its own colour, see-through (fading to transparent black would leave grey edges)
function glow(c: Ctx, x: number, y: number, r: number, colour: string, flatten = 1) {
  c.save();
  c.translate(x, y);
  c.scale(1, flatten);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, colour);
  g.addColorStop(1, colour.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgba($1,$2,$3,0)'));
  c.fillStyle = g;
  c.fillRect(-r, -r, r * 2, r * 2);
  c.restore();
}

function starDots(c: Ctx, seed: number, count: number, maxY = H) {
  const rand = seeded(seed);
  for (let i = 0; i < count; i++) {
    const big = rand() < 0.06;
    c.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.6})`;
    c.fillRect(rand() * W, rand() * maxY, big ? 2 : 1, big ? 2 : 1);
  }
}

// Dark: a plain deep navy-black night with a few faint stars, nothing coloured to pull the eye from the physics
function paintDark(c: Ctx) {
  gradient(c, [[0, '#04050b'], [0.45, '#080a16'], [1, '#04050a']]);
  const rand = seeded(41);
  for (let i = 0; i < 260; i++) {
    c.fillStyle = `rgba(220,226,255,${0.12 + rand() * 0.3})`;
    c.fillRect(rand() * W, rand() * H * 0.6, 1, 1);
  }
}

// Deep space: black, coloured nebulae, dense stars and a faint distant galaxy
function paintSpace(c: Ctx) {
  gradient(c, [[0, '#010008'], [0.5, '#06041a'], [1, '#010006']]);
  c.globalCompositeOperation = 'lighter';
  glow(c, W * 0.68, H * 0.22, 260, 'rgba(168,85,247,0.28)', 0.55);
  glow(c, W * 0.6, H * 0.3, 180, 'rgba(236,72,153,0.18)', 0.6);
  glow(c, W * 0.3, H * 0.34, 240, 'rgba(59,130,246,0.2)', 0.5);
  c.globalCompositeOperation = 'source-over';
  starDots(c, 23, 1400);
  c.save();
  c.translate(W * 0.86, H * 0.14);
  c.rotate(-0.4);
  c.globalCompositeOperation = 'lighter';
  glow(c, 0, 0, 70, 'rgba(140,160,255,0.22)', 0.3);
  glow(c, 0, 0, 34, 'rgba(255,214,160,0.45)', 0.35);
  glow(c, 0, 0, 9, 'rgba(255,245,225,0.9)');
  c.restore();
}

// Nebula: one big pink and violet cloud with a cool blue edge
function paintNebula(c: Ctx) {
  gradient(c, [[0, '#07021a'], [0.45, '#140630'], [1, '#05010e']]);
  starDots(c, 7, 900);
  c.globalCompositeOperation = 'lighter';
  glow(c, W * 0.74, H * 0.17, 330, 'rgba(192,38,211,0.36)', 0.5);
  glow(c, W * 0.82, H * 0.14, 180, 'rgba(236,72,153,0.38)', 0.6);
  glow(c, W * 0.55, H * 0.22, 240, 'rgba(34,211,238,0.18)', 0.45);
  glow(c, W * 0.8, H * 0.15, 50, 'rgba(255,220,250,0.5)');
  c.globalCompositeOperation = 'source-over';
}

// Aurora: green curtains of light over a dark blue night
function paintAurora(c: Ctx) {
  gradient(c, [[0, '#020814'], [0.35, '#05162a'], [0.5, '#0a2a3a'], [1, '#03101a']]);
  starDots(c, 11, 700, H * 0.4);
  c.globalCompositeOperation = 'lighter';
  for (let x = 0; x < W; x += 2) {
    const t = (x / W) * Math.PI * 2;
    const foot = H * (0.3 + 0.03 * Math.sin(t * 2 + 0.5));
    const reach = H * (0.1 + 0.1 * Math.sin(t * 3 + 1) ** 2);
    const a = 0.3 * (0.35 + 0.65 * Math.abs(Math.sin(x * 0.03) * Math.sin(x * 0.007 + 1)));
    const g = c.createLinearGradient(0, foot, 0, foot - reach);
    g.addColorStop(0, 'rgba(91,255,180,0)');
    g.addColorStop(0.08, `rgba(91,255,180,${a})`);
    g.addColorStop(0.5, `rgba(45,212,191,${a * 0.4})`);
    g.addColorStop(1, 'rgba(168,85,247,0)');
    c.fillStyle = g;
    c.fillRect(x, foot - reach, 2, reach);
  }
  c.globalCompositeOperation = 'source-over';
}

// Sunset: indigo overhead warming to orange, with a low sun
function paintSunset(c: Ctx) {
  gradient(c, [[0, '#141243'], [0.1, '#3a1d63'], [0.18, '#8a3a78'], [0.25, '#f07a4a'], [0.31, '#ffc27a'], [0.42, '#7a3a4a'], [1, '#2a1530']]);
  starDots(c, 5, 60, H * 0.07);
  const x = W * 0.8, y = H * 0.27;
  c.globalCompositeOperation = 'lighter';
  glow(c, x, y, 200, 'rgba(255,160,80,0.4)', 0.45);
  glow(c, x, y, 60, 'rgba(255,230,170,0.7)');
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#ffe9bd';
  c.beginPath();
  c.arc(x, y, 22, 0, Math.PI * 2);
  c.fill();
  // A few thin clouds across the glow
  [[0.62, 0.22, 160], [0.88, 0.2, 120], [0.35, 0.18, 140]].forEach(([cx, cy, r]) => glow(c, W * cx, H * cy, r, 'rgba(110,40,90,0.45)', 0.08));
}

// Eclipse: a black sun ringed by a glowing corona
function paintEclipse(c: Ctx) {
  gradient(c, [[0, '#000000'], [0.5, '#05060c'], [1, '#0a0a14']]);
  starDots(c, 3, 900);
  const x = W * 0.83, y = H * 0.14, r = 28;
  c.globalCompositeOperation = 'lighter';
  glow(c, x, y, 170, 'rgba(255,190,120,0.16)');
  glow(c, x, y, 70, 'rgba(255,225,180,0.6)');
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#000000';
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(255,244,225,0.9)';
  c.lineWidth = 1.5;
  c.stroke();
}

// Galaxy: a soft band of starlight across the sky with a warm core
function paintGalaxy(c: Ctx) {
  gradient(c, [[0, '#03030b'], [0.45, '#080a1a'], [1, '#03030a']]);
  starDots(c, 17, 900);
  const band = (t: number) => H * (0.42 - 0.34 * t);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i <= 60; i++) glow(c, (i / 60) * W, band(i / 60), 90, 'rgba(150,160,230,0.07)', 0.5);
  glow(c, W * 0.82, band(0.82), 130, 'rgba(255,210,160,0.28)', 0.45);
  glow(c, W * 0.82, band(0.82), 40, 'rgba(255,240,220,0.5)', 0.6);
  const rand = seeded(29);
  for (let i = 0; i < 1500; i++) {
    const t = rand(), spread = (rand() + rand() + rand() - 1.5) * 40;
    c.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.5})`;
    c.fillRect(t * W, band(t) + spread, 1, 1);
  }
  c.globalCompositeOperation = 'source-over';
}

const SPECS: Record<ThemeId, ThemeSpec> = {
  dark: {
    label: 'Dark', paint: paintDark, floor: '#12141f', fog: '#05060c',
    swatch: 'radial-gradient(circle at 30% 30%, rgba(220,226,255,.5) 0 1px, transparent 2px), radial-gradient(circle at 70% 55%, rgba(220,226,255,.35) 0 1px, transparent 2px), linear-gradient(#04050b, #0a0c18)',
    ambient: ['#c7d2fe', 0.34], sun: ['#ffffff', 1.9], stars: 500
  },
  space: {
    label: 'Space', paint: paintSpace, floor: '#151729', fog: '#05040f',
    swatch: 'radial-gradient(ellipse 14% 5% at 80% 24%, #ffe9c4, transparent), radial-gradient(circle at 70% 40%, rgba(168,85,247,.6), transparent 45%), radial-gradient(circle at 30% 60%, rgba(59,130,246,.45), transparent 40%), #02010a',
    ambient: ['#a5b4fc', 0.3], sun: ['#ffffff', 1.9], stars: 2200
  },
  nebula: {
    label: 'Nebula', paint: paintNebula, floor: '#1d1430', fog: '#120822',
    swatch: 'radial-gradient(circle at 62% 45%, rgba(236,72,153,.85), transparent 45%), radial-gradient(circle at 35% 60%, rgba(34,211,238,.45), transparent 40%), #10052a',
    ambient: ['#e9d5ff', 0.35], sun: ['#fdf4ff', 1.8], stars: 1500
  },
  aurora: {
    label: 'Aurora', paint: paintAurora, floor: '#0f1f26', fog: '#081a24',
    swatch: 'linear-gradient(transparent 20%, rgba(91,255,180,.7) 55%, transparent 75%), linear-gradient(#020814, #0a2a3a)',
    ambient: ['#a7f3d0', 0.32], sun: ['#e0fff4', 1.6], stars: 1200
  },
  sunset: {
    label: 'Sunset', paint: paintSunset, floor: '#2b1c2a', fog: '#3b1f35',
    swatch: 'radial-gradient(circle at 70% 70%, #ffe9bd 8%, transparent 30%), linear-gradient(#3a1d63, #8a3a78 45%, #f07a4a 75%, #ffc27a)',
    ambient: ['#fed7aa', 0.45], sun: ['#ffb37a', 2.1]
  },
  eclipse: {
    label: 'Eclipse', paint: paintEclipse, floor: '#15151d', fog: '#06060c',
    swatch: 'radial-gradient(circle at 55% 45%, #000 18%, #ffe1b4 21%, rgba(255,190,120,.35) 32%, transparent 50%), #020206',
    ambient: ['#cbd5e1', 0.25], sun: ['#fff1d6', 1.7], stars: 1800
  },
  galaxy: {
    label: 'Galaxy', paint: paintGalaxy, floor: '#141a2c', fog: '#070914',
    swatch: 'radial-gradient(ellipse 22% 12% at 60% 40%, rgba(255,214,170,.85), transparent), linear-gradient(160deg, transparent 35%, rgba(150,160,230,.4) 50%, transparent 65%), #04040e',
    ambient: ['#c7d2fe', 0.3], sun: ['#ffffff', 1.8], stars: 1800
  }
};

export const THEMES: { id: ThemeId; label: string; swatch: string }[] =
  (Object.keys(SPECS) as ThemeId[]).map(id => ({ id, label: SPECS[id].label, swatch: SPECS[id].swatch }));

// Each painted sky is made once and kept
const pictures = new Map<ThemeId, THREE.CanvasTexture>();
function picture(id: ThemeId): THREE.Texture {
  let texture = pictures.get(id);
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  SPECS[id].paint(canvas.getContext('2d')!);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.shared = true;
  pictures.set(id, texture);
  return texture;
}

function starField(count: number): THREE.Points {
  // Fixed pseudo-random sequence, so the sky looks the same every time
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2, r = 420;
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
  // Part of the sky, not the scene: clicks (picking, the ruler) go straight through it
  points.raycast = () => {};
  points.userData.backdrop = true;
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
  // The scene's plain floor, painted in the theme's colour on a copy of its material
  private floor: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] } | null = null;
  // The scene's own sky-fill lights (a ground's daylight), switched off under a backdrop that brings its own light
  private quieted: { light: THREE.Light; was: number }[] = [];
  current: ThemeId | null = null;

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
    this.quieted.forEach(q => { q.light.intensity = q.was; });
    this.quieted = [];
    if (this.floor) {
      (this.floor.mesh.material as THREE.Material).dispose();
      this.floor.mesh.material = this.floor.material;
      this.floor = null;
    }
    const o = this.original;
    this.scene.background = o.background;
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog && fog.color && o.fog) fog.color.copy(o.fog);
    this.ambient.color.copy(o.ambientColor);
    this.ambient.intensity = o.ambientIntensity;
    this.sun.color.copy(o.sunColor);
    this.sun.intensity = o.sunIntensity;
    this.current = null;
  }

  // Remembers the scene's own look (call after a scene has been built, before a backdrop goes on)
  capture() {
    this.original = this.read();
  }

  apply(id: ThemeId) {
    this.restore();
    const spec = SPECS[id] || SPECS[DEFAULT_SCENE_THEME];
    this.current = id;
    this.scene.background = picture(SPECS[id] ? id : DEFAULT_SCENE_THEME);
    this.paintFloor(spec.floor);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog && fog.color) fog.color.set(spec.fog);
    this.ambient.color.set(spec.ambient[0]);
    this.ambient.intensity = spec.ambient[1];
    this.sun.color.set(spec.sun[0]);
    this.sun.intensity = spec.sun[1];
    // A blue daylight fill from the scene's own ground would wash out the backdrop
    this.scene.traverse(o => {
      const light = o as THREE.HemisphereLight;
      if (light.isHemisphereLight && light.intensity > 0) { this.quieted.push({ light, was: light.intensity }); light.intensity = 0; }
    });
    if (spec.stars) {
      const stars = starField(spec.stars);
      this.scene.add(stars);
      this.extras.push(stars);
    }
  }

  // The biggest flat, untextured slab at the bottom of the scene is its floor
  private paintFloor(colour: string) {
    const box = new THREE.Box3(), size = new THREE.Vector3();
    let best: THREE.Mesh | null = null, bestArea = 0;
    this.scene.children.forEach(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material)) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material || !material.color || material.map) return;
      box.setFromObject(mesh);
      box.getSize(size);
      const area = size.x * size.z;
      if (size.x >= 8 && size.z >= 8 && size.y < 4 && area > bestArea) { best = mesh; bestArea = area; }
    });
    if (!best) return;
    const mesh = best as THREE.Mesh;
    const copy = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
    copy.color.set(colour);
    this.floor = { mesh, material: mesh.material };
    mesh.material = copy;
  }

  dispose() {
    this.clearExtras();
  }
}
