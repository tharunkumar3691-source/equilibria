// Realistic people for scenes. Rigged human models (public/models) are loaded once and cloned for
// each figure. Every figure is normalised the same way: feet at its origin, facing +z with its left
// side towards +x, scaled to a real height. Scene code poses it either by pointing bones in
// directions of the figure's own frame (aim) or by showing an animation at a given moment (play).
// A pose is always worked out afresh from the scene's clock and bodies, so replay and rewind stay right.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODELS = {
  man: { url: '/models/Soldier.glb', height: 1.8 },
  woman: { url: '/models/Michelle.glb', height: 1.66 }
};
export type HumanKind = keyof typeof MODELS;
export const isHumanKind = (kind: unknown): kind is HumanKind => typeof kind === 'string' && kind in MODELS;

export interface Human {
  object: THREE.Group;   // Place and turn this: feet at its origin, facing +z, left side towards +x
  ready: boolean;        // False until the model has loaded; posing before then does nothing
  clips: string[];       // Animations the model has (the man: 'Idle', 'Walk', 'Run')
  rest(): void;          // Back to the model's neutral pose (arms out to the sides)
  play(clip: string, time: number): void;               // Shows the animation at that moment (it loops)
  aim(bone: string, direction: ArrayLike<number>): void; // Points a bone along a direction in the figure's frame
  where(bone: string): THREE.Vector3;                    // Where a bone is now, in the figure's frame
  // A ready-made pose: 'stand', 'walk', 'run', 'sit', 'push', 'arms-up', 'throw', 'kick', 'reach'.
  // time drives 'walk' and 'run' (and the man's breathing when standing); seat (metres, in the parent's
  // frame) lowers a sitting figure so its hips rest on a seat at that height.
  setPose(name: string, options?: { time?: number; seat?: number }): void;
}

export const POSE_NAMES = ['stand', 'walk', 'run', 'sit', 'push', 'arms-up', 'throw', 'kick', 'reach'];

// Which bone each bone points towards, so aim() knows the bone's current direction
const NEXT: Record<string, string> = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head',
  Shoulder: 'Arm', Arm: 'ForeArm', ForeArm: 'Hand', Hand: 'HandMiddle1',
  UpLeg: 'Leg', Leg: 'Foot', Foot: 'ToeBase'
};
const nextBone = (name: string) => {
  const side = name.startsWith('Left') ? 'Left' : name.startsWith('Right') ? 'Right' : '';
  const next = NEXT[name.slice(side.length)];
  return next ? side + next : undefined;
};

interface Template {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  turn: THREE.Quaternion;  // Turns the model to face +z, upright
  height: number;          // Model height after the turn, in model units
  offset: THREE.Vector3;   // Moves the turned model's feet to the origin, centred under the hips
}

const templates = new Map<HumanKind, Promise<Template>>();
const boneName = (name: string) => name.replace(/^mixamorig:?/, '');

function findBones(root: THREE.Object3D): Record<string, THREE.Bone> {
  const bones: Record<string, THREE.Bone> = {};
  root.traverse(o => { if ((o as THREE.Bone).isBone) bones[boneName(o.name)] = o as THREE.Bone; });
  return bones;
}

function loadTemplate(kind: HumanKind): Promise<Template> {
  let pending = templates.get(kind);
  if (pending) return pending;
  pending = new GLTFLoader().loadAsync(MODELS[kind].url).then(gltf => {
    const scene = gltf.scene;
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m: any) => {
        // Skin and cloth are not metal (one model ships at 0.5, which makes skin look like plastic)
        if (m && typeof m.metalness === 'number') m.metalness = 0;
      });
    });

    // Work out the model's own up, left and forward from its skeleton (hips to neck, right hip to left hip)
    scene.updateMatrixWorld(true);
    const bones = findBones(scene);
    const at = (name: string) => bones[name].getWorldPosition(new THREE.Vector3());
    const up = at('Neck').sub(at('Hips')).normalize();
    const left = at('LeftUpLeg').sub(at('RightUpLeg'));
    const forward = new THREE.Vector3().crossVectors(left, up).normalize();
    left.crossVectors(up, forward);
    const basis = new THREE.Matrix4().makeBasis(left, up, forward);
    const turn = new THREE.Quaternion().setFromRotationMatrix(basis).invert();

    // Measure the posed skin (not just the skeleton) once it faces +z
    const holder = new THREE.Group();
    holder.quaternion.copy(turn);
    holder.add(scene);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder, true);
    const hips = bones.Hips.getWorldPosition(new THREE.Vector3());
    holder.remove(scene);
    return {
      scene,
      clips: gltf.animations,
      turn,
      height: box.max.y - box.min.y,
      offset: new THREE.Vector3(-hips.x, -box.min.y, -hips.z)
    };
  });
  // A failed load is not cached, so a later scene can try again
  pending.catch(() => templates.delete(kind));
  templates.set(kind, pending);
  return pending;
}

