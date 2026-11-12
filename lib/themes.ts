// Environment themes: backdrop, fog colour and lighting that can be swapped under any scene.
// 'original' is whatever the scene itself set up; the others replace only the backdrop and lights,
// never the scene's own objects.
import * as THREE from 'three';

export type ThemeId = 'original' | 'studio' | 'outdoor' | 'night' | 'space';

// The look every scene opens with, generated ones included
export const DEFAULT_SCENE_THEME: ThemeId = 'space';

type Paint = (c: CanvasRenderingContext2D, w: number, h: number) => void;

interface ThemeSpec {
  label: string;
  swatch: string;                 // CSS background for the picker button
  paint: Paint;                   // The backdrop picture, seen behind the scene (the top part shows above the floor)
  floor: string;                  // Colour for the scene's plain floor (textured grounds keep their texture)
  fog: string;                    // Matches the horizon, so the floor's far edge melts into the sky
  ambient: [string, number];
  sun: [string, number];
  hemisphere?: [string, string, number];
  stars?: number;
}

// Painting helpers. Pictures are drawn on a 1024 x 512 canvas; y = 0 is the top of the view.
const W = 1024, H = 512;
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function vertical(c: CanvasRenderingContext2D, stops: [number, string][]) {
  const g = c.createLinearGradient(0, 0, 0, H);
  stops.forEach(([at, colour]) => g.addColorStop(at, colour));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}
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
function stars(c: CanvasRenderingContext2D, count: number, maxY: number, seed: number) {
  const rand = seeded(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * W, y = rand() * maxY, big = rand() < 0.06;
    c.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.65})`;
    c.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
  }
}

const SPECS: Record<Exclude<ThemeId, 'original'>, ThemeSpec> = {
  // A bright, seamless photo studio: soft grey walls, a light floor, even white light
  studio: {
    label: 'Studio', swatch: 'radial-gradient(ellipse at 50% 0%, #ffffff, #cfd5df 55%, #9aa3b2)',
    paint: c => {
      vertical(c, [[0, '#f4f6fa'], [0.42, '#d9dee6'], [0.5, '#c4cad5'], [1, '#a9b1bf']]);
      glow(c, W / 2, 0, 520, 'rgba(255,255,255,0.75)', 0.6);
    },
    floor: '#b7bfcc', fog: '#cdd3dd',
    ambient: ['#ffffff', 0.9], sun: ['#ffffff', 1.5], hemisphere: ['#ffffff', '#9aa3b2', 0.6]
  },
  // A clear summer day: blue sky, a few clouds, the sun up and to the right, a grassy ground
  outdoor: {
    label: 'Outdoor', swatch: 'radial-gradient(circle at 78% 22%, #fffbe6 0 8%, transparent 24%), linear-gradient(#2f7fd8, #8cc4ef 55%, #e6f2fb 70%, #6f9a4f 71%)',
    paint: c => {
      vertical(c, [[0, '#2a74d0'], [0.3, '#5aa3e6'], [0.44, '#a9d3f3'], [0.5, '#e4f1fb'], [0.56, '#cfe2c4'], [1, '#7ea35f']]);
      glow(c, W * 0.8, H * 0.1, 160, 'rgba(255,248,220,0.9)');
      glow(c, W * 0.8, H * 0.1, 34, 'rgba(255,255,255,1)');
      const rand = seeded(7);
      for (let i = 0; i < 14; i++) {
        const x = rand() * W, y = H * (0.12 + rand() * 0.24);
        for (let k = 0; k < 5; k++) glow(c, x + (rand() - 0.5) * 110, y + (rand() - 0.5) * 16, 40 + rand() * 50, 'rgba(255,255,255,0.45)', 0.4);
      }
    },
    floor: '#6b9a4b', fog: '#d9ebf7',
    ambient: ['#ffffff', 0.5], sun: ['#fff4d6', 2.2], hemisphere: ['#bfdbfe', '#6b7f4a', 0.75]
  },
  // A clear night: deep blue sky, a bright moon, stars, cool moonlight
  night: {
    label: 'Night', swatch: 'radial-gradient(circle at 76% 26%, #f1f5ff 0 7%, rgba(180,200,255,.35) 13%, transparent 26%), linear-gradient(#040820, #12225a 60%, #22357a 70%, #0c1430 71%)',
    paint: c => {
      vertical(c, [[0, '#030716'], [0.3, '#0a1640'], [0.44, '#16296a'], [0.5, '#26397d'], [0.56, '#121c44'], [1, '#080d22']]);
      stars(c, 500, H * 0.48, 11);
      glow(c, W * 0.78, H * 0.13, 150, 'rgba(170,190,255,0.35)');
      glow(c, W * 0.78, H * 0.13, 30, 'rgba(240,244,255,1)');
      c.fillStyle = '#f1f4ff';
      c.beginPath(); c.arc(W * 0.78, H * 0.13, 20, 0, Math.PI * 2); c.fill();
    },
    floor: '#1f2b4d', fog: '#18265a',
    ambient: ['#9fb2e8', 0.4], sun: ['#c4d2ff', 0.9], stars: 700
  },
  // Deep space: black, coloured nebulae, dense stars and a ringed planet
  space: {
    label: 'Space', swatch: 'radial-gradient(ellipse 14% 5% at 80% 24%, #ffe9c4, transparent), radial-gradient(circle at 70% 40%, rgba(168,85,247,.6), transparent 45%), radial-gradient(circle at 30% 60%, rgba(59,130,246,.45), transparent 40%), #02010a',
    paint: c => {
      vertical(c, [[0, '#010008'], [0.5, '#06041a'], [1, '#010006']]);
      c.globalCompositeOperation = 'lighter';
      glow(c, W * 0.68, H * 0.22, 260, 'rgba(168,85,247,0.28)', 0.55);
      glow(c, W * 0.6, H * 0.3, 180, 'rgba(236,72,153,0.18)', 0.6);
      glow(c, W * 0.3, H * 0.34, 240, 'rgba(59,130,246,0.2)', 0.5);
      c.globalCompositeOperation = 'source-over';
      stars(c, 1400, H, 23);
      // A faint, distant spiral galaxy: clearly far away, never mistaken for something in the scene
      c.save();
      c.translate(W * 0.86, H * 0.14);
      c.rotate(-0.4);
      c.globalCompositeOperation = 'lighter';
      glow(c, 0, 0, 70, 'rgba(140,160,255,0.22)', 0.3);
      glow(c, 0, 0, 34, 'rgba(255,214,160,0.45)', 0.35);
      glow(c, 0, 0, 9, 'rgba(255,245,225,0.9)');
      c.restore();
    },
    floor: '#151729', fog: '#05040f',
    ambient: ['#a5b4fc', 0.3], sun: ['#ffffff', 1.9], stars: 2200
  }
};

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'original', label: 'Scene', swatch: 'linear-gradient(#1b2235, #151027)' },
  ...(Object.keys(SPECS) as Exclude<ThemeId, 'original'>[]).map(id => ({ id, label: SPECS[id].label, swatch: SPECS[id].swatch }))
];

// Each picture is painted once and kept
const pictures = new Map<string, THREE.CanvasTexture>();
function backdropTexture(id: Exclude<ThemeId, 'original'>): THREE.Texture {
  let texture = pictures.get(id);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    SPECS[id].paint(canvas.getContext('2d')!, W, H);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.userData.shared = true;
    pictures.set(id, texture);
  }
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
    this.scene.background = backdropTexture(id);
    this.paintFloor(spec.floor);
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

  // The biggest flat, untextured slab at the bottom of the scene is its floor (a ground with a real texture,
  // grass or wood, keeps its own look)
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
    this.restore();
  }
}