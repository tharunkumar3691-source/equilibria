// Realistic people for scenes: Microsoft Rocketbox avatars (MIT licence, see public/models/people/LICENSE.txt),
// with skin, face and clothing textures, a full 81-bone skeleton and facial expression shapes. Each model is
// loaded once and cloned for each figure. Every figure is normalised the same way: feet at its origin, facing
// +z with its left side towards +x, scaled to a real height. Scene code poses it either by pointing bones in
// directions of the figure's own frame (aim) or with a ready-made pose (setPose). A pose is always worked out
// afresh from the scene's clock and bodies, so replay and rewind stay right. Faces blink and take an expression
// that fits the pose (a soft smile at rest, effort when pushing), so the people look alive rather than frozen.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Two different people of each kind, so a scene with two men shows two different men
const PEOPLE = {
  man: [{ id: 'man-1', height: 1.8 }, { id: 'man-2', height: 1.78 }],
  woman: [{ id: 'woman-1', height: 1.66 }, { id: 'woman-2', height: 1.68 }]
};
export type HumanKind = keyof typeof PEOPLE;
export const isHumanKind = (kind: unknown): kind is HumanKind => typeof kind === 'string' && kind in PEOPLE;
const folder = (id: string) => `/models/people/${id}/`;

// The expression shapes kept from the model's 175 (all of them would take over 100 MB of graphics memory)
const SHAPES = {
  blinkLeft: 'EyeBlinkLeft', blinkRight: 'EyeBlinkRight',
  smileLeft: 'MouthSmileLeft', smileRight: 'MouthSmileRight',
  browDownLeft: 'BrowDownLeft', browDownRight: 'BrowDownRight',
  squintLeft: 'EyeSquintLeft', squintRight: 'EyeSquintRight',
  pressLeft: 'MouthPressLeft', pressRight: 'MouthPressRight',
  jawOpen: 'JawOpen'
};
type Shape = keyof typeof SHAPES;
type Expression = Partial<Record<Shape, number>>;
const EXPRESSIONS: Record<string, Expression> = {
  calm: { smileLeft: 0.12, smileRight: 0.12 },
  effort: { browDownLeft: 0.55, browDownRight: 0.55, squintLeft: 0.35, squintRight: 0.35, pressLeft: 0.5, pressRight: 0.5 },
  breathing: { jawOpen: 0.12, browDownLeft: 0.15, browDownRight: 0.15 }
};

// The Rocketbox skeleton (3ds Max Biped names) under the names scenes use for bones
const BIPED: Record<string, string> = {
  Pelvis: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2', Neck: 'Neck', Head: 'Head'
};
(['L', 'R'] as const).forEach(s => {
  const side = s === 'L' ? 'Left' : 'Right';
  Object.assign(BIPED, {
    [`${s}_Clavicle`]: side + 'Shoulder', [`${s}_UpperArm`]: side + 'Arm', [`${s}_Forearm`]: side + 'ForeArm',
    [`${s}_Hand`]: side + 'Hand', [`${s}_Finger2`]: side + 'HandMiddle1',
    [`${s}_Thigh`]: side + 'UpLeg', [`${s}_Calf`]: side + 'Leg', [`${s}_Foot`]: side + 'Foot', [`${s}_Toe0`]: side + 'ToeBase'
  });
});