export function createHuman(kind: HumanKind, height: number | undefined, onReady: (human: Human) => void): Human {
  const object = new THREE.Group();
  object.name = 'human_' + kind;
  let bones: Record<string, THREE.Bone> = {};
  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let current: THREE.AnimationAction | null = null;
  const rest: { bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), q4 = new THREE.Quaternion();

  const human: Human = {
    object,
    ready: false,
    clips: [],
    rest() {
      if (mixer) mixer.stopAllAction();
      current = null;
      rest.forEach(r => { r.bone.position.copy(r.position); r.bone.quaternion.copy(r.quaternion); });
    },
    play(name, time) {
      if (!mixer) return;
      const clip = clips.find(c => c.name === name);
      if (!clip) return;
      const action = mixer.clipAction(clip);
      if (current !== action) {
        mixer.stopAllAction();
        action.play();
        current = action;
      }
      mixer.setTime(Math.max(0, Number(time) || 0));
    },
    aim(name, direction) {
      const bone = bones[name];
      const child = bones[nextBone(name) || ''];
      if (!bone || !child || !bone.parent || !direction) return;
      object.updateWorldMatrix(true, true);
      const from = child.getWorldPosition(v1).sub(bone.getWorldPosition(v2)).normalize();
      const to = v3.set(Number(direction[0]) || 0, Number(direction[1]) || 0, Number(direction[2]) || 0);
      if (to.lengthSq() < 1e-8) return;
      to.normalize().applyQuaternion(object.getWorldQuaternion(q1));
      // Turn the bone in world space by the smallest rotation that lines it up, then express that locally
      const delta = q2.setFromUnitVectors(from, to);
      const boneWorld = bone.getWorldQuaternion(q3);
      const parentWorld = bone.parent.getWorldQuaternion(q4).invert();
      bone.quaternion.copy(parentWorld.multiply(delta.multiply(boneWorld)));
    },
    where(name) {
      const bone = bones[name];
      if (!bone) return new THREE.Vector3();
      object.updateWorldMatrix(true, true);
      return object.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    },
    setPose(name, options = {}) {
      if (!human.ready) return;
      const time = Number(options.time) || 0;
      const h = human;
      const both = (f: (side: string, x: number) => void) => { f('Left', 1); f('Right', -1); };
      const armsDown = () => both((s, x) => { h.aim(s + 'Arm', [0.12 * x, -1, 0.04]); h.aim(s + 'ForeArm', [0.06 * x, -1, 0.18]); });
      // A walking or running stride without an animation clip: thighs swing, knees bend, arms counter-swing
      const stride = (period: number, swing: number, lean: number) => {
        const phase = (time / period) * Math.PI * 2;
        h.rest();
        h.aim('Spine', [0, 1, lean]);
        both((s, x) => {
          const a = Math.sin(phase) * x;
          h.aim(s + 'UpLeg', [0.05 * x, -Math.cos(a * swing), Math.sin(a * swing)]);
          const knee = Math.max(0, -Math.sin(phase + 0.6) * x) * swing * 1.6;
          h.aim(s + 'Leg', [0.03 * x, -Math.cos(a * swing - knee), Math.sin(a * swing - knee)]);
          h.aim(s + 'Arm', [0.14 * x, -Math.cos(-a * swing * 0.8), Math.sin(-a * swing * 0.8)]);
          h.aim(s + 'ForeArm', [0.08 * x, -0.5, 0.86]);
        });
      };
      switch (name) {
        case 'walk':
          if (h.clips.includes('Walk')) h.play('Walk', time); else stride(1.05, 0.45, 0.05);
          return;
        case 'run':
          if (h.clips.includes('Run')) h.play('Run', time); else stride(0.7, 0.8, 0.25);
          return;
        case 'sit': {
          h.rest();
          h.aim('Spine', [0, 1, 0.08]);
          both((s, x) => {
            h.aim(s + 'UpLeg', [0.14 * x, -0.08, 1]);
            h.aim(s + 'Leg', [0.04 * x, -1, 0.08]);
            h.aim(s + 'Foot', [0, -0.3, 1]);
            h.aim(s + 'Arm', [0.18 * x, -0.9, 0.4]);
            h.aim(s + 'ForeArm', [0.02 * x, -0.25, 1]);   // Hands resting on the thighs
          });
          if (typeof options.seat === 'number') object.position.y = options.seat + 0.07 - h.where('Hips').y;
          return;
        }
        case 'push':
          if (h.clips.includes('Idle')) h.play('Idle', time); else h.rest();
          h.aim('Spine', [0, 1, 0.35]);
          both((s, x) => { h.aim(s + 'Arm', [0.2 * x, -0.35, 0.92]); h.aim(s + 'ForeArm', [0.04 * x, -0.05, 1]); h.aim(s + 'Hand', [0, 0.8, 0.6]); });
          return;
        case 'arms-up':
          h.rest();
          both((s, x) => { h.aim(s + 'Arm', [0.25 * x, 1, 0.05]); h.aim(s + 'ForeArm', [0.1 * x, 1, 0.05]); });
          return;
        case 'throw':
          h.rest();
          h.aim('Spine', [0, 1, -0.1]);
          h.aim('RightArm', [-0.7, 0.55, -0.45]);   // Throwing arm cocked back above the shoulder
          h.aim('RightForeArm', [-0.1, 1, -0.2]);
          h.aim('LeftArm', [0.3, 0.1, 1]);          // Other arm points at the target
          h.aim('LeftForeArm', [0.1, 0.15, 1]);
          h.aim('LeftUpLeg', [0.1, -1, 0.35]);
          h.aim('RightUpLeg', [-0.1, -1, -0.25]);
          return;
        case 'kick':
          h.rest();
          h.aim('Spine', [0, 1, -0.15]);
          h.aim('RightUpLeg', [-0.05, -0.35, 1]);    // Kicking leg swung forward
          h.aim('RightLeg', [0, -0.15, 1]);
          h.aim('LeftUpLeg', [0.08, -1, -0.1]);
          both((s, x) => { h.aim(s + 'Arm', [0.7 * x, -0.5, -0.2 * x]); h.aim(s + 'ForeArm', [0.6 * x, -0.4, 0.2]); });
          return;
        case 'reach':
          h.rest();
          armsDown();
          h.aim('RightArm', [-0.1, 0, 1]);
          h.aim('RightForeArm', [-0.05, 0, 1]);
          return;
        default: // 'stand'
          if (h.clips.includes('Idle')) { h.play('Idle', time); return; }
          h.rest();
          armsDown();
      }
    }
  };

  loadTemplate(kind).then(t => {
    const model = cloneSkinned(t.scene);
    model.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Own materials, so rebuilding the scene (which disposes them) leaves other figures alone
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone();
      mesh.castShadow = true;
      mesh.frustumCulled = false; // Animated skin can leave its rest-pose bounds
    });
    const scale = (height && height > 0 ? height : MODELS[kind].height) / t.height;
    const fit = new THREE.Group();
    fit.quaternion.copy(t.turn);
    fit.scale.setScalar(scale);
    fit.position.copy(t.offset).multiplyScalar(scale);
    fit.add(model);
    object.add(fit);

    bones = findBones(model);
    Object.values(bones).forEach(bone => rest.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    mixer = new THREE.AnimationMixer(model);
    clips = t.clips.filter(c => c.name !== 'TPose');
    human.clips = clips.map(c => c.name);
    human.ready = true;
    onReady(human);
  }).catch(e => console.warn(`[Humans] Could not load the ${kind} model:`, e));

  return human;
}
