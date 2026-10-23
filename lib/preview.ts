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

// The rendered frame as a JPEG (base64, no prefix). The live view draws nothing over the scene (its
// controls sit around it), so the picture is exactly what the viewer sees.
function snapshot(source: HTMLCanvasElement): string {
  return source.toDataURL('image/jpeg', 0.85).split(',')[1];
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
    const shot = () => {
      scene.syncMeshes();
      renderer!.render(scene.scene, scene.camera);
      return snapshot(canvas);
    };

    // The opening shot, framed as the live view frames it. The camera then stays put.
    h.syncMeshes();
    h.frame();
    const start = shot();
    for (let i = 0; i < Math.round(LATER_SECONDS * 60); i++) h.step();
    const later = shot();
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