export interface Human {
  object: THREE.Group;   // Place and turn this: feet at its origin, facing +z, left side towards +x
  ready: boolean;        // False until the model has loaded; posing before then does nothing
  clips: string[];       // Animations the model has (none: poses are made from bones, see setPose)
  rest(): void;          // Back to the model's neutral pose (arms out to the sides)
  play(clip: string, time: number): void;               // Shows the animation at that moment (it loops)
  aim(bone: string, direction: ArrayLike<number>): void; // Points a bone along a direction in the figure's frame
  where(bone: string): THREE.Vector3;                    // Where a bone is now, in the figure's frame
  // A ready-made pose: 'stand', 'walk', 'run', 'sit', 'push', 'arms-up', 'throw', 'kick', 'reach'.
  // time drives 'walk' and 'run' (and breathing when standing); seat (metres, in the parent's frame)
  // lowers a sitting figure so its hips rest on a seat at that height. face sets the expression ('calm',
  // 'effort' or 'breathing'); by default it suits the pose (effort for push, throw and kick).
  setPose(name: string, options?: { time?: number; seat?: number; face?: string }): void;
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

const templates = new Map<string, Promise<Template>>();
const boneName = (name: string) => {
  const plain = name.replace(/^mixamorig:?/, '');
  const biped = /^Bip01[_ ](.+)$/.exec(plain);
  return biped ? BIPED[biped[1].replace(/ /g, '_')] || plain : plain;
};

function findBones(root: THREE.Object3D): Record<string, THREE.Bone> {
  const bones: Record<string, THREE.Bone> = {};
  root.traverse(o => { if ((o as THREE.Bone).isBone) bones[boneName(o.name)] = o as THREE.Bone; });
  return bones;
}

// The person's own textures (the model file only names the original TGA files, which are not shipped)
const textureLoader = new THREE.TextureLoader();
const texture = (id: string, file: string, colour: boolean) => {
  const t = textureLoader.load(folder(id) + file);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.shared = true;   // Shared by every figure of this person; never disposed with a scene
  return t;
};

// Physically based materials in place of the file's plain ones: skin with a warm sheen where light grazes
// it (as light scattered under real skin does), soft cloth, and hair and lashes cut out by their coverage
function realisticMaterials(id: string, mesh: THREE.Mesh) {
  const old = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
  mesh.material = old.map(m => {
    if (/_head$/.test(m.name)) return new THREE.MeshPhysicalMaterial({
      name: m.name, map: texture(id, 'head_color.jpg', true), normalMap: texture(id, 'head_normal.jpg', false),
      roughness: 0.5, specularIntensity: 0.45, sheen: 0.12, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffc4b0)
    });
    if (/_opacity$/.test(m.name)) return new THREE.MeshStandardMaterial({
      name: m.name, map: texture(id, 'opacity_color.jpg', true), alphaMap: texture(id, 'opacity_alpha.jpg', false),
      alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6
    });
    return new THREE.MeshPhysicalMaterial({
      name: m.name, map: texture(id, 'body_color.jpg', true), normalMap: texture(id, 'body_normal.jpg', false),
      roughness: 0.72, sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff)
    });
  });
  old.forEach(m => m.dispose());
}

// Keeps only the expression shapes in SHAPES, in that order
function keepShapes(mesh: THREE.Mesh) {
  const dictionary = mesh.morphTargetDictionary, geometry = mesh.geometry;
  if (!dictionary || !geometry.morphAttributes.position) return;
  const names = Object.keys(dictionary);
  const kept: Record<string, number> = {};
  const indices: number[] = [];
  (Object.keys(SHAPES) as Shape[]).forEach(shape => {
    const name = names.find(n => n.endsWith('_' + SHAPES[shape]));   // e.g. 'blendShape1.AK_09_EyeBlinkLeft'
    if (name === undefined) return;
    kept[shape] = indices.length;
    indices.push(dictionary[name]);
  });
  (['position', 'normal'] as const).forEach(attribute => {
    const all = geometry.morphAttributes[attribute];
    if (all) geometry.morphAttributes[attribute] = indices.map(i => all[i]);
  });
  mesh.morphTargetDictionary = kept;
  mesh.morphTargetInfluences = indices.map(() => 0);
}

function loadTemplate(id: string): Promise<Template> {
  const cached = templates.get(id);
  if (cached) return cached;
  // The model refers to its original TGA textures: those requests are answered with empty textures here,
  // since realisticMaterials puts the web versions in place
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, { load: () => new THREE.Texture(), setPath() { return this; } } as any);
  const pending = new FBXLoader(manager).loadAsync(folder(id) + 'facial.fbx').then(scene => {
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      realisticMaterials(id, mesh);
      keepShapes(mesh);
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
      clips: scene.animations.filter(c => c.duration > 0.1),   // The file's empty 'Take 001' is not an animation
      turn,
      height: box.max.y - box.min.y,
      offset: new THREE.Vector3(-hips.x, -box.min.y, -hips.z)
    };
  });
  // A failed load is not cached, so a later scene can try again
  pending.catch(() => templates.delete(id));
  templates.set(id, pending);
  return pending;
}

