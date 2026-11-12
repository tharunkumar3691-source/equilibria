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
    label: 'Space', swatch: 'radial-gradient(circle at 30% 30%, #312e81, #000000)',
    top: '#000000', bottom: '#05030f', fog: '#000000',
    ambient: ['#a5b4fc', 0.22], sun: ['#ffffff', 1.9], stars: 2600
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
    this.texture = gradientTexture(spec.top, spec.bottom);
    this.scene.background = this.texture;
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
    if (spec.stars) {
      const stars = starField(spec.stars);
      this.scene.add(stars);
      this.extras.push(stars);
    }
  }

  dispose() {
    this.clearExtras();
  }
}
