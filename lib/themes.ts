// Environment themes: backdrop, fog colour and lighting that can be swapped under any scene.
// 'original' is whatever the scene itself set up; the others replace only the backdrop and lights,
// never the scene's own objects.
import * as THREE from 'three';

export type ThemeId = 'original' | 'studio' | 'outdoor' | 'night' | 'space';

// The look every scene opens with, generated ones included
export const DEFAULT_SCENE_THEME: ThemeId = 'space';

interface ThemeSpec {
  label: string;
  swatch: string;                 // CSS background for the picker button
  top: string; bottom: string;    // Backdrop gradient
  fog: string;
  ambient: [string, number];
  sun: [string, number];
  hemisphere?: [string, string, number];
  stars?: number;
  paint?: (c: CanvasRenderingContext2D) => void;   // A painted picture in place of the gradient
  floor?: string;                                  // Colour for the scene's plain floor
}

// Painting helpers for the painted backdrop: a 1024 x 512 picture, y = 0 at the top of the view
const W = 1024, H = 512;
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, flatten = 1) {
  c.save();
  c.translate(x, y);
  c.scale(1, flatten);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, colour);
  // Fades to the same colour, see-through (fading to transparent black would leave grey edges)
  g.addColorStop(1, colour.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgba($1,$2,$3,0)'));
  c.fillStyle = g;
  c.fillRect(-r, -r, r * 2, r * 2);
  c.restore();
}

// Deep space: black, coloured nebulae, dense stars and a faint distant galaxy
function paintSpace(c: CanvasRenderingContext2D) {
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#010008'); sky.addColorStop(0.5, '#06041a'); sky.addColorStop(1, '#010006');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'lighter';
  glow(c, W * 0.68, H * 0.22, 260, 'rgba(168,85,247,0.28)', 0.55);
  glow(c, W * 0.6, H * 0.3, 180, 'rgba(236,72,153,0.18)', 0.6);
  glow(c, W * 0.3, H * 0.34, 240, 'rgba(59,130,246,0.2)', 0.5);
  c.globalCompositeOperation = 'source-over';
  const rand = seeded(23);
  for (let i = 0; i < 1400; i++) {
    const big = rand() < 0.06;
    c.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.65})`;
    c.fillRect(rand() * W, rand() * H, big ? 2 : 1, big ? 2 : 1);
  }
  c.save();
  c.translate(W * 0.86, H * 0.14);
  c.rotate(-0.4);
  c.globalCompositeOperation = 'lighter';
  glow(c, 0, 0, 70, 'rgba(140,160,255,0.22)', 0.3);
  glow(c, 0, 0, 34, 'rgba(255,214,160,0.45)', 0.35);
  glow(c, 0, 0, 9, 'rgba(255,245,225,0.9)');
  c.restore();
}

// The painted picture is made once and kept
let spacePicture: THREE.CanvasTexture | null = null;
function paintedTexture(paint: (c: CanvasRenderingContext2D) => void): THREE.Texture {
  if (spacePicture) return spacePicture;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  paint(canvas.getContext('2d')!);
  spacePicture = new THREE.CanvasTexture(canvas);
  spacePicture.colorSpace = THREE.SRGBColorSpace;
  spacePicture.userData.shared = true;
  return spacePicture;
}

const SPECS: Record<Exclude<ThemeId, 'original'>, ThemeSpec> = {
  studio: {
    label: 'Studio', swatch: 'linear-gradient(#e2e8f0, #64748b)',
    top: '#cbd5e1', bottom: '#475569', fog: '#64748b',
    ambient: ['#ffffff', 0.75], sun: ['#ffffff', 1.6]
  },
  outdoor: {
    label: 'Outdoor', swatch: 'linear-gradient(#38bdf8, #e0f2fe)',
    top: '#2f8fe0', bottom: '#dbeafe', fog: '#c7ddf2',
    ambient: ['#ffffff', 0.45], sun: ['#fff4d6', 2.1], hemisphere: ['#bfdbfe', '#6b7f4a', 0.7]
  },
  night: {
    label: 'Night', swatch: 'linear-gradient(#020617, #1e3a8a)',
    top: '#020617', bottom: '#172554', fog: '#0b1433',
    ambient: ['#93a5d8', 0.3], sun: ['#b6c6ff', 0.75], stars: 900
  },
  space: {
    label: 'Space', swatch: 'radial-gradient(ellipse 14% 5% at 80% 24%, #ffe9c4, transparent), radial-gradient(circle at 70% 40%, rgba(168,85,247,.6), transparent 45%), radial-gradient(circle at 30% 60%, rgba(59,130,246,.45), transparent 40%), #02010a',
    top: '#010008', bottom: '#010006', fog: '#05040f', paint: paintSpace, floor: '#151729',
    ambient: ['#a5b4fc', 0.3], sun: ['#ffffff', 1.9], stars: 2200
  }
};

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'original', label: 'Scene', swatch: 'linear-gradient(#0f172a, #1e293b)' },
  ...(Object.keys(SPECS) as Exclude<ThemeId, 'original'>[]).map(id => ({ id, label: SPECS[id].label, swatch: SPECS[id].swatch }))
];

function gradientTexture(top: string, bottom: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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
  private texture: THREE.Texture | null = null;
  // The scene's plain floor, painted in the theme's colour on a copy of its material
  private floor: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] } | null = null;
  // The scene's own sky-fill lights (a ground's daylight), switched off under a theme that brings its own light
  private quieted: { light: THREE.Light; was: number }[] = [];
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
    if (this.texture) { this.texture.dispose(); this.texture = null; }
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
  }

  // Remembers the scene's own look as 'original' (call after a scene has been built, while restored)
  capture() {
    this.original = this.read();
  }

  apply(id: ThemeId) {
    this.restore();
    this.current = id;
    if (id === 'original') return;
    const spec = SPECS[id];
    if (spec.paint) {
      this.scene.background = paintedTexture(spec.paint);
    } else {
      this.texture = gradientTexture(spec.top, spec.bottom);
      this.scene.background = this.texture;
    }
    if (spec.floor) this.paintFloor(spec.floor);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog && fog.color) fog.color.set(spec.fog);
    this.ambient.color.set(spec.ambient[0]);
    this.ambient.intensity = spec.ambient[1];
    this.sun.color.set(spec.sun[0]);
    this.sun.intensity = spec.sun[1];
    // A blue daylight fill from the scene's own ground would light up a night or space sky
    this.scene.traverse(o => {
      const light = o as THREE.HemisphereLight;
      if (light.isHemisphereLight && light.intensity > 0) { this.quieted.push({ light, was: light.intensity }); light.intensity = 0; }
    });
    if (spec.hemisphere) {
      const hemi = new THREE.HemisphereLight(spec.hemisphere[0], spec.hemisphere[1], spec.hemisphere[2]);
      this.scene.add(hemi);
      this.extras.push(hemi);
    }
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