// variant picks which person of the kind (0, 1, ...); scenes give each figure of a kind the next one
export function createHuman(kind: HumanKind, height: number | undefined, onReady: (human: Human) => void, variant = 0): Human {
  const people = PEOPLE[kind];
  const person = people[((Math.floor(variant) % people.length) + people.length) % people.length];
  const object = new THREE.Group();
  object.name = 'human_' + kind;
  let bones: Record<string, THREE.Bone> = {};
  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let current: THREE.AnimationAction | null = null;
  const rest: { bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), q4 = new THREE.Quaternion();

  // The face: an expression that suits the pose, and a blink every few seconds (each person on their own
  // rhythm). It is drawn from the wall clock, so people keep blinking while the simulation is paused.
  let expression: Expression = EXPRESSIONS.calm;
  const blinkOffset = Math.random() * 10, blinkEvery = 3.2 + Math.random() * 1.6;
  const blinkAmount = (seconds: number) => {
    const t = ((seconds + blinkOffset) % blinkEvery);
    if (t > 0.22) return 0;
    return t < 0.07 ? t / 0.07 : 1 - (t - 0.07) / 0.15;   // Lids close quickly and open a little slower
  };
  const showFace = (mesh: THREE.Mesh) => {
    const dictionary = mesh.morphTargetDictionary, influences = mesh.morphTargetInfluences;
    if (!dictionary || !influences) return;
    const blink = blinkAmount(performance.now() / 1000);
    (Object.keys(SHAPES) as Shape[]).forEach(shape => {
      const i = dictionary[shape];
      if (i === undefined) return;
      const base = expression[shape] || 0;
      influences[i] = shape === 'blinkLeft' || shape === 'blinkRight' ? Math.max(base, blink) : base;
    });
  };

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
      expression = (options.face && EXPRESSIONS[options.face])
        || (name === 'push' || name === 'throw' || name === 'kick' ? EXPRESSIONS.effort : name === 'run' ? EXPRESSIONS.breathing : EXPRESSIONS.calm);
      const both = (f: (side: string, x: number) => void) => { f('Left', 1); f('Right', -1); };
      const armsDown = () => both((s, x) => { h.aim(s + 'Arm', [0.12 * x, -1, 0.04]); h.aim(s + 'ForeArm', [0.06 * x, -1, 0.18]); });
      // Standing at ease: about fourteen breaths a minute lift the chest, the weight drifts slowly from one
      // leg to the other, and the head is held a little forward. Driven by the scene's clock when given.
      const atEase = () => {
        const clock = options.time !== undefined ? time : performance.now() / 1000;
        const breath = Math.sin(clock * Math.PI * 2 / 4.3), sway = Math.sin(clock * Math.PI * 2 / 9.5);
        h.rest();
        h.aim('Spine', [sway * 0.02, 1, 0.01]);
        h.aim('Spine2', [0, 1, 0.03 + breath * 0.015]);
        h.aim('Neck', [-sway * 0.02, 1, 0.12]);
        both((s, x) => {
          h.aim(s + 'Arm', [0.11 * x, -1, 0.05 - breath * 0.01]);
          h.aim(s + 'ForeArm', [0.05 * x, -1, 0.2]);
          h.aim(s + 'UpLeg', [0.07 * x + sway * 0.03, -1, 0.0]);
        });
      };
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
          if (h.clips.includes('Idle')) h.play('Idle', time); else atEase();
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
          atEase();
      }
    }
  };

  loadTemplate(person.id).then(t => {
    const model = cloneSkinned(t.scene);
    model.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Own materials, so rebuilding the scene (which disposes them) leaves other figures alone
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone();
      mesh.castShadow = true;
      mesh.frustumCulled = false; // Animated skin can leave its rest-pose bounds
      if (mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences = mesh.morphTargetInfluences.slice();   // This figure's own face
        mesh.onBeforeRender = () => showFace(mesh);
      }
    });
    const scale = (height && height > 0 ? height : person.height) / t.height;
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
    human.setPose('stand');   // Never shown in the model's arms-out rest pose, even before the scene poses it
    onReady(human);
  }).catch(e => console.warn(`[Humans] Could not load the ${kind} model (${person.id}):`, e));

  return human;
}
