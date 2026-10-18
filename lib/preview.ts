// Pictures of a generated scene, for the AI to look at its own work: the opening shot the user sees,
// and the same view a moment after the action starts. Rendered off-screen with the live view's lights
// and camera framing (lib/headless.ts). Returns null when this browser cannot render (no WebGL).
import * as THREE from 'three';
import { SimulationData } from '../types';
import { buildHeadless, HeadlessScene } from './headless';

export interface ScenePreview {
  start: string;    // JPEG, base64 without the data: prefix
  later: string;
  laterSeconds: number;
}

const WIDTH = 960, HEIGHT = 540;
const LATER_SECONDS = 1.5;

// The panels the live view draws over the scene (see components/PhysicsRunner.tsx), in pixels of a
// 960 x 540 view: the toolbar, the live readout, the settings panel, the zoom buttons and the start prompt
const PANELS = {
  toolbar: [280, 12, 400, 40],
  readout: [12, 64, 264, 160],
  settings: [722, 52, 226, 240],
  zoom: [12, 484, 170, 44],
  startHint: [345, 470, 270, 46]
} as const;

// The rendered frame with the panels marked as labelled dark boxes, as a JPEG (base64, no prefix)
function markPanels(source: HTMLCanvasElement, readout: boolean, waiting: boolean): string {
  const out = document.createElement('canvas');
  out.width = WIDTH;
  out.height = HEIGHT;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(source, 0, 0, WIDTH, HEIGHT);
  const box = (name: keyof typeof PANELS, label: string) => {
    const [x, y, w, h] = PANELS[name];
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
    ctx.font = '13px sans-serif';
    ctx.fillText(label, x + 8, y + 20);
  };
  box('toolbar', 'app toolbar');
  if (readout) box('readout', 'live readout panel');
  box('settings', 'settings panel');
  box('zoom', 'zoom buttons');
  if (waiting) box('startHint', 'start prompt');
  return out.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export async function renderPreview(data: SimulationData): Promise<ScenePreview | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  let h: HeadlessScene | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    h = buildHeadless(data, { realHumans: true, aspect: WIDTH / HEIGHT });
    await h.humansReady(5000);
    const scene = h;
    const readout = h.readoutCalls > 0;
    const shot = (waiting: boolean) => {
      scene.syncMeshes();
      renderer!.render(scene.scene, scene.camera);
      return markPanels(canvas, readout, waiting && data.startMode === 'click');
    };

    // The opening shot, framed as the live view frames it. The camera then stays put.
    h.syncMeshes();
    h.frame();
    const start = shot(true);
    for (let i = 0; i < Math.round(LATER_SECONDS * 60); i++) h.step();
    const later = shot(false);
    return { start, later, laterSeconds: LATER_SECONDS };
  } catch (e) {
    console.warn('[Preview] Could not render the scene:', e);
    return null;
  } finally {
    if (h) h.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}
