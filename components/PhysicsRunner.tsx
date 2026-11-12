import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SimulationData, SimulationSlider } from '../types';
import { FloorBounds, findFloor, pickMainBody, addBoundaryWalls, enforceBounds, clampDragGoal } from '../lib/bounds';
import { simAudio, impactStrength, inferSoundMaterial, isSoundMaterial, AMBIENCES, Ambience, SoundMaterial, ImpactInfo } from '../lib/audio';
import { SweepBroadphase } from '../lib/broadphase';
import { compileScene, createRope } from '../lib/sandbox';
import { installTextbookPhysics } from '../lib/textbookPhysics';
import { frameShot, shotPoints, sceneBox, fitWholeScene } from '../lib/framing';
import { createHuman, isHumanKind, Human } from '../lib/humans';
import { realMaterial, addGround } from '../lib/sceneKit';
import { Timeline } from '../lib/timeline';
import { ThemeController, THEMES, ThemeId, DEFAULT_SCENE_THEME } from '../lib/themes';
import { buildEnvironment, chooseSetting, EnvHandle, EnvironmentSpec, SETTING_PLACES } from '../lib/environments';
import { DEMOS } from '../lib/demos';
import { SceneRecorder, recordingSupported, downloadBlob, timestampName } from '../lib/capture';
import { bodyStats, hasEditableShapes, isConstrained, scaleBody, duplicateBody, getBodyBounce, setBodyBounce } from '../lib/objects';
import { safeFileName } from '../lib/library';
import { SimApi } from '../lib/simApi';
import { ObjectInspector, ObjectEditInfo } from './ObjectInspector';
import { ComparePanel } from './ComparePanel';
import { Stopwatch } from './Stopwatch';
import { Sliders, RotateCcw, MoveDiagonal, Play, Pause, Sun, Square, Circle, Volume2, VolumeX, MousePointerClick, Gauge, Vibrate, ZoomIn, ZoomOut, Maximize, Minimize, Aperture, LocateFixed, Video, Camera, Ruler, Timer, MoveUpRight, PictureInPicture2, HelpCircle, Eye, Crosshair, PanelRightClose, PanelRightOpen, Sparkles, Check, Hand, ChevronLeft, ChevronRight } from 'lucide-react';

interface PhysicsRunnerProps {
  simulationData: SimulationData;
  onError?: (error: string) => void;
  // The clip this simulation was generated from, when there is one (enables the side-by-side view)
  sourceVideoUrl?: string | null;
  onOpenHelp?: () => void;
  onOpenChat?: () => void;   // Opens the assistant (its own button is hidden while a simulation is shown)
  aiBusy?: boolean;          // The AI is changing this scene right now
  aiOpen?: boolean;          // The "Change with AI" bar is open
  footer?: React.ReactNode;  // Shown under the view and its status line (the "Change with AI" bar)
}

interface SimObject {
    mesh: THREE.Object3D;
    body: CANNON.Body;
    label: string;
}

type CameraView = 'home' | 'top' | 'front' | 'side';

// Timeline: one recorded frame for every this many physics steps (30 per simulated second)
const RECORD_EVERY = 2;
const MAX_VECTOR_ARROWS = 40;
const noRaycast = () => {};

// Dragging: the grabbed body is steered toward the cursor by setting its velocity each physics step.
// (A rigid joint to a teleporting anchor made objects swing, spin and get flung on release.)
const DRAG_STIFFNESS = 14;      // 1/s: how quickly the body closes the gap to the cursor
const DRAG_MAX_SPEED = 45;      // units/s while being dragged
const RELEASE_MAX_SPEED = 12;   // units/s kept on release, so a flick tosses gently instead of launching

// Camera zoom
const ZOOM_STEP = 0.8;          // Each press of + moves the camera to 80% of its distance
const ZOOM_MIN_DISTANCE = 3;
const ZOOM_MAX_DISTANCE = 3000;   // Far enough to see a whole scene as a speck; fog and clipping follow the camera out
const FRAMING_MAX_DISTANCE = 220; // The opening shot never starts further away than this

const SPEED_MIN = 0.1;
const SPEED_MAX = 3;
const SPEED_PRESETS = [0.25, 0.5, 1, 2];
const clampSpeed = (v: number) => Math.min(Math.max(v, SPEED_MIN), SPEED_MAX);

type SettingsTab = 'physics' | 'environment';

// --- One renderer for the whole session ---
// Making a WebGL renderer and compiling its shaders takes a second or more, which was most of the wait
// after picking a demo. So the renderer, its post-processing chain and its lighting environments are made
// once and handed from scene to scene, and compiled shaders carry over.
interface Stage {
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer | null;
    renderPass: RenderPass | null;
    ao: GTAOPass | null;
    pmrem: THREE.PMREMGenerator;
    environments: Map<string, THREE.Texture>;   // Lighting environments by sky and horizon colour
    // Rendering quality this device can sustain (see the render loop). Remembered across scenes, so a
    // slow device does not stutter again on every scene before it steps down.
    fxLevel: number;
}
let stage: Stage | null = null;

function getStage(): Stage {
    if (!stage) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        stage = { renderer, composer: null, renderPass: null, ao: null, pmrem: new THREE.PMREMGenerator(renderer), environments: new Map(), fxLevel: 2 };
    }
    return stage;
}
const MAX_ENVIRONMENTS = 24;
// Where the camera was when the last view closed, so an edited scene can open on the same view
let lastView: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

// Frees the GPU memory of a scene that is no longer shown. Called a little after the next scene has been
// drawn, so shaders both scenes use stay compiled. The realism kit's shared textures are kept.
function disposeScene(root: THREE.Object3D) {
    root.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (!child.material) return;
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m: any) => {
            Object.values(m).forEach((value: any) => {
                if (value && value.isTexture && !value.userData?.shared) value.dispose();
            });
            m.dispose();
        });
    });
}

// A mass slider must not reach zero: a moving body with no mass is frozen wherever it happens to be
const MIN_SLIDER_MASS = 0.01;

// Applies one slider value to the physics, the same way when the scene is built and when the user moves
// it ('scale' is the speed, handled by the Speed control). The world's friction and bounciness are
// applied only when the user moves them: at build time the scene's own contact rules stand.
function applySlider(world: CANNON.World, objects: SimObject[], slider: SimulationSlider, value: number, userMoved: boolean) {
    if (slider.property === 'scale') return;
    if (slider.targetLabel === 'world') {
        if (slider.property === 'gravity') world.gravity.y = -Math.abs(value);
        if (slider.property === 'damping') world.bodies.forEach(b => { if (b.mass > 0) b.linearDamping = value; });
        if (userMoved && (slider.property === 'restitution' || slider.property === 'friction')) {
            // The default contact rule covers every pair the scene gave no rule of its own: most of them
            world.defaultContactMaterial[slider.property] = value;
            world.contactmaterials.forEach(cm => { cm[slider.property as 'friction' | 'restitution'] = value; });
        }
        return;
    }
    // A slider also drives numbered parts: 'chain' moves 'chain_0', 'chain_1', ...
    objects.filter(o => o.label === slider.targetLabel || o.label.startsWith(slider.targetLabel + '_')).forEach(({ body }) => {
        if (slider.property === 'mass') {
            body.mass = body.type === CANNON.Body.DYNAMIC ? Math.max(value, MIN_SLIDER_MASS) : value;
            body.updateMassProperties();
        } else if (slider.property === 'damping') {
            body.linearDamping = value;
            body.angularDamping = value;
        }
    });
}

export const PhysicsRunner: React.FC<PhysicsRunnerProps> = ({ simulationData, onError, sourceVideoUrl, onOpenHelp, onOpenChat, aiBusy, aiOpen, footer }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // The scene on show, for the physics world (created once) to read
  const simulationDataRef = useRef(simulationData);
  simulationDataRef.current = simulationData;

  // --- TIMELINE (replay / scrubbing) ---
  const timelineRef = useRef(new Timeline());
  const liveStepRef = useRef(false);        // True only while the live physics step runs (what gets recorded)
  const stepCountRef = useRef(0);
  const timelineDirtyRef = useRef(false);   // Something was edited at the moment shown: history after it is void
  const stepRequestRef = useRef(0);         // Frame step asked for while paused (+1 / -1)
  const scrubResumeRef = useRef(false);     // Scrubbing paused a running simulation; resume when it ends
  const playbackRateRef = useRef(1);
  const runFrameCallbacksRef = useRef<() => void>(() => {});

  // --- CAPTURE ---
  const recorderRef = useRef(new SceneRecorder());
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const screenshotRequestRef = useRef(false);
  const canRecord = recordingSupported();
  const [toast, setToast] = useState<string | null>(null);

  // --- VIEW TOOLS ---
  const themeControllerRef = useRef<ThemeController | null>(null);
  // Every scene (the demos and the ones people generate) opens on the space backdrop and lighting; the
  // scene's own look stays one click away under "Scene" in the settings
  const themeRef = useRef<ThemeId>(DEFAULT_SCENE_THEME);
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_SCENE_THEME);
  const [showVectors, setShowVectors] = useState(false);
  const showVectorsRef = useRef(false);
  const [rulerMode, setRulerMode] = useState(false);
  const rulerModeRef = useRef(false);
  const rulerPointsRef = useRef<THREE.Vector3[]>([]);
  const rulerLabelRef = useRef<HTMLDivElement>(null);
  const [rulerInfo, setRulerInfo] = useState<{ points: number; distance: number; dx: number; dy: number; dz: number }>({ points: 0, distance: 0, dx: 0, dy: 0, dz: 0 });
  const refreshRulerRef = useRef<() => void>(() => {});
  const [showStopwatch, setShowStopwatch] = useState(false);
  const [showCompare, setShowCompare] = useState(true);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const cameraGoalRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const [follow, setFollow] = useState(false);
  const followRef = useRef(false);
  const selectedObjRef = useRef<SimObject | null>(null);
  // The actions behind the keyboard shortcuts; refreshed on every render (see the end of this component)
  const noop = () => {};
  const actionsRef = useRef({
      togglePause: noop, reset: noop, stepBack: noop, stepForward: noop, vectors: noop, ruler: noop,
      screenshot: noop, record: noop, follow: noop, escape: noop, arrange: noop, view: (_view: CameraView) => {}
  });
  // The world's own event listeners as the app set them up, before any scene code added its own
  const baseListenersRef = useRef<Record<string, Function[]> | null>(null);
  
  // Three.js Refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rafRef = useRef<number | null>(null);
  
  // Lighting Refs
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);

  // Physics Refs
  const worldRef = useRef<CANNON.World | null>(null);
  const objectsRef = useRef<SimObject[]>([]);
  const frameCallbacksRef = useRef<(() => void)[]>([]);
  // Simulation code can react to a click on an object; returning true skips the inspector
  const clickCallbacksRef = useRef<((label: string) => boolean | void)[]>([]);
  // Live numbers the scene code reports (setReadout), drawn into readoutPanelRef a few times a second
  const readoutRef = useRef<{ title: string; rows: (string | [string, string])[] } | null>(null);
  const readoutDirtyRef = useRef(false);
  const readoutPanelRef = useRef<HTMLDivElement>(null);

  // New: Track ALL meshes generated by AI (even visual ones without physics) for clean resets
  const generatedMeshesRef = useRef<THREE.Object3D[]>([]);
  
  const timeScaleRef = useRef<number>(1.0);

  // Sound: what each registered body is made of, the scene's ambience, and smoothed continuous levels
  const soundInfoRef = useRef<WeakMap<CANNON.Body, { sound: SoundMaterial }>>(new WeakMap());
  const ambienceRef = useRef<Ambience>('none');
  const rollLevelRef = useRef({ level: 0, brightness: 0, whoosh: 0 });
  // Vibration: camera shake energy (0..1), fed by impacts and decaying every frame
  const shakeRef = useRef(0);
  const vibrationRef = useRef(true);
  // Physics-clock time at which the current scene was built (the world's clock keeps running across resets)
  const sceneStartTimeRef = useRef(0);

  // Boundaries: the floor found in the scene and the main object that must stay on it
  const boundsRef = useRef<FloorBounds | null>(null);
  const mainBodyRef = useRef<CANNON.Body | null>(null);

  // Camera: zoom target distance (null when not animating) and the view to return to
  const zoomGoalRef = useRef<number | null>(null);
  const homeViewRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  // Pointer Interaction Refs
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const planeRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  // The body being dragged, where the cursor is in the world, and the grab point relative to the body
  const dragStateRef = useRef<{ body: CANNON.Body; target: CANNON.Vec3; offset: CANNON.Vec3; pointerId: number } | null>(null);
  const dragLineRef = useRef<THREE.Line | null>(null);
  
  // Track clicks to differentiate from drags
  const clickStartRef = useRef<{ x: number; y: number; obj: SimObject | null; ruler?: boolean } | null>(null);

  // State
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({});
  // Ref to track slider values without triggering re-renders or dependency updates for resetSimulation
  const sliderValuesRef = useRef<Record<string, number>>({});
  
  // Click-to-start: for startMode 'click' the scene is built but time stays frozen until the user clicks
  const [awaitingStart, setAwaitingStart] = useState(false);
  const awaitingStartRef = useRef(false);
  const beginSimulationRef = useRef<() => void>(() => {});
  // Velocities captured when pausing, so resuming continues the motion instead of restarting from rest
  const pausedVelocitiesRef = useRef<Map<CANNON.Body, { v: CANNON.Vec3; w: CANNON.Vec3 }> | null>(null);

  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // Arrange mode: time is frozen and objects are placed by hand. Only the object being held moves, and it
  // stays exactly where it is let go; when the mode ends the simulation carries on from the arrangement.
  const [arranging, setArranging] = useState(false);
  const arrangeRef = useRef(false);
  const arrangePausedItRef = useRef(false);   // Arrange mode paused the simulation (so leaving it resumes)
  // After a release in Arrange mode, a few silent steps let the object's ropes and joints settle exactly taut
  const arrangeSettleRef = useRef<{ body: CANNON.Body; steps: number } | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  // Camera shake + device vibration. On by default; people whose system asks for reduced motion
  // get a much gentler shake (see shakeScaleRef) and can switch it off in Settings > Scene.
  const [vibration, setVibration] = useState(true);
  const shakeScaleRef = useRef(
      typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1);
  // Playback speed (1 = real time). Mirrors timeScaleRef, which the physics loop reads.
  const [speed, setSpeed] = useState(1);

  // Full screen and its realistic presentation (natural lighting and reflections, drifting camera)
  const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Realistic mode shows the scene where it really happens (a desk in a study, a park, a warehouse...):
  // the surface it stands on, the place around it and things placed nearby. See lib/environments.ts.
  // Off until chosen; the choice is remembered.
  const [realisticEnabled, setRealisticEnabledState] = useState(() => { try { return localStorage.getItem('simulaitor.realistic') === '1'; } catch { return false; } });
  const realisticRef = useRef(realisticEnabled);
  const settingRef = useRef<EnvHandle | null>(null);
  const setupBoxRef = useRef<THREE.Box3 | null>(null);    // The set-up as built, before anything moved
  const groundKindRef = useRef<string | null>(null);      // What the scene passed to addGround, if anything
  const clearSetting = () => {
      if (settingRef.current) settingRef.current.dispose();
      settingRef.current = null;
  };
  // The scene's own setting, else its demo's (a saved copy of a demo), else one chosen from what it shows
  const settingSpec = (): EnvironmentSpec => {
      const own = simulationData.environment || DEMOS.find(d => d.data.code === simulationData.code)?.data.environment;
      if (own) return own as EnvironmentSpec;
      const scenario = /scenario:\s*(.+)/i.exec(simulationData.thought_process || '');
      const text = [simulationData.title, simulationData.request, scenario && scenario[1]].filter(Boolean).join(' ');
      return chooseSetting(text, groundKindRef.current, !!boundsRef.current);
  };
  // (Re)builds the setting when Realistic mode is on; returns where the scene now is, for the message
  const buildSetting = (): string => {
      clearSetting();
      const scene = sceneRef.current, sun = dirLightRef.current, ambient = ambientLightRef.current;
      const camera = cameraRef.current, controls = controlsRef.current, box = setupBoxRef.current;
      if (!realisticRef.current || !scene || !sun || !ambient || !camera || !controls || !box || box.isEmpty()) return '';
      const bounds = boundsRef.current;
      try {
          settingRef.current = buildEnvironment(settingSpec(), {
              scene, sun, ambient, box,
              top: bounds ? bounds.top : box.min.y,
              floorSize: bounds ? { x: bounds.maxX - bounds.minX, z: bounds.maxZ - bounds.minZ } : null,
              cameraDistance: camera.position.distanceTo(controls.target)
          });
      } catch (e) {
          console.error('[Realistic] The real-world setting could not be built:', e);
          settingRef.current = null;
      }
      return settingRef.current ? SETTING_PLACES[settingRef.current.setting] : '';
  };
  // Called from resetSimulation, which is memoised, so it always reaches the current versions
  const settingFnsRef = useRef({ clear: clearSetting, build: buildSetting });
  settingFnsRef.current = { clear: clearSetting, build: buildSetting };
  // Changes the backdrop or lighting under the setting: it comes off first and goes back on top after
  const underSetting = (change: () => void) => {
      const had = !!settingRef.current;
      clearSetting();
      change();
      if (had) buildSetting();
  };
  const setRealisticEnabled = (on: boolean) => {
      realisticRef.current = on;
      setRealisticEnabledState(on);
      try { localStorage.setItem('simulaitor.realistic', on ? '1' : '0'); } catch {}
      if (!on) {
          clearSetting();
          setToast('Standard view');
          return;
      }
      const place = buildSetting();
      setToast(place ? `Realistic: shown ${place}` : 'This scene already shows its own real setting');
  };

  // Selection / Editing. The selected object itself lives in selectedObjRef (labels are not unique:
  // every brick in a wall shares one); the state holds what the inspector shows for it.
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [editInfo, setEditInfo] = useState<ObjectEditInfo | null>(null);

  // The side panel (readout, inspector, tools, settings) sits beside the view, never over it.
  // Open by default where there is room for it; the user's choice is kept from scene to scene.
  const [showSettings, setShowSettings] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1100);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('physics');
  const [lightSettings, setLightSettings] = useState({
      intensity: 1.5,
      ambient: 0.4,
      azimuth: 45, 
      elevation: 60 
  });
  const [bgColor, setBgColor] = useState('#151027');

  const inspectorRef = useRef<HTMLDivElement>(null);
  // The whole stage (toolbar, view, side panel, status line): what goes full screen
  const stageRef = useRef<HTMLDivElement>(null);

  // The toolbar's middle group scrolls sideways when the window is narrow. Arrows at its edges (and a
  // fade) show that more tools are there, so none is ever hidden without a sign.
  const toolsRef = useRef<HTMLDivElement>(null);
  const [toolsOverflow, setToolsOverflow] = useState({ left: false, right: false });
  const measureTools = useCallback(() => {
      const el = toolsRef.current;
      if (!el) return;
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setToolsOverflow(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
      const el = toolsRef.current;
      if (!el) return;
      const observer = new ResizeObserver(measureTools);
      observer.observe(el);
      el.addEventListener('scroll', measureTools, { passive: true });
      return () => { observer.disconnect(); el.removeEventListener('scroll', measureTools); };
  }, [measureTools]);
  // Buttons come and go (recording, compare), so measure again after each render; it changes state only on a real change
  useEffect(measureTools);
  const scrollTools = (direction: 1 | -1) => toolsRef.current?.scrollBy({ left: direction * 180, behavior: 'smooth' });

  // --- SOUND & VIBRATION ---
  // The synthesiser lives in lib/audio.ts and outlives this component, so these only pass settings on.
  useEffect(() => { simAudio.setMuted(muted); }, [muted]);
  useEffect(() => { simAudio.setVolume(volume); }, [volume]);
  useEffect(() => {
      vibrationRef.current = vibration;
      simAudio.setHaptics(vibration);
      if (!vibration) shakeRef.current = 0;
  }, [vibration]);

  // What one audible collision does: sound, camera shake and device vibration.
  // Used live and again when the timeline replays the same collision.
  const playImpact = useCallback((info: ImpactInfo, speed: number, mass: number) => {
      simAudio.impact(info);
      if (vibrationRef.current) {
          // Shake scales with how heavy the collision is, so a wrecking ball rattles the view and a pin does not
          const heft = Math.min(Math.max(Math.log10(1 + mass) / 2.7, 0), 1);
          shakeRef.current = Math.min(1, shakeRef.current + Math.min(speed / 18, 1) * heft);
          simAudio.vibrate(impactStrength(speed, mass));
      }
  }, []);

  // Registers what a body sounds like and reports its collisions to the sound and vibration systems.
  // Stable across renders (it only touches refs), so the scene builder can safely hold on to it.
  const registerSound = useCallback((body: CANNON.Body, sound: SoundMaterial) => {
      const info = soundInfoRef.current;
      const alreadyListening = info.has(body);
      info.set(body, { sound });
      if (alreadyListening) return;

      body.addEventListener('collide', (e: any) => {
          const other: CANNON.Body | undefined = e.body;
          const contact = e.contact;
          if (!other || !contact) return;
          const mine = info.get(body);
          const theirs = info.get(other);
          if (!mine) return;
          // Both sides of a pair receive this event; let the lower id report it so it plays once
          if (theirs && other.id < body.id) return;

          const speed = Math.abs(contact.getImpactVelocityAlongNormal());
          if (speed < 1) return; // Resting and settling contacts are silent

          // Only real impacts make noise:
          const w = body.world;
          if (!w) return;
          // - objects placed a hair above their support drop onto it in the first moments of a scene
          if (w.time - sceneStartTimeRef.current < 0.3 && speed < 6) return;
          // - bodies joined by a rope, hinge or chain link are not striking each other
          if (w.constraints.some(c => (c.bodyA === body && c.bodyB === other) || (c.bodyA === other && c.bodyB === body))) return;

          const otherMoves = other.type === CANNON.Body.DYNAMIC && other.mass > 0;
          const mass = otherMoves ? (body.mass * other.mass) / (body.mass + other.mass) : body.mass;
          const impact: ImpactInfo = {
              a: mine.sound,
              b: theirs ? theirs.sound : null,
              speed,
              mass,
              sizeA: body.boundingRadius,
              sizeB: other.boundingRadius
          };
          playImpact(impact, speed, mass);
          // Remembered on the timeline so a replay sounds the same
          if (liveStepRef.current) {
              timelineRef.current.addEvent({ t: w.time - sceneStartTimeRef.current, info: impact, speed, mass });
          }
      });
  }, [playImpact]);

  // Remembers every body's velocity. Dragging while paused zeroes velocities, so they are put back on resume.
  const captureVelocities = () => {
      const world = worldRef.current;
      if (!world) return;
      const snapshot = new Map<CANNON.Body, { v: CANNON.Vec3; w: CANNON.Vec3 }>();
      world.bodies.forEach(b => snapshot.set(b, { v: b.velocity.clone(), w: b.angularVelocity.clone() }));
      pausedVelocitiesRef.current = snapshot;
  };

  const restoreVelocities = () => {
      const world = worldRef.current;
      if (!world || !pausedVelocitiesRef.current) return;
      pausedVelocitiesRef.current.forEach((saved, b) => {
          if (b.world !== world) return; // Removed while paused
          b.velocity.copy(saved.v);
          b.angularVelocity.copy(saved.w);
      });
  };

  const setPausedState = (next: boolean) => {
    if (next === pausedRef.current) return;
    if (next) {
        captureVelocities();
    } else {
        restoreVelocities();
        pausedVelocitiesRef.current = null;
    }
    setPaused(next);
    pausedRef.current = next;
  };

  const togglePause = () => {
    simAudio.unlock();
    scrubResumeRef.current = false;
    // Play while arranging: leave Arrange mode and run from the arrangement (starting the scene if it waits for a click)
    if (arrangeRef.current) {
        setArrangeMode(false);
        setPausedState(false);
        beginSimulationRef.current();
        return;
    }
    setPausedState(!pausedRef.current);
    // Don't deselect label on pause, it's annoying for editing
  };

  // --- ARRANGE MODE ---
  // Entering freezes time (pausing keeps every body's velocity aside). Leaving resumes only if entering
  // paused it, and every velocity comes back except those of the objects moved by hand, which start from rest.
  // A click-to-start scene can be arranged before it starts: clicks then grab objects instead of starting it.
  const setArrangeMode = (on: boolean) => {
    if (on === arrangeRef.current) return;
    if (on) {
        if (rulerModeRef.current) setRuler(false);   // One tool at a time
        arrangePausedItRef.current = !pausedRef.current;
        setPausedState(true);
    } else {
        dragStateRef.current = null;
        arrangeSettleRef.current = null;
        if (arrangePausedItRef.current) setPausedState(false);
        arrangePausedItRef.current = false;
    }
    arrangeRef.current = on;
    setArranging(on);
  };
  const toggleArrange = () => setArrangeMode(!arrangeRef.current);

  // --- TIMELINE CONTROLS ---
  // Starts the recording again from the present moment (after objects were added, removed or resized,
  // which the earlier frames know nothing about).
  const restartTimeline = () => {
      const world = worldRef.current;
      if (!world) return;
      const tl = timelineRef.current;
      tl.clear();
      tl.record(world, world.time - sceneStartTimeRef.current);
      timelineDirtyRef.current = false;
      stepCountRef.current = 0;
      if (pausedRef.current) captureVelocities();
  };

  // An edit at the moment shown makes whatever was recorded after it untrue
  const markEdited = () => { timelineDirtyRef.current = true; };

  const simApiRef = useRef<SimApi | null>(null);
  if (!simApiRef.current) {
      // Built once: everything it reads is a ref, so the panels can hold on to it
      simApiRef.current = {
          clock: () => {
              const tl = timelineRef.current, world = worldRef.current;
              const awaiting = awaitingStartRef.current;
              const now = world ? world.time - sceneStartTimeRef.current : 0;
              const live = tl.atEnd;
              const time = awaiting ? 0 : live ? Math.max(now, tl.startTime) : tl.playTime;
              return {
                  time,
                  start: awaiting ? 0 : tl.startTime,
                  end: awaiting ? 0 : live ? time : tl.endTime,
                  live,
                  running: !awaiting && !pausedRef.current,
                  awaiting,
                  rate: playbackRateRef.current
              };
          },
          seek: (time: number) => {
              const world = worldRef.current, tl = timelineRef.current;
              if (!world || tl.isEmpty || awaitingStartRef.current) return;
              tl.seek(world, time);
              timelineDirtyRef.current = false; // Any unsaved edit belonged to the moment we just left
              if (pausedRef.current) captureVelocities();
              runFrameCallbacksRef.current();
          },
          beginScrub: () => {
              if (awaitingStartRef.current || pausedRef.current) return;
              scrubResumeRef.current = true;
              setPausedStateRef.current(true);
          },
          endScrub: () => {
              if (!scrubResumeRef.current) return;
              scrubResumeRef.current = false;
              setPausedStateRef.current(false);
          },
          step: (direction: 1 | -1) => {
              if (awaitingStartRef.current) return;
              scrubResumeRef.current = false;
              setPausedStateRef.current(true);
              stepRequestRef.current = direction;
          },
          replay: () => {
              const world = worldRef.current, tl = timelineRef.current;
              if (!world || tl.isEmpty || awaitingStartRef.current) return;
              scrubResumeRef.current = false;
              tl.seek(world, tl.startTime);
              timelineDirtyRef.current = false;
              runFrameCallbacksRef.current();
              if (pausedRef.current) {
                  captureVelocities();
                  setPausedStateRef.current(false);
              }
          },
          stats: () => {
              const obj = selectedObjRef.current, world = worldRef.current;
              if (!obj || !world || obj.body.world !== world) return null;
              return bodyStats(obj.body, world.gravity, boundsRef.current ? boundsRef.current.top : 0);
          }
      };
  }
  const simApi = simApiRef.current;
  const setPausedStateRef = useRef(setPausedState);
  setPausedStateRef.current = setPausedState;

  // Releases a click-to-start simulation. Safe to call when it is already running.
  const beginSimulation = () => {
    if (!awaitingStartRef.current) return;
    awaitingStartRef.current = false;
    setAwaitingStart(false);
    simAudio.unlock(); // No start tick: the first sound should be the simulation itself
  };
  beginSimulationRef.current = beginSimulation;

  const handleSoundToggle = () => {
      simAudio.unlock();
      setMuted(!muted);
  };

  // --- CAMERA ZOOM ---
  // Buttons and keys set a goal distance; the render loop glides the camera to it.
  const zoomBy = (factor: number) => {
      const controls = controlsRef.current, camera = cameraRef.current;
      if (!controls || !camera) return;
      const current = zoomGoalRef.current ?? camera.position.distanceTo(controls.target);
      zoomGoalRef.current = Math.min(Math.max(current * factor, ZOOM_MIN_DISTANCE), ZOOM_MAX_DISTANCE);
  };
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  // --- CAMERA VIEWS ---
  // Preset views glide the camera to a new position around whatever it is currently looking at.
  const setCameraView = (view: CameraView) => {
      const controls = controlsRef.current, camera = cameraRef.current, home = homeViewRef.current;
      if (!controls || !camera) return;
      zoomGoalRef.current = null;
      if (view === 'home') {
          if (!home) return;
          // Leaving "follow" as well: home is a fixed view of the scene
          followRef.current = false;
          setFollow(false);
          cameraGoalRef.current = { position: home.position.clone(), target: home.target.clone() };
          return;
      }
      const target = controls.target.clone();
      const distance = Math.min(Math.max(camera.position.distanceTo(target), ZOOM_MIN_DISTANCE), ZOOM_MAX_DISTANCE);
      const position = target.clone();
      if (view === 'top') position.add(new THREE.Vector3(0, distance, 0.01));          // A hair off vertical keeps "up" defined
      else if (view === 'front') position.add(new THREE.Vector3(0, distance * 0.18, distance * 0.984));
      else position.add(new THREE.Vector3(distance * 0.984, distance * 0.18, 0));
      cameraGoalRef.current = { position, target };
  };
  const resetView = () => setCameraView('home');

  const toggleFollow = () => {
      const next = !followRef.current;
      followRef.current = next;
      setFollow(next);
      if (next) cameraGoalRef.current = null;
  };

  // --- CAPTURE: VIDEO AND STILLS ---
  const fileBase = safeFileName(simulationData.title || 'simulation');

  const showToast = (message: string) => setToast(message);
  useEffect(() => {
      if (!toast) return;
      const timer = window.setTimeout(() => setToast(null), 3200);
      return () => window.clearTimeout(timer);
  }, [toast]);

  const stopRecording = async () => {
      const recorder = recorderRef.current;
      if (!recorder.recording) return;
      setRecording(false);
      const result = await recorder.stop();
      if (result) {
          downloadBlob(result.blob, timestampName(fileBase, result.ext));
          showToast(`Video saved to your downloads (.${result.ext})`);
      } else {
          showToast('Nothing was recorded');
      }
  };
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  const toggleRecording = () => {
      const recorder = recorderRef.current;
      if (recorder.recording) { stopRecording(); return; }
      const canvas = rendererRef.current ? rendererRef.current.domElement : null;
      if (!canvas) return;
      try {
          simAudio.unlock();
          recorder.start(canvas, simAudio.captureStream());
          setRecordSeconds(0);
          setRecording(true);
      } catch (e: any) {
          showToast(e && e.message ? e.message : 'Recording could not start');
      }
  };

  useEffect(() => {
      if (!recording) return;
      const timer = window.setInterval(() => setRecordSeconds(Math.floor((performance.now() - recorderRef.current.startedAt) / 1000)), 500);
      return () => window.clearInterval(timer);
  }, [recording]);

  const takeScreenshot = () => { screenshotRequestRef.current = true; };

  // --- VIEW TOOLS: VECTORS, RULER ---
  const toggleVectors = () => {
      const next = !showVectorsRef.current;
      showVectorsRef.current = next;
      setShowVectors(next);
  };

  const setRuler = (on: boolean) => {
      if (on && arrangeRef.current) setArrangeMode(false);   // One tool at a time
      rulerModeRef.current = on;
      setRulerMode(on);
      if (!on) {
          rulerPointsRef.current = [];
          refreshRulerRef.current();
      }
  };

  // --- ENVIRONMENT THEME ---
  const changeTheme = (id: ThemeId) => {
      themeRef.current = id;
      setTheme(id);
      underSetting(() => { if (themeControllerRef.current) themeControllerRef.current.apply(id, cameraRef.current ?? undefined); });
  };

  // --- FULL SCREEN & CINEMATIC MODE ---
  const toggleFullscreen = () => {
      const el = stageRef.current;
      if (!el || !fullscreenSupported) return;
      simAudio.unlock();
      if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
      } else {
          // Rejected when the browser or an embedding page forbids it; the view simply stays as it is
          el.requestFullscreen().catch(() => {});
      }
  };
  const toggleFullscreenRef = useRef(toggleFullscreen);
  toggleFullscreenRef.current = toggleFullscreen;

  useEffect(() => {
      const onChange = () => setIsFullscreen(!!stageRef.current && document.fullscreenElement === stageRef.current);
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The scene's live readout, redrawn a few times a second (often enough to read, cheap to draw)
  useEffect(() => {
      const draw = () => {
          const panel = readoutPanelRef.current;
          if (!panel || !readoutDirtyRef.current) return;
          readoutDirtyRef.current = false;
          const data = readoutRef.current;
          panel.replaceChildren();
          panel.style.display = data ? '' : 'none';
          if (!data) return;
          const title = document.createElement('div');
          title.className = 'text-[12px] font-medium text-blue-200 mb-1.5';
          title.textContent = data.title;
          panel.appendChild(title);
          data.rows.forEach(row => {
              const line = document.createElement('div');
              if (Array.isArray(row)) {
                  line.className = 'flex items-baseline justify-between gap-4 leading-5';
                  const label = document.createElement('span');
                  label.className = 'text-slate-400';
                  label.textContent = String(row[0]);
                  const value = document.createElement('span');
                  value.className = 'font-mono tabular-nums text-slate-100 whitespace-nowrap';
                  value.textContent = String(row[1]);
                  line.append(label, value);
              } else {
                  line.className = 'hidden sm:block mt-1.5 pt-1.5 border-t border-white/10 text-slate-300 leading-snug';
                  line.textContent = String(row);
              }
              panel.appendChild(line);
          });
      };
      const timer = window.setInterval(draw, 120);
      return () => window.clearInterval(timer);
  }, []);

  const changeSpeed = (value: number) => {
      const next = clampSpeed(value);
      timeScaleRef.current = next;
      setSpeed(next);
  };

  // --- LIGHTING & BACKGROUND HELPERS ---
  const updateLighting = (newSettings: typeof lightSettings) => {
      setLightSettings(newSettings);
      
      if (ambientLightRef.current) {
          ambientLightRef.current.intensity = newSettings.ambient;
      }

      if (dirLightRef.current) {
          dirLightRef.current.intensity = newSettings.intensity;
          const phi = THREE.MathUtils.degToRad(90 - newSettings.elevation);
          const theta = THREE.MathUtils.degToRad(newSettings.azimuth);
          const r = 30; 
          dirLightRef.current.position.set(
              r * Math.sin(phi) * Math.cos(theta),
              r * Math.cos(phi),
              r * Math.sin(phi) * Math.sin(theta)
          );
          dirLightRef.current.updateMatrix();
      }
  };
  
  // A hand-picked background colour replaces the theme and becomes the scene's own look
  const changeBackground = (hex: string) => {
      setBgColor(hex);
      const scene = sceneRef.current, controller = themeControllerRef.current;
      if (!scene) return;
      themeRef.current = 'original';
      setTheme('original');
      underSetting(() => {
          if (controller) controller.apply('original');
          scene.background = new THREE.Color(hex);
          const fog = scene.fog as THREE.Fog | null;
          if (fog && fog.color) fog.color.set(hex);
          if (controller) controller.capture();
      });
  };

  // --- SELECTION ---
  const firstColor = (mesh: THREE.Object3D): string => {
      let hex = '#ffffff';
      let found = false;
      mesh.traverse((child) => {
          const material: any = (child as THREE.Mesh).material;
          const m = Array.isArray(material) ? material[0] : material;
          if (!found && m && m.color && typeof m.color.getHexString === 'function') {
              hex = '#' + m.color.getHexString();
              found = true;
          }
      });
      return hex;
  };

  // What the inspector's Edit tab shows for an object, read from the object itself
  const describeObject = (obj: SimObject): ObjectEditInfo => {
      const world = worldRef.current;
      const body = obj.body;
      const movable = body.type === CANNON.Body.DYNAMIC && body.mass > 0;
      const editable = hasEditableShapes(body);
      const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w));
      const degrees = (r: number) => ((THREE.MathUtils.radToDeg(r) % 360) + 360) % 360;
      const sound = soundInfoRef.current.get(body);
      return {
          movable,
          canResize: editable && !!world && !isConstrained(world, body),
          canDuplicate: editable && movable,
          mass: body.mass,
          scale: typeof obj.mesh.userData.editScale === 'number' ? obj.mesh.userData.editScale : 1,
          color: firstColor(obj.mesh),
          sound: sound ? sound.sound : 'generic',
          bounce: world ? getBodyBounce(world, body) : 0,
          rotation: { x: degrees(euler.x), y: degrees(euler.y), z: degrees(euler.z) }
      };
  };

  const selectObject = (obj: SimObject | null) => {
      selectedObjRef.current = obj;
      setSelectedLabel(obj ? obj.label : null);
      setEditInfo(obj ? describeObject(obj) : null);
  };
  const selectObjectRef = useRef(selectObject);
  selectObjectRef.current = selectObject;

  // Registers a body + mesh pair created by the app itself (not by scene code)
  const adoptObject = (label: string, mesh: THREE.Object3D, body: CANNON.Body, sound: SoundMaterial): SimObject | null => {
      if (!sceneRef.current || !worldRef.current) return null;
      mesh.userData.body = body;
      sceneRef.current.add(mesh);
      generatedMeshesRef.current.push(mesh);
      worldRef.current.addBody(body);
      registerSound(body, sound);
      const obj: SimObject = { label, mesh, body };
      objectsRef.current.push(obj);
      // The earlier recording does not contain this object
      restartTimeline();
      return obj;
  };

  // --- SPAWNING HELPERS ---
  const spawnObject = (type: 'box' | 'sphere') => {
      simAudio.unlock();
      if (!sceneRef.current || !worldRef.current) return;

      const id = Date.now().toString().slice(-4);
      const label = `${type}_${id}`;
      const mat = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff });
      const pos = new CANNON.Vec3((Math.random() - 0.5) * 5, 10, (Math.random() - 0.5) * 5);

      let mesh: THREE.Mesh;
      let body: CANNON.Body;

      if (type === 'box') {
          const size = 2;
          mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
          body = new CANNON.Body({
              mass: 1,
              shape: new CANNON.Box(new CANNON.Vec3(size/2, size/2, size/2)),
              position: pos
          });
      } else {
          const radius = 1;
          mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 32), mat);
          body = new CANNON.Body({
              mass: 1,
              shape: new CANNON.Sphere(radius),
              position: pos
          });
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.linearDamping = 0.1;
      body.angularDamping = 0.1;

      const obj = adoptObject(label, mesh, body, type === 'box' ? 'wood' : 'rubber');
      if (obj && pausedRef.current) selectObject(obj);
  };

  // --- OBJECT EDITING HANDLERS ---
  // All of these act on the selected object. Edits that change what exists (size, copies, removal)
  // restart the replay recording; the others only void whatever was recorded after this moment.
  const updateSelectedRotation = (axis: 'x' | 'y' | 'z', deg: number) => {
      const obj = selectedObjRef.current;
      if (!obj || !editInfo) return;
      const rotation = { ...editInfo.rotation, [axis]: deg };
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(rotation.x),
          THREE.MathUtils.degToRad(rotation.y),
          THREE.MathUtils.degToRad(rotation.z)
      ));
      obj.mesh.quaternion.copy(q);
      obj.body.quaternion.set(q.x, q.y, q.z, q.w);
      obj.body.velocity.set(0, 0, 0);
      obj.body.angularVelocity.set(0, 0, 0);
      obj.body.aabbNeedsUpdate = true;
      obj.body.wakeUp();
      markEdited();
      setEditInfo({ ...editInfo, rotation });
  };

  const updateSelectedScale = (newScale: number) => {
      const obj = selectedObjRef.current;
      if (!obj || !editInfo || !editInfo.canResize) return;
      const ratio = newScale / editInfo.scale;
      if (!scaleBody(obj.body, ratio)) return;
      obj.mesh.scale.multiplyScalar(ratio);
      obj.mesh.userData.editScale = newScale;
      restartTimeline();
      setEditInfo({ ...editInfo, scale: newScale });
  };

  const updateSelectedMass = (mass: number) => {
      const obj = selectedObjRef.current;
      if (!obj || !editInfo || !editInfo.movable) return;
      const value = Math.min(Math.max(mass, 0.01), 5000);
      obj.body.mass = value;
      obj.body.updateMassProperties();
      obj.body.wakeUp();
      markEdited();
      setEditInfo({ ...editInfo, mass: value });
  };

  const updateSelectedBounce = (bounce: number) => {
      const obj = selectedObjRef.current, world = worldRef.current;
      if (!obj || !world || !editInfo || !editInfo.movable) return;
      setBodyBounce(world, obj.body, bounce);
      markEdited();
      setEditInfo({ ...editInfo, bounce });
  };

  const updateSelectedSound = (sound: SoundMaterial) => {
      const obj = selectedObjRef.current;
      if (!obj || !editInfo) return;
      registerSound(obj.body, sound);
      setEditInfo({ ...editInfo, sound });
  };

  const updateSelectedColor = (hex: string) => {
      const obj = selectedObjRef.current;
      if (!obj || !editInfo) return;
      // Objects often share one material (every brick in a wall): give this one its own first
      obj.mesh.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh || !mesh.material) return;
          if (!mesh.userData.ownMaterial) {
              mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone();
              mesh.userData.ownMaterial = true;
          }
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((m: any) => { if (m.color && typeof m.color.set === 'function') m.color.set(hex); });
      });
      setEditInfo({ ...editInfo, color: hex });
  };

  const duplicateSelected = () => {
      const obj = selectedObjRef.current;
      if (!obj || !editInfo || !editInfo.canDuplicate) return;
      const body = duplicateBody(obj.body);
      if (!body) { showToast('This object has a shape that cannot be copied'); return; }
      // Three.js copies userData as JSON, and the link to the physics body cannot be written as JSON
      const userData = obj.mesh.userData;
      let mesh: THREE.Object3D;
      try {
          obj.mesh.userData = { ...userData, body: undefined };
          mesh = obj.mesh.clone(true);
      } catch {
          showToast('This object cannot be copied');
          return;
      } finally {
          obj.mesh.userData = userData;
      }
      // The copy gets its own materials so recolouring one does not recolour the other
      mesh.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh && m.material) {
              m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
              m.userData.ownMaterial = true;
          }
      });
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      const sound = soundInfoRef.current.get(obj.body);
      const copy = adoptObject(`${obj.label}_copy`, mesh, body, sound ? sound.sound : 'generic');
      if (copy) selectObject(copy);
  };

  const deleteSelected = () => {
      const obj = selectedObjRef.current, world = worldRef.current;
      if (!obj || !world) return;
      world.constraints.filter(c => c.bodyA === obj.body || c.bodyB === obj.body).forEach(c => world.removeConstraint(c));
      world.removeBody(obj.body);
      if (obj.mesh.parent) obj.mesh.parent.remove(obj.mesh);
      objectsRef.current = objectsRef.current.filter(o => o !== obj);
      if (mainBodyRef.current === obj.body) mainBodyRef.current = null;
      if (dragStateRef.current && dragStateRef.current.body === obj.body) dragStateRef.current = null;
      selectObject(null);
      restartTimeline();
  };

  const resetSimulation = useCallback((keepSettings = false) => {
    if (!worldRef.current || !sceneRef.current) return;
    setPaused(false);
    pausedRef.current = false;
    // A rebuilt scene starts out of Arrange mode, in its own original arrangement
    arrangeRef.current = false;
    arrangePausedItRef.current = false;
    setArranging(false);
    scrubResumeRef.current = false;
    stepRequestRef.current = 0;
    selectObjectRef.current(null);
    if (controlsRef.current) controlsRef.current.enabled = true; // Ensure controls are re-enabled

    // The scene's own backdrop and lighting come back before it is rebuilt (the theme and the real-world
    // setting are re-applied below), the setting first, as it went on last
    settingFnsRef.current.clear();
    setupBoxRef.current = null;
    groundKindRef.current = null;
    if (themeControllerRef.current) themeControllerRef.current.restore();

    // Clear Physics World
    while(worldRef.current.bodies.length > 0) worldRef.current.removeBody(worldRef.current.bodies[0]);
    while(worldRef.current.constraints.length > 0) worldRef.current.removeConstraint(worldRef.current.constraints[0]);
    // ...including what the previous build of the scene registered on the world itself: its step
    // listeners (they would keep running against bodies that no longer exist) and its contact rules
    const listeners = (worldRef.current as any)._listeners;
    if (listeners && baseListenersRef.current) {
        Object.keys(listeners).forEach(type => { listeners[type] = (baseListenersRef.current![type] || []).slice(); });
    }
    worldRef.current.contactmaterials.length = 0;
    const contactTable: any = (worldRef.current as any).contactMaterialTable;
    if (contactTable && typeof contactTable.reset === 'function') contactTable.reset();
    worldRef.current.defaultContactMaterial.friction = 0.3;
    worldRef.current.defaultContactMaterial.restitution = 0;

    // Clear Visuals (Fixes Chaos) - WITH NULL CHECK
    const removed = generatedMeshesRef.current.filter(Boolean);
    removed.forEach(mesh => { if (mesh.parent) mesh.parent.remove(mesh); });
    // Their GPU memory is freed once the rebuilt scene has been drawn, so shaders it shares stay compiled
    window.setTimeout(() => removed.forEach(disposeScene), 2000);
    generatedMeshesRef.current = [];
    objectsRef.current = [];
    frameCallbacksRef.current = [];
    clickCallbacksRef.current = [];
    readoutRef.current = null;
    readoutDirtyRef.current = true;

    // Anything being dragged no longer exists
    dragStateRef.current = null;
    // Sound and vibration start clean for the rebuilt scene
    ambienceRef.current = 'none';
    sceneStartTimeRef.current = worldRef.current.time;
    shakeRef.current = 0;
    rollLevelRef.current = { level: 0, brightness: 0, whoosh: 0 };
    simAudio.hush();

    // Helper functions for AI code - ROBUST INPUT VALIDATION ADDED
    // options.sound names the material ('metal', 'wood', 'stone', 'glass', 'rubber', 'plastic', 'soft');
    // when it is missing the material is guessed from the label and the mesh's metalness.
    // options.main marks the object the user launches or releases; it is kept on the floor (see boundaries below).
    let declaredMain: CANNON.Body | null = null;
    boundsRef.current = null;
    mainBodyRef.current = null;
    const addSimulationObject = (label: string, mesh: THREE.Object3D, body: CANNON.Body, options?: { sound?: string; main?: boolean }) => {
       if (!mesh) {
           console.warn(`[AI Sandbox] addSimulationObject: Mesh is missing for '${label}'. Object skipped.`);
           return;
       }
       if (!body) {
           console.warn(`[AI Sandbox] addSimulationObject: Body is missing for '${label}'. Object skipped.`);
           return;
       }

       if (!mesh.parent && sceneRef.current) sceneRef.current.add(mesh);
       generatedMeshesRef.current.push(mesh);
       
       if (worldRef.current && !worldRef.current.bodies.includes(body)) {
           worldRef.current.addBody(body);
       }
       mesh.userData.body = body; // CRITICAL: This links visual to physics for interaction
       
       let sound: SoundMaterial;
       if (options && isSoundMaterial(options.sound)) {
           sound = options.sound;
       } else {
           let metalness: number | undefined;
           mesh.traverse((child) => {
               const material: any = (child as THREE.Mesh).material;
               if (metalness === undefined && material && !Array.isArray(material) && typeof material.metalness === 'number') {
                   metalness = material.metalness;
               }
           });
           sound = inferSoundMaterial(String(label), metalness);
       }
       registerSound(body, sound);
       if (options && options.main === true && !declaredMain) declaredMain = body;

       objectsRef.current.push({ label, mesh, body });
   };

   // Background sound for the whole scene: 'space' (vacuum: faint drone, no air noise), 'wind' or 'none'
   const setAmbience = (kind: string) => {
       if ((AMBIENCES as string[]).includes(kind)) ambienceRef.current = kind as Ambience;
       else console.warn(`[AI Sandbox] setAmbience: unknown ambience '${kind}'. Use 'space', 'wind' or 'none'.`);
   };
   
   // Helper to retrieve object by label - RETURNS UNDEFINED, DOES NOT THROW
   const getSimulationObject = (label: string) => {
       const obj = objectsRef.current.find(o => o.label === label);
       if (!obj) {
           console.warn(`[AI Sandbox] getSimulationObject: Object '${label}' not found.`);
       }
       return obj;
   }

   const addFrameCallback = (callback: () => void) => { frameCallbacksRef.current.push(callback); };
   const addClickCallback = (callback: (label: string) => boolean | void) => { clickCallbacksRef.current.push(callback); };

   // Hangs a body from a fixed point on a rope of its current length and draws the rope.
   // AI-written PointToPoint "ropes" usually have zero length and fling the body, so this is the safe path.
   const addRope = (anchor: any, body: CANNON.Body, color = 0xcbd5e1) => {
       if (!anchor || !body || !worldRef.current || !sceneRef.current) {
           console.warn('[AI Sandbox] addRope: anchor or body is missing. Rope skipped.');
           return null;
       }
       const rope = createRope(worldRef.current, anchor, body);
       if (!rope) return null;
       const { anchorBody, constraint } = rope;

       const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
       const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
       line.frustumCulled = false;
       sceneRef.current.add(line);
       generatedMeshesRef.current.push(line);
       const update = () => {
           const p = geometry.attributes.position as THREE.BufferAttribute;
           p.setXYZ(0, anchorBody.position.x, anchorBody.position.y, anchorBody.position.z);
           p.setXYZ(1, body.position.x, body.position.y, body.position.z);
           p.needsUpdate = true;
       };
       update();
       frameCallbacksRef.current.push(update);
       return constraint;
   };

   // A realistic person ('man' or 'woman') added to the scene, options.height metres tall. It loads in
   // the background; options.pose(human) runs once it has loaded and after every frame, so the pose
   // can follow the scene's clock and bodies. Visual only: give it a body with addSimulationObject.
   const humanCounts: Record<string, number> = {};
   const addHuman = (kind: string, options?: { height?: number; pose?: (human: Human) => void }) => {
       const safeKind = isHumanKind(kind) ? kind : 'man';
       if (safeKind !== kind) console.warn(`[AI Sandbox] addHuman: unknown kind '${kind}'. Use 'man' or 'woman'.`);
       const pose = options && typeof options.pose === 'function' ? options.pose : null;
       const sceneAtBuild = sceneRef.current;
       const callbacks = frameCallbacksRef.current;
       // Each figure of a kind is the next person of that kind, so two men in a scene are two different men
       const variant = humanCounts[safeKind] = (humanCounts[safeKind] ?? -1) + 1;
       const human = createHuman(safeKind, options && Number(options.height), h => {
           // The scene may have been rebuilt while the model loaded; this figure is then gone
           if (frameCallbacksRef.current !== callbacks || !pose) return;
           try { pose(h); } catch (e) { console.error('[AI Sandbox] addHuman: pose threw:', e); }
       }, variant);
       if (sceneAtBuild) sceneAtBuild.add(human.object);
       generatedMeshesRef.current.push(human.object);
       if (pose) callbacks.push(() => { if (human.ready) pose(human); });
       return human;
   };

   // Live numbers shown in a small panel: rows are [label, value] pairs, or plain strings for a note
   const setReadout = (title: string, rows: (string | [string, string])[]) => {
       readoutRef.current = { title: String(title || ''), rows: Array.isArray(rows) ? rows : [] };
       readoutDirtyRef.current = true;
   };

   // Proxy scene again
   const sceneProxy = new Proxy(sceneRef.current, {
       get(target, prop, receiver) {
           if (prop === 'add') {
               return (...args: any[]) => {
                   args.forEach(arg => {
                       if (arg instanceof THREE.Object3D) {
                          generatedMeshesRef.current.push(arg);
                       }
                   });
                   return target.add(...args);
               }
           }
           return Reflect.get(target, prop, receiver);
       }
   });

   // If any person or moving object is outside the shot, keep the camera's viewing direction but step back
   // and re-aim so that all of them, and the point it was aimed at, fit in the view
   const frameSubjects = (cam: THREE.PerspectiveCamera, target: THREE.Vector3) => {
       frameShot(cam, target, shotPoints(target, objectsRef.current.map(o => o.body), generatedMeshesRef.current, sceneRef.current));
   };

   // Scene code may choose the point the camera orbits: camera.userData.lookAt = [x, y, z]
   if (cameraRef.current) delete cameraRef.current.userData.lookAt;
   try {
       // Pass the proxy scene so we track everything
       const world = worldRef.current;
       compileScene(simulationData.code)(THREE, CANNON, sceneProxy, world, cameraRef.current, addSimulationObject, addFrameCallback, getSimulationObject, addClickCallback, addRope, setAmbience, addHuman, setReadout,
           realMaterial, (kind: string) => { groundKindRef.current = String(kind); return addGround(sceneProxy, world, kind); });
    } catch (e: any) {
        console.error("AI Code Execution Error:", e);
        if (onError) onError(`3D Runtime Error: ${e.message}`);
    }
    const lookAt = cameraRef.current && cameraRef.current.userData.lookAt;
    if (controlsRef.current) {
        if (Array.isArray(lookAt) && lookAt.length === 3 && lookAt.every((n: unknown) => Number.isFinite(n))) controlsRef.current.target.set(lookAt[0], lookAt[1], lookAt[2]);
        else controlsRef.current.target.set(0, 0, 0);
        // Generated scenes: the camera the model chose must show the people and the moving objects
        if (!simulationData.demoMode && cameraRef.current) frameSubjects(cameraRef.current, controlsRef.current.target);
        // Every scene opens on the whole set-up, clear of the panels: the camera steps back if it is too close
        if (cameraRef.current) {
            const target = controlsRef.current.target;
            const points = shotPoints(target, objectsRef.current.map(o => o.body), generatedMeshesRef.current, sceneRef.current);
            const viewWidth = rendererRef.current ? rendererRef.current.domElement.clientWidth : 960;
            fitWholeScene(cameraRef.current, target, sceneBox(generatedMeshesRef.current, points), FRAMING_MAX_DISTANCE, viewWidth || 960);
        }
    }
    simAudio.setAmbience(ambienceRef.current);

    // The freshly built scene's look is its 'original'; the chosen environment theme goes on top
    if (themeControllerRef.current) {
        themeControllerRef.current.capture();
        themeControllerRef.current.apply(themeRef.current, cameraRef.current ?? undefined);
    }

    // --- BOUNDARIES ---
    // The main object (the thing the user launches or releases) must stay on the floor; see lib/bounds.ts.
    const bounds = findFloor(worldRef.current);
    const main = bounds
        ? pickMainBody(objectsRef.current.map(o => o.body), declaredMain, simulationData.startMode === 'click')
        : null;
    if (bounds && main) {
        addBoundaryWalls(worldRef.current, bounds, main);

        // A faint outline shows where the edge is
        const y = bounds.top + 0.03;
        const outline = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(bounds.minX, y, bounds.minZ), new THREE.Vector3(bounds.maxX, y, bounds.minZ),
                new THREE.Vector3(bounds.maxX, y, bounds.maxZ), new THREE.Vector3(bounds.minX, y, bounds.maxZ)
            ]),
            new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
        );
        outline.name = 'floor-outline';   // Hidden under a real-world setting's own surface
        sceneRef.current.add(outline);
        generatedMeshesRef.current.push(outline);
    }
    boundsRef.current = bounds;
    mainBodyRef.current = main;

    // --- REAL-WORLD SETTING (Realistic mode) ---
    // Sized to the set-up as built, so it stays put however the objects move or are moved later
    setupBoxRef.current = sceneBox(generatedMeshesRef.current, objectsRef.current.map(o => new THREE.Vector3(o.body.position.x, o.body.position.y, o.body.position.z)));
    settingFnsRef.current.build();

    // --- SPEED ---
    // A simulation may suggest a starting speed through a 'scale' slider; the built-in Speed control
    // replaces that slider. Reset keeps whatever speed the user has chosen.
    const suggestedSpeed = simulationData.sliders.find(s => s.property === 'scale');
    const startSpeed = keepSettings ? timeScaleRef.current : clampSpeed(suggestedSpeed ? suggestedSpeed.value : 1);
    timeScaleRef.current = startSpeed;
    setSpeed(startSpeed);

    // --- APPLY SLIDERS (Respecting keepSettings preference) ---
    const newValues: Record<string, number> = {};
    simulationData.sliders.forEach(slider => {
        let val = slider.value;
        // If keepSettings is true AND we have a value in ref, use that instead of default
        if (keepSettings && sliderValuesRef.current[slider.label] !== undefined) {
            val = sliderValuesRef.current[slider.label];
        }
        
        newValues[slider.label] = val;
        applySlider(worldRef.current!, objectsRef.current, slider, val, false);
    });
    setSliderValues(newValues);
    sliderValuesRef.current = newValues; // Sync Ref
    

    // Every (re)build of a click-to-start scene waits for the user again
    const needsStart = simulationData.startMode === 'click';
    awaitingStartRef.current = needsStart;
    setAwaitingStart(needsStart);
    pausedVelocitiesRef.current = null;

    // The replay recording starts over with the rebuilt scene's first moment
    timelineRef.current.clear();
    timelineRef.current.record(worldRef.current, 0);
    timelineDirtyRef.current = false;
    stepCountRef.current = 0;
    cameraGoalRef.current = null;
  }, [simulationData, onError]); // Removed settingsPos from dependency array to prevent scene reload loops

  // --- ENGINE SETUP & LOOP ---
  useEffect(() => {
    if (!containerRef.current) return;
    // Captured locally: under StrictMode the ref is already null when cleanup runs
    const container = containerRef.current;

    // Dimensions
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgColor); 
    scene.fog = new THREE.Fog(bgColor, 20, 100);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(20, 20, 30);
    camera.lookAt(0, 5, 0);
    cameraRef.current = camera;

    // Renderer: the session's one renderer, moved into this view
    const shared = getStage();
    const renderer = shared.renderer;
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = ZOOM_MIN_DISTANCE;
    controls.maxDistance = ZOOM_MAX_DISTANCE;
    // Wheel, pinch or drag takes over from an animated zoom
    controls.addEventListener('start', () => { zoomGoalRef.current = null; cameraGoalRef.current = null; });
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(20, 30, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    // Cover the whole 40 x 40 floor (the default shadow box is only 10 units wide, so most objects cast none)
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 120;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.03;
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    // Physics World
    const world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new SweepBroadphase(world);
    (world.solver as any).iterations = 10;
    // Problem scenes get friction as mu x N; the world is reused, so each scene decides (lib/friction.ts)
    installTextbookPhysics(world, () => !!simulationDataRef.current?.textbookPhysics);
    worldRef.current = world;

    // Backdrop and lighting themes (needs the lights above)
    const themeController = new ThemeController(scene, ambientLight, dirLight);
    themeControllerRef.current = themeController;

    // --- BOUNDARY ENFORCEMENT ---
    // Runs after every physics step: the main object stays on the floor's footprint and nothing over
    // the floor sinks through it, whatever caused it (speed, a solver glitch, a drag).
    world.addEventListener('postStep', () => {
        const limits = boundsRef.current;
        if (limits) enforceBounds(world, limits, mainBodyRef.current, objectsRef.current.map(o => o.body));
        // Timeline: record the live simulation (not the steps taken while dragging something when paused)
        if (liveStepRef.current && ++stepCountRef.current % RECORD_EVERY === 0) {
            timelineRef.current.record(world, world.time - sceneStartTimeRef.current);
        }
    });
    // Drag steering, while something is held: its velocity is set toward the cursor, its spin is cancelled
    // and gravity is offset, so it follows the pointer smoothly without swinging, spinning or building up energy.
    // It runs at the END of each step, setting up the next one. cannon-es fires 'preStep' after its solver,
    // so steering set there skipped every joint and contact: a held pendulum bob came off its string and a
    // held box went through walls. Set here, the next step's solver keeps strings taut and solids solid.
    const dragVelocity = new CANNON.Vec3();
    const dragGoal = new CANNON.Vec3();
    world.addEventListener('postStep', () => {
        const drag = dragStateRef.current;
        if (!drag) return;
        const b = drag.body;
        if (b.world !== world) { dragStateRef.current = null; return; }
        b.wakeUp();
        // Where the cursor wants the body's centre to be, kept inside the boundaries
        dragGoal.set(drag.target.x + drag.offset.x, drag.target.y + drag.offset.y, drag.target.z + drag.offset.z);
        const limits = boundsRef.current;
        if (limits) clampDragGoal(dragGoal, b, limits, b === mainBodyRef.current);
        // Respect axes the simulation has locked (linearFactor 0), e.g. a pendulum kept in one plane
        dragVelocity.set(
            (dragGoal.x - b.position.x) * DRAG_STIFFNESS * b.linearFactor.x,
            (dragGoal.y - b.position.y) * DRAG_STIFFNESS * b.linearFactor.y,
            (dragGoal.z - b.position.z) * DRAG_STIFFNESS * b.linearFactor.z
        );
        const dragSpeed = dragVelocity.length();
        if (dragSpeed > DRAG_MAX_SPEED) dragVelocity.scale(DRAG_MAX_SPEED / dragSpeed, dragVelocity);
        b.velocity.copy(dragVelocity);
        b.angularVelocity.set(0, 0, 0);
        // Offset gravity for the held body during the next step (the step that just ended cleared all forces)
        b.force.x -= b.mass * world.gravity.x;
        b.force.y -= b.mass * world.gravity.y;
        b.force.z -= b.mass * world.gravity.z;
    });

    // Drag Line (from the grab point to the cursor)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6 });
    const dragLine = new THREE.Line(lineGeo, lineMat);
    dragLine.visible = false;
    dragLine.frustumCulled = false;
    dragLine.raycast = noRaycast;
    scene.add(dragLine);
    dragLineRef.current = dragLine;

    // Everything scene code registers on the world from here on is removed again when the scene is rebuilt
    const ownListeners: Record<string, Function[]> = {};
    const worldListeners = (world as any)._listeners || {};
    Object.keys(worldListeners).forEach(type => { ownListeners[type] = worldListeners[type].slice(); });
    baseListenersRef.current = ownListeners;

    // --- OVERLAYS: none of these can be picked, dragged or measured against ---
    // Outline around the selected object
    const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x38bdf8);
    selectionBox.visible = false;
    selectionBox.frustumCulled = false;
    selectionBox.raycast = noRaycast;
    (selectionBox.material as THREE.LineBasicMaterial).depthTest = false;
    selectionBox.renderOrder = 9;
    scene.add(selectionBox);

    // Velocity arrows (a fixed pool, reused every frame) and a weight arrow for the selected object
    const makeArrow = (color: number) => {
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color);
        arrow.visible = false;
        arrow.traverse((child: any) => {
            child.raycast = noRaycast;
            child.frustumCulled = false;
            child.renderOrder = 10;
            if (child.material) { child.material.depthTest = false; child.material.transparent = true; child.material.fog = false; }
        });
        scene.add(arrow);
        return arrow;
    };
    const velocityArrows = Array.from({ length: MAX_VECTOR_ARROWS }, () => makeArrow(0x34d399));
    const weightArrow = makeArrow(0xfb923c);
    const arrowDirection = new THREE.Vector3();

    // Ruler: two markers and the line between them
    const rulerMaterial = new THREE.LineBasicMaterial({ color: 0xfde047, depthTest: false, transparent: true });
    const rulerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), rulerMaterial);
    rulerLine.visible = false;
    rulerLine.frustumCulled = false;
    rulerLine.raycast = noRaycast;
    rulerLine.renderOrder = 11;
    scene.add(rulerLine);
    const rulerDots = [0, 1].map(() => {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfde047, depthTest: false, transparent: true, fog: false }));
        dot.visible = false;
        dot.raycast = noRaycast;
        dot.renderOrder = 11;
        scene.add(dot);
        return dot;
    });
    const rulerMid = new THREE.Vector3();
    const refreshRuler = () => {
        const points = rulerPointsRef.current;
        rulerDots.forEach((dot, i) => {
            dot.visible = i < points.length;
            if (points[i]) dot.position.copy(points[i]);
        });
        rulerLine.visible = points.length === 2;
        if (points.length === 2) {
            rulerLine.geometry.setFromPoints(points);
            const d = points[1].clone().sub(points[0]);
            setRulerInfo({ points: 2, distance: d.length(), dx: Math.abs(d.x), dy: Math.abs(d.y), dz: Math.abs(d.z) });
        } else {
            setRulerInfo({ points: points.length, distance: 0, dx: 0, dy: 0, dz: 0 });
        }
    };
    refreshRulerRef.current = refreshRuler;
    refreshRuler(); // A ruler left from the previous scene is redrawn in this one
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // --- EVENTS ---
    // Pointer events cover mouse, touch and pen with one code path.
    const aimRay = (e: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.current.setFromCamera(mouse.current, camera);
    };

    // Lets go of the held body. A slow release drops it in place; a fast flick is capped to a gentle toss.
    const endDrag = () => {
        const drag = dragStateRef.current;
        if (!drag) return;
        dragStateRef.current = null;
        const b = drag.body;
        if (pausedRef.current) {
            b.velocity.set(0, 0, 0);
            // Arranged by hand: it starts from rest when time runs again, wherever it was moving before
            const saved = arrangeRef.current && pausedVelocitiesRef.current ? pausedVelocitiesRef.current.get(b) : null;
            if (saved) { saved.v.set(0, 0, 0); saved.w.set(0, 0, 0); }
            if (arrangeRef.current) arrangeSettleRef.current = { body: b, steps: 12 };
        } else {
            const releaseSpeed = b.velocity.length();
            if (releaseSpeed > RELEASE_MAX_SPEED) b.velocity.scale(RELEASE_MAX_SPEED / releaseSpeed, b.velocity);
        }
        b.angularVelocity.set(0, 0, 0);
    };

    const onPointerDown = (e: PointerEvent) => {
        if (!e.isPrimary || e.button !== 0) return; // Left button or first finger only
        if (!cameraRef.current || !sceneRef.current || !worldRef.current) return;
        if (rulerModeRef.current) {
            // Measuring: a click places a point (decided on release); a drag still orbits the camera
            clickStartRef.current = { x: e.clientX, y: e.clientY, obj: null, ruler: true };
            return;
        }
        if (awaitingStartRef.current && !arrangeRef.current) {
            // Waiting for the start click: nothing can be grabbed yet (unless arranging), but the camera can still be orbited
            clickStartRef.current = { x: e.clientX, y: e.clientY, obj: null };
            return;
        }
        aimRay(e);
        const intersects = raycaster.current.intersectObjects(sceneRef.current.children, true);

        // Find the first object that is part of a simulation body (traversing parents),
        // so objects the AI wrapped in Groups can still be picked
        let hitBody: CANNON.Body | null = null;
        let hitPoint: THREE.Vector3 | null = null;

        for (const intersect of intersects) {
            let current: THREE.Object3D | null = intersect.object;
            while (current && current !== sceneRef.current) {
                if (current.userData && current.userData.body) {
                    hitBody = current.userData.body;
                    hitPoint = intersect.point;
                    break;
                }
                current = current.parent;
            }
            if (hitBody) break;
        }

        if (hitBody && hitPoint) {
            const body = hitBody;
            const point = hitPoint;
            const simObj = objectsRef.current.find(o => o.body === body);

            // Store click data for distinction between click and drag
            clickStartRef.current = { x: e.clientX, y: e.clientY, obj: simObj || null };

            // Only bodies that can move are draggable; fixed scenery can still be clicked
            if (body.type === CANNON.Body.DYNAMIC && body.mass > 0) {
                // This runs in the capture phase, so the camera controls see themselves disabled
                // before they handle the same event and never start rotating
                controls.enabled = false;
                dragStateRef.current = {
                    body,
                    target: new CANNON.Vec3(point.x, point.y, point.z),
                    offset: new CANNON.Vec3(body.position.x - point.x, body.position.y - point.y, body.position.z - point.z),
                    pointerId: e.pointerId
                };
                // The cursor moves the body on a plane facing the camera through the grab point
                planeRef.current.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), point);
                body.wakeUp();
            }
        } else {
            // Pressed empty space
            clickStartRef.current = { x: e.clientX, y: e.clientY, obj: null };
        }
    };

    const planeHit = new THREE.Vector3();
    const onPointerMove = (e: PointerEvent) => {
        const drag = dragStateRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        aimRay(e);
        // intersectPlane returns null when the ray is parallel to the plane
        const result = raycaster.current.ray.intersectPlane(planeRef.current, planeHit);
        if (result) drag.target.set(result.x, result.y, result.z);
        // Moving something by hand changes history from this moment on (a plain click does not)
        timelineDirtyRef.current = true;
    };

    const onPointerUp = (e: PointerEvent) => {
        const drag = dragStateRef.current;
        if (drag ? e.pointerId !== drag.pointerId : !e.isPrimary) return; // A different finger
        controls.enabled = true;

        // Handle Selection vs Drag Logic
        if (clickStartRef.current) {
            const dx = Math.abs(e.clientX - clickStartRef.current.x);
            const dy = Math.abs(e.clientY - clickStartRef.current.y);

            // Movement Threshold: < 6 pixels is a click, otherwise it's a drag
            if (dx < 6 && dy < 6) {
                if (clickStartRef.current.ruler) {
                     // Measuring: the point is wherever the click lands on the scene, else on the floor plane
                     aimRay(e);
                     const hits = raycaster.current.intersectObjects(scene.children, true).filter(h => h.object.visible);
                     let point: THREE.Vector3 | null = hits.length ? hits[0].point.clone() : null;
                     if (!point) {
                         floorPlane.constant = -(boundsRef.current ? boundsRef.current.top : 0);
                         point = raycaster.current.ray.intersectPlane(floorPlane, new THREE.Vector3());
                     }
                     if (point) {
                         const points = rulerPointsRef.current;
                         rulerPointsRef.current = points.length >= 2 ? [point] : [...points, point];
                         refreshRuler();
                     }
                } else if (arrangeRef.current) {
                     // Arranging: a click only selects (it never starts the scene or runs the scene's own click actions)
                     selectObjectRef.current(clickStartRef.current.obj);
                } else if (awaitingStartRef.current) {
                     // A click anywhere on the view starts the simulation (a drag only orbits the camera)
                     beginSimulationRef.current();
                } else if (clickStartRef.current.obj) {
                     const obj = clickStartRef.current.obj;
                     let handled = false;
                     clickCallbacksRef.current.forEach(cb => { if (cb(obj.label)) handled = true; });
                     // A scene's own click action (toppling a domino, pushing a block) changes history too
                     if (handled) timelineDirtyRef.current = true;
                     else selectObjectRef.current(obj);
                } else {
                    // Clicked empty space: deselect
                    selectObjectRef.current(null);
                }
            }
            clickStartRef.current = null;
        }

        endDrag();
    };

    // The browser took the pointer away (e.g. a system gesture): drop whatever is held, no click
    const onPointerCancel = () => {
        controls.enabled = true;
        clickStartRef.current = null;
        endDrag();
    };

    // --- RENDERING ---
    // Always: light from a sky-and-ground environment tinted by the scene's own backdrop (natural soft
    // fill and matching reflections on shiny surfaces) in place of most of the flat ambient light, with
    // neutral tone mapping (true colours, soft highlights), and a sun shadow fitted to what the camera
    // looks at. The full chain (ambient occlusion, multisampled anti-aliasing, a faint glow on the very
    // brightest highlights, sharp pixels on high-density screens) is used whenever the device keeps up,
    // and steps down a level at a time when it does not.
    let composer: EffectComposer | null = null;
    let environment: THREE.Texture | null = null;
    let environmentBackdrop: any = undefined;   // The backdrop 'environment' was made for
    // 2: full chain at screen density, 1: full chain at 1 pixel per CSS pixel, 0: plain renderer
    let fxLevel = shared.fxLevel;
    let fxActive: number | null = null;  // The level the renderer is currently set up for (null: not yet)
    let slowFrames = 0;
    // The shared post-processing chain, pointed at this view's scene and camera (made on first use)
    const ensureComposer = () => {
        if (composer) return composer;
        if (!shared.composer) {
            const size = renderer.getSize(new THREE.Vector2());
            // Multisampled, or the post-processing chain would lose the renderer's anti-aliasing
            const chain = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
            shared.renderPass = new RenderPass(scene, camera);
            chain.addPass(shared.renderPass);
            // Ambient occlusion: the soft darkening where objects meet the floor and each other
            shared.ao = new GTAOPass(scene, camera, size.x, size.y);
            shared.ao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1, thickness: 1, scale: 1, samples: 12 });
            shared.ao.blendIntensity = 0.85;
            chain.addPass(shared.ao);
            chain.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.3, 1.0));
            chain.addPass(new OutputPass()); // Applies the tone mapping and converts to screen colours
            shared.composer = chain;
        }
        shared.renderPass!.scene = scene;
        shared.renderPass!.camera = camera;
        shared.ao!.scene = scene;
        shared.ao!.camera = camera;
        composer = shared.composer;
        return composer;
    };
    // The backdrop's top and horizon colours: a plain colour, or the gradient canvas the scene kit and
    // the themes draw. Null for anything else (no backdrop, an image).
    const backdropColors = (bg: any): [THREE.Color, THREE.Color] | null => {
        if (bg && bg.isColor) return [bg.clone(), bg.clone()];
        // A painted backdrop names its own sky and horizon colours
        const named = bg && bg.isTexture ? bg.userData.tint : null;
        if (Array.isArray(named)) return [new THREE.Color(named[0]), new THREE.Color(named[1])];
        const canvas = bg && bg.isTexture ? bg.image : null;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const pick = (y: number) => {
            const [r, g, b] = ctx.getImageData(0, y, 1, 1).data;
            return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        };
        return [pick(0), pick(canvas.height - 1)];
    };
    // A neutral reference colour given the backdrop colour's hue and half its saturation, at the
    // reference's own lightness: outdoor scenes get a blue sky, warm rooms a warm one, and a dark
    // backdrop never darkens the fill light (the ambient strength still does that, below).
    const tint = (reference: THREE.Color, backdrop: THREE.Color) => {
        const ref = { h: 0, s: 0, l: 0 }, back = { h: 0, s: 0, l: 0 };
        reference.getHSL(ref);
        backdrop.getHSL(back);
        return new THREE.Color().setHSL(back.h, back.s * 0.5, ref.l);
    };
    // Sky above, a darker ground below and a soft horizon between: tops of objects catch the most
    // light, sides less and undersides little, as outdoors, and shiny surfaces reflect a horizon.
    // Rebuilt when the backdrop changes (a new scene, a theme, a picked colour).
    const ensureEnvironment = () => {
        const bg: any = scene.background;
        const colorKey = bg && bg.isColor ? bg.getHexString() : null;
        if (environment && (bg === environmentBackdrop || (colorKey && colorKey === environmentBackdrop))) return environment;
        environmentBackdrop = colorKey || bg;
        let sky = new THREE.Color(0.95, 0.98, 1.0), horizon = new THREE.Color(0.5, 0.5, 0.52);
        const ground = new THREE.Color(0.1, 0.095, 0.09);
        const backdrop = backdropColors(bg);
        if (backdrop) {
            sky = tint(sky, backdrop[0]);
            horizon = tint(horizon, backdrop[1]);
        }
        // Scenes with the same sky share one environment
        const key = sky.getHexString() + horizon.getHexString();
        const cached = shared.environments.get(key);
        if (cached) {
            environment = cached;
            return environment;
        }
        const geometry = new THREE.SphereGeometry(10, 64, 32);
        const position = geometry.attributes.position;
        const colors = new Float32Array(position.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < position.count; i++) {
            const y = position.getY(i) / 10;
            if (y >= 0) c.copy(horizon).lerp(sky, Math.pow(y, 0.6));
            else c.copy(horizon).lerp(ground, Math.pow(-y, 0.35));
            c.toArray(colors, i * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
        const envScene = new THREE.Scene();
        envScene.add(new THREE.Mesh(geometry, material));
        environment = shared.pmrem.fromScene(envScene, 0.02).texture;
        geometry.dispose();
        material.dispose();
        if (shared.environments.size >= MAX_ENVIRONMENTS) {
            // Forget the oldest (Map keeps insertion order); never the one a live view may still use
            const [oldestKey, oldest] = shared.environments.entries().next().value!;
            shared.environments.delete(oldestKey);
            if (oldest !== scene.environment) oldest.dispose();
        }
        shared.environments.set(key, environment);
        return environment;
    };
    // The environment takes over most of the flat ambient light and follows its strength, so dark
    // scenes (night, space, the solar system) stay dark. The ambient is put back after the frame.
    // The sun's shadow covers what the camera looks at instead of the whole 60 x 60 m floor, so small
    // set-ups (a cradle, a domino run) get crisp shadows and zooming out widens it. The sun keeps its
    // direction (set by the lighting panel); it is only moved for the render and put back after.
    const savedSunPosition = new THREE.Vector3();
    const savedSunTarget = new THREE.Vector3();
    const sunDirection = new THREE.Vector3();
    const shadowFocus = new THREE.Vector3();
    const lightBasis = new THREE.Matrix4();
    const lightBasisInverse = new THREE.Matrix4();
    const worldUp = new THREE.Vector3(0, 1, 0), sideUp = new THREE.Vector3(0, 0, 1), origin = new THREE.Vector3();
    const fitSunShadow = () => {
        savedSunPosition.copy(dirLight.position);
        savedSunTarget.copy(dirLight.target.position);
        sunDirection.copy(dirLight.position).sub(dirLight.target.position);
        if (!dirLight.castShadow || sunDirection.lengthSq() < 1e-6) return false;
        sunDirection.normalize();
        const span = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.9, 6, 40);
        const texel = (2 * span) / dirLight.shadow.mapSize.width;
        // Snap the focus to whole shadow-map pixels as seen from the sun, so shadow edges stay still
        // instead of shimmering while the camera moves
        lightBasis.lookAt(sunDirection, origin, Math.abs(sunDirection.y) > 0.99 ? sideUp : worldUp);
        lightBasisInverse.copy(lightBasis).transpose();
        shadowFocus.copy(controls.target).applyMatrix4(lightBasisInverse);
        shadowFocus.x = Math.round(shadowFocus.x / texel) * texel;
        shadowFocus.y = Math.round(shadowFocus.y / texel) * texel;
        shadowFocus.applyMatrix4(lightBasis);

        dirLight.target.position.copy(shadowFocus);
        dirLight.target.updateMatrixWorld();
        dirLight.position.copy(shadowFocus).addScaledVector(sunDirection, 60);
        const shadowCamera = dirLight.shadow.camera;
        shadowCamera.left = shadowCamera.bottom = -span;
        shadowCamera.right = shadowCamera.top = span;
        shadowCamera.near = 1;
        shadowCamera.far = 160;
        shadowCamera.updateProjectionMatrix();
        dirLight.shadow.normalBias = texel; // Proportional to the pixel size: no acne, no floating shadows
        return true;
    };
    const restoreSun = () => {
        dirLight.position.copy(savedSunPosition);
        dirLight.target.position.copy(savedSunTarget);
        dirLight.target.updateMatrixWorld();
    };

    // Far zoom-out. The scene's own clipping planes and fog are made for its home view; as the camera
    // pulls back further, the far plane moves out with it (and the near plane a little, to keep depth
    // precise), and the fog is pushed back by the extra distance for the frame being drawn, so the
    // scene stays as clear as at its home view instead of fading into the background.
    let sceneNear = camera.near, sceneFar = camera.far;
    const fitClipping = () => {
        const distance = camera.position.distanceTo(controls.target);
        const far = Math.max(sceneFar, distance * 4);
        const near = Math.max(sceneNear, distance / 1000);
        if (Math.abs(camera.far - far) > far * 0.01 || Math.abs(camera.near - near) > near * 0.01) {
            camera.far = far;
            camera.near = near;
            camera.updateProjectionMatrix();
        }
        return distance;
    };

    const renderFrame = (fx: boolean, dt: number) => {
        const distance = fitClipping();
        const home = homeViewRef.current;
        const beyond = home ? distance - home.position.distanceTo(home.target) : 0;
        const fog = scene.fog;
        let fogNear = 0, fogFar = 0, fogDensity = 0;
        const fogShifted = !!fog && beyond > 1;
        if (fog instanceof THREE.Fog && fogShifted) {
            fogNear = fog.near; fogFar = fog.far;
            fog.near += beyond; fog.far += beyond;
        } else if (fog instanceof THREE.FogExp2 && fogShifted) {
            fogDensity = fog.density;
            fog.density *= (distance - beyond) / distance;
        }
        const ambient = ambientLight.intensity;
        const setting = settingRef.current;
        scene.environment = ensureEnvironment();
        if (setting && setting.ibl === 'sky') {
            // Outdoors (a park): the sky does the fill, blue from above, so shade looks like daylight
            scene.environmentIntensity = Math.min(0.35 + ambient * 0.8, 0.75);
            ambientLight.intensity = ambient * 0.1;
        } else {
            scene.environmentIntensity = Math.min(ambient * 1.1, 0.8);
            ambientLight.intensity = ambient * 0.2;
        }
        const fitted = fitSunShadow();
        if (fx) ensureComposer().render(dt);
        else renderer.render(scene, camera);
        if (fitted) restoreSun();
        ambientLight.intensity = ambient;
        if (fog instanceof THREE.Fog && fogShifted) { fog.near = fogNear; fog.far = fogFar; }
        else if (fog instanceof THREE.FogExp2 && fogShifted) fog.density = fogDensity;
    };
    const applyRenderMode = (level: number) => {
        if (level === fxActive) return;
        fxActive = level;
        // 1.5 pixels per CSS pixel is sharp on high-density screens at about half the cost of 2
        const ratio = level >= 2 ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
        renderer.setPixelRatio(ratio);
        renderer.toneMapping = THREE.NeutralToneMapping;
        renderer.toneMappingExposure = 1;
        const w = container.clientWidth, h = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        if (level > 0) {
            const c = ensureComposer();
            c.setPixelRatio(ratio);
            c.setSize(w, h);
        }
    };

    // Keep the canvas matched to its container when the window or pane is resized (or goes full screen)
    const resizeObserver = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        if (composer) composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    // Keyboard shortcuts (listed in the help panel). Every action goes through actionsRef so it always
    // runs the latest version of the handler.
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return; // Leave browser shortcuts (such as Ctrl +) alone
        const el = e.target as HTMLElement | null;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; // Typing
        const actions = actionsRef.current;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

        if (key === ' ' || key === 'Enter') {
            if (el && /^(BUTTON|A)$/.test(el.tagName)) return; // Space / Enter belong to the focused control
            if (arrangeRef.current) { e.preventDefault(); actions.togglePause(); }   // Go: run from the arrangement
            else if (awaitingStartRef.current) { e.preventDefault(); beginSimulationRef.current(); }
            else if (key === ' ') { e.preventDefault(); actions.togglePause(); }
            return;
        }
        if (key === 'Escape') { actions.escape(); return; } // Not prevented: Esc also leaves full screen

        const shortcuts: Record<string, () => void> = {
            '+': () => zoomByRef.current(ZOOM_STEP), '=': () => zoomByRef.current(ZOOM_STEP),
            '-': () => zoomByRef.current(1 / ZOOM_STEP), '_': () => zoomByRef.current(1 / ZOOM_STEP),
            f: () => toggleFullscreenRef.current(),
            r: actions.reset,
            ArrowLeft: actions.stepBack, ArrowRight: actions.stepForward,
            v: actions.vectors, m: actions.ruler, p: actions.screenshot, e: actions.record, a: actions.arrange,
            '1': () => actions.view('home'), '2': () => actions.view('top'), '3': () => actions.view('front'), '4': () => actions.view('side'),
            '0': actions.follow
        };
        const run = shortcuts[key];
        if (!run) return;
        e.preventDefault();
        run();
    };

    // The render loop stops while the tab is hidden, so fade continuous sounds out rather than leave them droning
    const onVisibilityChange = () => {
        if (document.hidden) simAudio.hush();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);


    // Development only: lets tests read the live physics state. Never present in a production build.
    if ((import.meta as any).env?.DEV) {
        (window as any).__simDebug = {
            world, camera, controls, objects: objectsRef, drag: dragStateRef, shake: shakeRef, speed: timeScaleRef, audio: simAudio,
            bounds: boundsRef, main: mainBodyRef, zoomGoal: zoomGoalRef,
            fx: () => ({ active: (fxActive ?? 0) > 0, level: fxLevel, composer: !!composer, toneMapping: renderer.toneMapping, pixelRatio: renderer.getPixelRatio(), shadowSpan: dirLight.shadow.camera.right }),
            // Lets tests see the full-screen presentation where the host refuses real full screen
            forceFullscreenState: setIsFullscreen,
            timeline: timelineRef, api: simApi, selected: selectedObjRef, select: (label: string) => selectObjectRef.current(objectsRef.current.find(o => o.label === label) || null),
            ruler: rulerPointsRef, theme: themeController, cameraGoal: cameraGoalRef, actions: actionsRef
        };
    }

    // Load Simulation Logic
    resetSimulation(false); // False = Reset to defaults on initial load

    // The view the "reset view" button returns to: wherever the scene's own code left the camera
    controls.update();
    homeViewRef.current = { position: camera.position.clone(), target: controls.target.clone() };
    zoomGoalRef.current = null;
    // The clipping planes the scene's code chose: the least the far zoom-out ever uses
    sceneNear = camera.near;
    sceneFar = camera.far;
    // A scene just changed by the AI (or an undo) keeps the camera where the user had it; "reset view"
    // still goes to the scene's own view
    if (simulationData.keepView && lastView) {
        camera.position.copy(lastView.position);
        controls.target.copy(lastView.target);
        controls.update();
    }

    // Rolling / sliding rumble and air whoosh, measured from the live physics state after each step
    const updateContinuousSound = (w: CANNON.World, rate: number) => { // rate: slow motion sounds slower, as it looks
        let roll = 0;
        let brightness = 0;
        const contacts = w.contacts;
        for (let i = 0; i < contacts.length; i++) {
            const c = contacts[i];
            const bi = c.bi, bj = c.bj, n = c.ni;
            const rx = bi.velocity.x - bj.velocity.x;
            const ry = bi.velocity.y - bj.velocity.y;
            const rz = bi.velocity.z - bj.velocity.z;
            const along = rx * n.x + ry * n.y + rz * n.z;
            const tx = rx - along * n.x, ty = ry - along * n.y, tz = rz - along * n.z;
            // Speed of one body across the surface of the other
            const slide = Math.sqrt(tx * tx + ty * ty + tz * tz) * rate;
            if (slide < 0.8) continue;
            const mi = bi.type === CANNON.Body.DYNAMIC && bi.mass > 0 ? bi.mass : Infinity;
            const mj = bj.type === CANNON.Body.DYNAMIC && bj.mass > 0 ? bj.mass : Infinity;
            const mass = Math.min(mi, mj);
            if (!Number.isFinite(mass)) continue;
            const weight = Math.min(Math.max(0.4 + 0.25 * Math.log10(1 + mass), 0.3), 1.2);
            const level = Math.min(slide / 18, 1) * weight;
            if (level > roll) { roll = level; brightness = Math.min(slide / 25, 1); }
        }

        let whoosh = 0;
        if (ambienceRef.current !== 'space') {
            for (const obj of objectsRef.current) {
                const b = obj.body;
                if (b.type !== CANNON.Body.DYNAMIC || b.sleepState === CANNON.Body.SLEEPING) continue;
                // Bigger and faster objects push more air
                const push = b.velocity.length() * rate * Math.sqrt(Math.max(b.boundingRadius, 0.2));
                const level = Math.min((push - 9) / 35, 1);
                if (level > whoosh) whoosh = level;
            }
        }

        const s = rollLevelRef.current;
        s.level += (roll - s.level) * 0.3;
        s.brightness += (brightness - s.brightness) * 0.3;
        s.whoosh += (whoosh - s.whoosh) * 0.2;
        simAudio.setRoll(s.level, s.brightness);
        simAudio.setWhoosh(s.whoosh);
    };

    // Scene code's per-frame callbacks (rope lines, strings, markers). One failing must not stop the rest.
    const runFrameCallbacks = () => {
        const callbacks = frameCallbacksRef.current;
        for (let i = 0; i < callbacks.length; i++) {
            try { callbacks[i](); } catch (e) {
                if (!frameErrorLogged) { frameErrorLogged = true; console.error('[AI Sandbox] A frame callback threw:', e); }
            }
        }
    };
    let frameErrorLogged = false;
    runFrameCallbacksRef.current = runFrameCallbacks;
    let followTarget: SimObject | null = null;
    const followLast = new THREE.Vector3();
    const followDelta = new THREE.Vector3();

    // --- ANIMATION LOOP ---
    const fixedTimeStep = 1 / 60;
    // Catch-up steps after a slow frame. More would make the next frame slower still (a spiral into
    // stutter); with this many, a struggling device runs the simulation slightly slower instead.
    const maxSubSteps = 5;
    let lastTime = 0;
    let soundRunning = false;
    const shakeOffset = new THREE.Vector3();
    const zoomDirection = new THREE.Vector3();

    const animate = (time: number) => {
        rafRef.current = requestAnimationFrame(animate);
        if (!lastTime) lastTime = time;
        const frameSeconds = (time - lastTime) / 1000;
        const dt = Math.min(frameSeconds, 0.1);
        lastTime = time;

        const w = worldRef.current;
        const tl = timelineRef.current;
        let running = false;
        let steppedLive = false; // The physics engine advanced this frame (as opposed to a replay or a pause)
        // An edit made at the moment shown voids whatever was recorded after it
        const commitEdit = () => {
            if (!timelineDirtyRef.current || !w) return;
            tl.truncate();
            tl.rewriteLast(w);
            timelineDirtyRef.current = false;
        };
        if (w) {
            if (arrangeRef.current) {
                // Arrange mode: time is frozen. While something is held, the physics steps with no gravity and
                // every other body pinned exactly where it is, so only the held object moves (its ropes and
                // joints still keep it on its path, and it cannot pass through its neighbours). The clock does
                // not move and nothing is recorded. Frame callbacks run so ropes and readouts follow the hand.
                // The object in hand, or the one just let go while its ropes settle (at rest, in single steps)
                const settling = !dragStateRef.current && arrangeSettleRef.current && arrangeSettleRef.current.body.world === w
                    ? arrangeSettleRef.current : null;
                if (!dragStateRef.current) arrangeSettleRef.current = settling && settling.steps > 1 ? { ...settling, steps: settling.steps - 1 } : null;
                const held = dragStateRef.current ? dragStateRef.current.body : settling ? settling.body : null;
                if (held) {
                    const clockBefore = w.time;
                    const originalGravity = w.gravity.clone();
                    w.gravity.set(0, 0, 0);
                    const pinned: [CANNON.Body, CANNON.Vec3, CANNON.Quaternion][] = [];
                    w.bodies.forEach(b => {
                        if (b === held || b.type !== CANNON.Body.DYNAMIC) return;
                        pinned.push([b, b.position.clone(), b.quaternion.clone()]);
                        b.velocity.set(0, 0, 0);
                        b.angularVelocity.set(0, 0, 0);
                    });
                    if (settling) {
                        held.velocity.set(0, 0, 0);
                        held.angularVelocity.set(0, 0, 0);
                        w.step(fixedTimeStep);
                        held.velocity.set(0, 0, 0);
                        held.angularVelocity.set(0, 0, 0);
                    } else {
                        w.step(fixedTimeStep, dt, maxSubSteps);
                    }
                    pinned.forEach(([b, p, q]) => {
                        b.position.copy(p); b.previousPosition.copy(p); b.interpolatedPosition.copy(p);
                        b.quaternion.copy(q); b.previousQuaternion.copy(q); b.interpolatedQuaternion.copy(q);
                        b.velocity.set(0, 0, 0);
                        b.angularVelocity.set(0, 0, 0);
                        b.aabbNeedsUpdate = true;
                    });
                    w.gravity.copy(originalGravity);
                    w.time = clockBefore;
                    runFrameCallbacks();
                }
            } else if (awaitingStartRef.current) {
                // Click-to-start: hold everything exactly as built (initial poses and velocities intact)
            } else if (!pausedRef.current) {
                const rate = timeScaleRef.current;
                playbackRateRef.current = rate;
                commitEdit();
                if (!tl.atEnd) {
                    // Replay: show what was recorded, exactly, until it catches up with the present
                    const from = tl.playTime;
                    const to = from + dt * rate;
                    if (to >= tl.endTime) tl.apply(w, tl.last); else tl.seek(w, to);
                    tl.eventsBetween(from, tl.playTime).forEach(ev => playImpact(ev.info, ev.speed, ev.mass));
                    runFrameCallbacks();
                } else {
                    liveStepRef.current = true;
                    w.step(fixedTimeStep, dt * rate, maxSubSteps);
                    liveStepRef.current = false;
                    runFrameCallbacks();
                    updateContinuousSound(w, rate);
                    // A real-world setting with its own motion (other bowlers on the next lanes) moves in step
                    if (settingRef.current && settingRef.current.update) settingRef.current.update(dt * rate);
                    steppedLive = true;
                }
                running = true;
            } else if (stepRequestRef.current !== 0) {
                // Paused: move one recorded frame back or forward
                const direction = stepRequestRef.current;
                stepRequestRef.current = 0;
                commitEdit();
                if (!tl.isEmpty) {
                    const onFrame = Math.abs(tl.playTime - tl.frames[tl.cursor].t) < 1e-6;
                    if (direction < 0) {
                        tl.apply(w, onFrame ? tl.cursor - 1 : tl.cursor);
                    } else if (!tl.atEnd) {
                        tl.apply(w, tl.cursor + 1);
                    } else {
                        // At the present: advance the real simulation by one frame's worth of steps
                        restoreVelocities();
                        stepCountRef.current = 0;
                        liveStepRef.current = true;
                        for (let i = 0; i < RECORD_EVERY; i++) w.step(fixedTimeStep);
                        liveStepRef.current = false;
                    }
                    captureVelocities();
                    runFrameCallbacks();
                }
            } else if (dragStateRef.current) {
                // Paused: only step while the user is dragging something, with everything else held still.
                // The simulation's clock does not move for this.
                const clockBefore = w.time;
                const originalGravity = w.gravity.clone();
                w.gravity.set(0, 0, 0);
                const draggedBody = dragStateRef.current.body;
                w.bodies.forEach(b => {
                    if (b !== draggedBody) {
                        b.velocity.set(0, 0, 0);
                        b.angularVelocity.set(0, 0, 0);
                    }
                });
                w.step(fixedTimeStep, dt, maxSubSteps);
                w.gravity.copy(originalGravity);
                w.time = clockBefore;
            }
        }
        // Rolling and air sounds stop when time stops
        if (soundRunning && !running) {
            rollLevelRef.current = { level: 0, brightness: 0, whoosh: 0 };
            simAudio.hush();
        }
        soundRunning = running;

        const drag = dragStateRef.current;
        if (dragLineRef.current && drag) {
            const b = drag.body;
            dragLineRef.current.visible = true;
            dragLineRef.current.geometry.setFromPoints([
                new THREE.Vector3(drag.target.x, drag.target.y, drag.target.z),
                new THREE.Vector3(b.position.x - drag.offset.x, b.position.y - drag.offset.y, b.position.z - drag.offset.z)
            ]);
        } else if (dragLineRef.current) {
            dragLineRef.current.visible = false;
        }

        // --- SAFE OBJECT UPDATE LOOP ---
        for (const obj of objectsRef.current) {
            if (!obj.mesh || !obj.body) continue;

            // Physics advances in fixed 1/60 s steps, so at low speed (or in slow motion) several frames
            // pass between steps. Drawing the in-between pose the engine interpolates keeps motion
            // smooth instead of jumping once per step. Only awake dynamic bodies have a valid one.
            const b = obj.body;
            const smooth = steppedLive && b.type === CANNON.Body.DYNAMIC && b.sleepState !== CANNON.Body.SLEEPING
                && !!b.interpolatedPosition && !!b.interpolatedQuaternion;

            if (b.position) {
                obj.mesh.position.copy((smooth ? b.interpolatedPosition : b.position) as any);
            }
            if (b.quaternion && obj.mesh.quaternion) {
                obj.mesh.quaternion.copy((smooth ? b.interpolatedQuaternion : b.quaternion) as any);
            }
        }

        // --- CAMERA: FOLLOW AND PRESET VIEWS ---
        // Follow: the camera keeps its angle and distance and travels with the selected object
        // (or the main object, or failing that the first thing that can move).
        if (followRef.current) {
            const selected = selectedObjRef.current;
            const target = (selected && selected.body.world === w ? selected : null)
                || objectsRef.current.find(o => o.body === mainBodyRef.current)
                || objectsRef.current.find(o => o.body.type === CANNON.Body.DYNAMIC && o.body.mass > 0)
                || null;
            if (target && target === followTarget) {
                followDelta.copy(target.mesh.position).sub(followLast);
                camera.position.add(followDelta);
                controls.target.add(followDelta);
            }
            followTarget = target;
            if (target) followLast.copy(target.mesh.position);
        } else {
            followTarget = null;
        }

        // Preset views: glide to the requested position and target
        const goal = cameraGoalRef.current;
        if (goal) {
            const k = Math.min(1, dt * 7);
            camera.position.lerp(goal.position, k);
            controls.target.lerp(goal.target, k);
            if (camera.position.distanceTo(goal.position) < 0.02) {
                camera.position.copy(goal.position);
                controls.target.copy(goal.target);
                cameraGoalRef.current = null;
            }
        }

        // --- OVERLAYS ---
        const selected = selectedObjRef.current;
        if (selected && selected.body.world === w && selected.mesh.parent) {
            selectionBox.setFromObject(selected.mesh);
            selectionBox.visible = true;
        } else {
            selectionBox.visible = false;
        }

        let arrowsUsed = 0;
        if (showVectorsRef.current && w) {
            for (const obj of objectsRef.current) {
                if (arrowsUsed >= MAX_VECTOR_ARROWS) break;
                const b = obj.body;
                if (b.type !== CANNON.Body.DYNAMIC || b.mass <= 0 || b.world !== w) continue;
                const v = b.velocity.length();
                if (v < 0.15) continue;
                const arrow = velocityArrows[arrowsUsed++];
                arrowDirection.set(b.velocity.x / v, b.velocity.y / v, b.velocity.z / v);
                const length = Math.min(0.6 + v * 0.22, 9);
                arrow.position.copy(obj.mesh.position);
                arrow.setDirection(arrowDirection);
                arrow.setLength(length, Math.min(0.5, length * 0.3), Math.min(0.28, length * 0.18));
                arrow.visible = true;
            }
        }
        for (let i = arrowsUsed; i < MAX_VECTOR_ARROWS; i++) velocityArrows[i].visible = false;

        // Weight (gravity's pull) on the selected object, while vectors are shown
        const g = w ? w.gravity.length() : 0;
        if (showVectorsRef.current && w && selected && selected.body.world === w && selected.body.mass > 0 && selected.body.type === CANNON.Body.DYNAMIC && g > 0.001) {
            arrowDirection.set(w.gravity.x / g, w.gravity.y / g, w.gravity.z / g);
            const length = Math.min(Math.max(1.1 * Math.log10(1 + selected.body.mass * g), 0.8), 7);
            weightArrow.position.copy(selected.mesh.position);
            weightArrow.setDirection(arrowDirection);
            weightArrow.setLength(length, Math.min(0.5, length * 0.3), Math.min(0.28, length * 0.18));
            weightArrow.visible = true;
        } else {
            weightArrow.visible = false;
        }

        // Ruler markers keep the same size on screen at any zoom
        const points = rulerPointsRef.current;
        if (points.length) {
            rulerDots.forEach((dot, i) => {
                if (points[i]) dot.scale.setScalar(Math.max(camera.position.distanceTo(points[i]) * 0.008, 0.03));
            });
        }

        // Zoom buttons: glide the camera along its line of sight to the requested distance
        if (zoomGoalRef.current !== null) {
            zoomDirection.copy(camera.position).sub(controls.target);
            const distance = zoomDirection.length();
            const next = distance + (zoomGoalRef.current - distance) * Math.min(1, dt * 10);
            if (distance > 0.0001) camera.position.copy(controls.target).addScaledVector(zoomDirection, next / distance);
            if (Math.abs(zoomGoalRef.current - next) < 0.01) zoomGoalRef.current = null;
        }

        controls.update();

        // Vibration: heavy impacts jolt the camera for a moment. The offset is applied for this frame's
        // render only and then removed, so it never disturbs the orbit controls.
        const shake = shakeRef.current;
        let shaken = false;
        if (vibrationRef.current && shake > 0.003) {
            const amplitude = 0.5 * shake * shakeScaleRef.current * Math.max(camera.position.distanceTo(controls.target) / 45, 0.4);
            shakeOffset.set(
                (Math.random() - 0.5) * 2 * amplitude,
                (Math.random() - 0.5) * 2 * amplitude,
                (Math.random() - 0.5) * amplitude
            );
            camera.position.add(shakeOffset);
            shaken = true;
        }
        shakeRef.current = shake * Math.exp(-dt * 9);

        // Rendering quality steps down one level at a time while this device cannot hold about 30 frames
        // a second (long pauses, such as a hidden tab, are not counted), within about a second and a half,
        // and never steps back up. The level is kept for the next scene.
        applyRenderMode(fxLevel);
        if (fxLevel > 0 && frameSeconds < 0.5) {
            slowFrames = frameSeconds > 0.034 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
            if (slowFrames > 45) {
                fxLevel--;
                shared.fxLevel = fxLevel;
                slowFrames = 0;
                console.info(`[Equilibria] Rendering quality lowered to level ${fxLevel}: the frame rate was too low on this device.`);
            }
        }
        renderFrame(fxLevel > 0, dt);
        if (shaken) camera.position.sub(shakeOffset);

        // Ruler read-out: an HTML label placed over the middle of the measured line
        const rulerLabel = rulerLabelRef.current;
        if (rulerLabel) {
            let shown = false;
            if (points.length === 2) {
                rulerMid.copy(points[0]).add(points[1]).multiplyScalar(0.5).project(camera);
                if (rulerMid.z > -1 && rulerMid.z < 1) {
                    const cw = container.clientWidth, ch = container.clientHeight;
                    rulerLabel.style.transform = `translate(-50%, -140%) translate(${((rulerMid.x + 1) / 2 * cw).toFixed(1)}px, ${((1 - rulerMid.y) / 2 * ch).toFixed(1)}px)`;
                    shown = true;
                }
            }
            rulerLabel.style.visibility = shown ? 'visible' : 'hidden';
        }

        // A still image must be read straight after the frame is drawn, before the browser clears it
        if (screenshotRequestRef.current) {
            screenshotRequestRef.current = false;
            renderer.domElement.toBlob((blob) => {
                if (blob) {
                    downloadBlob(blob, timestampName(fileBase, 'png'));
                    setToast('Screenshot saved to your downloads');
                } else {
                    setToast('The screenshot could not be created');
                }
            }, 'image/png');
        }
    };
    rafRef.current = requestAnimationFrame(animate);

    // Development only: runs the loop by hand, for tests in a window the browser is not painting
    if ((import.meta as any).env?.DEV && (window as any).__simDebug) {
        (window as any).__simDebug.tick = (frames: number, ms = 1000 / 60) => {
            let t = lastTime || performance.now();
            for (let i = 0; i < frames; i++) {
                t += ms;
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                animate(t);
            }
        };
    }

    return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        resizeObserver.disconnect();
        if (renderer.domElement) {
             renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
             if (container.contains(renderer.domElement)) {
                 container.removeChild(renderer.domElement);
             }
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        dragStateRef.current = null;
        // A recording in progress ends with this view; what was captured so far is still saved
        stopRecordingRef.current();
        settingFnsRef.current.clear();
        themeController.dispose();
        themeControllerRef.current = null;
        selectedObjRef.current = null;
        runFrameCallbacksRef.current = () => {};
        // The renderer, post-processing chain and environments are the session's and stay. The camera
        // controls listen on the shared canvas, so they go now; this scene's GPU memory is freed once the
        // next scene has been drawn, so the shaders both use stay compiled.
        lastView = { position: camera.position.clone(), target: controls.target.clone() };
        controls.dispose();
        scene.environment = null;
        window.setTimeout(() => disposeScene(scene), 2000);

        // The synthesiser is shared and stays alive; just silence this scene's continuous sounds
        simAudio.hush();
        simAudio.setAmbience('none');
    };
  }, [simulationData, resetSimulation]); // resetSimulation in deps ensures we re-run if it changes, but resetSimulation is memoized on simulationData

  const handleSliderChange = (label: string, newVal: number) => {
      setSliderValues(prev => ({ ...prev, [label]: newVal }));
      sliderValuesRef.current[label] = newVal; // Update ref to keep value on reset

      const slider = simulationData.sliders.find(s => s.label === label);
      if (!slider || !worldRef.current) return;

      if (slider.property === 'scale') changeSpeed(newVal);
      else applySlider(worldRef.current, objectsRef.current, slider, newVal, true);
      // No physics step is needed here: the render loop picks the new values up on its next frame
      // (stepping with a zero time step, as this used to, divides by zero inside the solver).
  };

  // Latest versions of the actions the keyboard shortcuts run
  actionsRef.current = {
      togglePause,
      reset: () => resetSimulation(true),
      stepBack: () => simApi.step(-1),
      stepForward: () => simApi.step(1),
      vectors: toggleVectors,
      ruler: () => setRuler(!rulerModeRef.current),
      screenshot: takeScreenshot,
      record: () => { if (canRecord) toggleRecording(); },
      view: setCameraView,
      follow: toggleFollow,
      arrange: toggleArrange,
      escape: () => {
          if (arrangeRef.current) setArrangeMode(false);
          else if (rulerModeRef.current) setRuler(false);
          else if (showCameraMenu) setShowCameraMenu(false);
          else selectObject(null);
      }
  };

  const barButton = "shrink-0 p-1.5 xl:p-2 rounded-lg transition-colors";
  const barIdle = "text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]";
  const barOn = "text-sky-300 bg-sky-500/15";
  const divider = <div className="shrink-0 w-px h-6 bg-white/10 mx-0.5"></div>;
  const recordClock = `${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, '0')}`;

  // The side panel: reopening it redraws the readout into its fresh card
  const toggleSidePanel = () => {
      readoutDirtyRef.current = true;
      setShowSettings(!showSettings);
  };

  const sliderClass = (thumb: string) => `w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:${thumb} [&::-webkit-slider-thumb]:rounded-full`;
  const card = "w-full bg-slate-900/40 border border-white/[0.06] rounded-2xl";

  // The stage: a toolbar above the view, the view itself with nothing drawn over it, a side panel beside
  // it, and a status line under it. Every control lives around the simulation, never on top of it.
  return (
    <div
        ref={stageRef}
        className="w-full h-full flex flex-col"
        style={isFullscreen ? { backgroundColor: '#0d0a18' } : undefined}
    >
      {/* Toolbar */}
      <div
          className={`shrink-0 h-12 flex items-center gap-1 px-2 border-b border-white/[0.06] bg-slate-950/25`}
          onMouseDown={(e) => e.stopPropagation()}
      >
         {/* First, for quick access: AI edit and full screen (always visible, never scrolled away) */}
         <div className="shrink-0 flex items-center gap-1">
             {onOpenChat && (
                 <button
                     onClick={onOpenChat}
                     className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium transition-colors ${aiBusy ? 'text-amber-200 bg-amber-400/15' : aiOpen ? 'text-white bg-blue-600 hover:bg-blue-500' : 'text-blue-100 bg-blue-500/20 hover:bg-blue-500/30'}`}
                     title={aiOpen ? "Close the AI edit bar" : "Change this scene with AI: add, remove or change anything"}
                     aria-label={aiOpen ? "Close the AI edit bar" : "Open the AI edit bar"}
                     aria-pressed={!!aiOpen}
                 >
                     {aiBusy ? <span className="inline-block w-3.5 h-3.5 border-2 border-amber-300/30 border-t-amber-200 rounded-full animate-spin"></span> : <Sparkles className="w-4 h-4" />}
                     <span className="hidden sm:inline">{aiBusy ? 'AI is editing…' : 'AI edit'}</span>
                 </button>
             )}
             {fullscreenSupported && (
                 <button
                     onClick={toggleFullscreen}
                     className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium transition-colors ${isFullscreen ? 'text-white bg-slate-600 hover:bg-slate-500' : 'text-slate-200 bg-white/[0.07] hover:bg-white/[0.12]'}`}
                     title={isFullscreen ? "Exit full screen ( F or Esc )" : "Full screen ( F )"}
                     aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
                 >
                     {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                     <span className="hidden xl:inline">{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
                 </button>
             )}
             <button
                 onClick={() => setRealisticEnabled(!realisticEnabled)}
                 className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium transition-colors ${realisticEnabled ? 'text-slate-900 bg-amber-300 hover:bg-amber-200' : 'text-amber-200 bg-amber-400/10 hover:bg-amber-400/20'}`}
                 title={realisticEnabled
                     ? "Realistic is on: the scene is shown where it really happens. Click for the standard view."
                     : "Realistic: show the scene where it really happens (a desk in a study, a living room, a park, a warehouse...) with the real surface and things around it"}
                 aria-pressed={realisticEnabled}
                 aria-label="Realistic view"
             >
                 <Aperture className="w-4 h-4" /> <span className="hidden xl:inline">Realistic</span>
             </button>
             {divider}
         </div>
         {toolsOverflow.left && (
             <button onClick={() => scrollTools(-1)} className="shrink-0 h-9 px-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06]" title="More tools" aria-label="Scroll the tools left">
                 <ChevronLeft className="w-4 h-4" />
             </button>
         )}
         <div
             ref={toolsRef}
             className="min-w-0 flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
             style={toolsOverflow.left || toolsOverflow.right ? {
                 maskImage: `linear-gradient(to right, ${toolsOverflow.left ? 'transparent 0, black 20px' : 'black 0'}, ${toolsOverflow.right ? 'black calc(100% - 20px), transparent 100%' : 'black 100%'})`,
                 WebkitMaskImage: `linear-gradient(to right, ${toolsOverflow.left ? 'transparent 0, black 20px' : 'black 0'}, ${toolsOverflow.right ? 'black calc(100% - 20px), transparent 100%' : 'black 100%'})`
             } : undefined}
             onWheel={(e) => {
                 // A mouse wheel scrolls the tools sideways when they do not all fit
                 const el = toolsRef.current;
                 if (el && el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
             }}
             data-tour="toolbar"
         >
             <button
                 onClick={togglePause}
                 className={`shrink-0 flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[12px] font-medium transition-colors ${paused ? 'text-amber-200 bg-amber-400/15 hover:bg-amber-400/25' : 'text-slate-100 bg-white/[0.06] hover:bg-white/[0.1]'}`}
                 title={paused ? "Play: let time run again ( Space )" : "Pause: freeze time ( Space )"}
                 aria-label={paused ? "Play" : "Pause"}
             >
                 {paused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
                 <span className="hidden xl:inline w-9 text-left">{paused ? 'Play' : 'Pause'}</span>
             </button>
             <button onClick={() => resetSimulation(true)} className={`${barButton} flex items-center gap-1.5 ${barIdle}`} title="Reset: start the scene again ( R )" aria-label="Reset simulation">
                 <RotateCcw className="w-[18px] h-[18px]" />
                 <span className="hidden 2xl:inline text-[12px] font-medium pr-0.5">Reset</span>
             </button>
             <button
                 onClick={toggleArrange}
                 className={`${barButton} flex items-center gap-1.5 ${arranging ? 'text-amber-200 bg-amber-400/15 pr-3' : barIdle}`}
                 title={arranging ? "Done arranging: let time run again ( A )" : "Arrange: freeze time and place objects by hand ( A )"}
                 aria-label={arranging ? "Done arranging" : "Arrange objects by hand"}
                 aria-pressed={arranging}
             >
                 <Hand className="w-[18px] h-[18px]" />
                 {arranging && <span className="text-[12px] font-medium">Arranging</span>}
             </button>
             <button onClick={() => spawnObject('box')} className={`${barButton} ${barIdle}`} title="Add a box" aria-label="Add a box">
                 <Square className="w-[18px] h-[18px]" />
             </button>
             <button onClick={() => spawnObject('sphere')} className={`${barButton} ${barIdle}`} title="Add a sphere" aria-label="Add a sphere">
                 <Circle className="w-[18px] h-[18px]" />
             </button>
             {divider}
             {canRecord && (
                 <button
                     onClick={toggleRecording}
                     className={`${barButton} flex items-center gap-1.5 ${recording ? 'text-red-300 bg-red-500/15 pr-3' : barIdle}`}
                     title={recording ? "Stop recording and save the video ( E )" : "Record a video of the simulation ( E )"}
                     aria-label={recording ? "Stop recording" : "Record video"}
                     aria-pressed={recording}
                 >
                     {recording
                         ? <><span className="relative flex h-[18px] w-[18px] items-center justify-center"><span className="relative h-2.5 w-2.5 rounded-xs bg-red-400 animate-pulse"></span></span><span className="text-[12px] tabular-nums">{recordClock}</span></>
                         : <Video className="w-[18px] h-[18px]" />}
                 </button>
             )}
             <button onClick={takeScreenshot} className={`${barButton} ${barIdle}`} title="Save a screenshot ( P )" aria-label="Save a screenshot">
                 <Camera className="w-[18px] h-[18px]" />
             </button>
             {divider}
             <button onClick={() => setRuler(!rulerMode)} className={`${barButton} ${rulerMode ? barOn : barIdle}`} title="Ruler: measure the distance between two points ( M )" aria-label="Ruler" aria-pressed={rulerMode}>
                 <Ruler className="w-[18px] h-[18px]" />
             </button>
             <button onClick={() => { if (!showStopwatch && !showSettings) toggleSidePanel(); setShowStopwatch(!showStopwatch); }} className={`${barButton} ${showStopwatch ? barOn : barIdle}`} title="Stopwatch (opens in the side panel)" aria-label="Stopwatch" aria-pressed={showStopwatch}>
                 <Timer className="w-[18px] h-[18px]" />
             </button>
             <button onClick={toggleVectors} className={`${barButton} ${showVectors ? barOn : barIdle}`} title="Show velocity arrows ( V )" aria-label="Velocity arrows" aria-pressed={showVectors}>
                 <MoveUpRight className="w-[18px] h-[18px]" />
             </button>
             {sourceVideoUrl && (
                 <button onClick={() => { if (!showCompare && !showSettings) toggleSidePanel(); setShowCompare(!showCompare); }} className={`${barButton} ${showCompare ? barOn : barIdle}`} title="Compare with your video (opens in the side panel)" aria-label="Compare with your video" aria-pressed={showCompare}>
                     <PictureInPicture2 className="w-[18px] h-[18px]" />
                 </button>
             )}
             {divider}
             <button onClick={handleSoundToggle} className={`${barButton} ${barIdle}`} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"}>
                 {muted ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
             </button>
         </div>
         {toolsOverflow.right && (
             <button onClick={() => scrollTools(1)} className="shrink-0 h-9 px-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06]" title="More tools" aria-label="Scroll the tools right">
                 <ChevronRight className="w-4 h-4" />
             </button>
         )}

         <div className="flex-1"></div>

         <div className="shrink-0 flex items-center gap-0.5">
             {/* Below xl the wheel, a pinch or the + and - keys zoom, which leaves room for the tools */}
             <button onClick={() => zoomBy(1 / ZOOM_STEP)} className={`${barButton} ${barIdle} hidden xl:block`} title="Zoom out ( - )" aria-label="Zoom out">
                 <ZoomOut className="w-[18px] h-[18px]" />
             </button>
             <button onClick={() => zoomBy(ZOOM_STEP)} className={`${barButton} ${barIdle} hidden xl:block`} title="Zoom in ( + )" aria-label="Zoom in">
                 <ZoomIn className="w-[18px] h-[18px]" />
             </button>
             {/* On a phone, "Scene view" in the camera menu does the same, which leaves room for the tools */}
             <button onClick={resetView} className={`${barButton} ${barIdle} hidden sm:block`} title="Reset view ( 1 )" aria-label="Reset view">
                 <LocateFixed className="w-[18px] h-[18px]" />
             </button>
             <div className="relative">
                 <button onClick={() => setShowCameraMenu(!showCameraMenu)} className={`${barButton} ${showCameraMenu || follow ? barOn : barIdle}`} title="Camera views" aria-label="Camera views" aria-expanded={showCameraMenu}>
                     <Eye className="w-[18px] h-[18px]" />
                 </button>
                 {showCameraMenu && (
                     <div className="absolute top-full right-0 mt-2 z-30 w-48 p-1.5 bg-slate-900/95 backdrop-blur-xl border border-white/[0.08] rounded-xl shadow-calm">
                         <div className="px-2 py-1 text-[12px] font-medium text-slate-400">Camera</div>
                         {([['home', 'Scene view', '1'], ['top', 'Top', '2'], ['front', 'Front', '3'], ['side', 'Side', '4']] as [CameraView, string, string][]).map(([view, name, key]) => (
                             <button key={view} onClick={() => { setCameraView(view); setShowCameraMenu(false); }} className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-slate-200 hover:bg-white/[0.06]">
                                 <span>{name}</span><kbd className="text-[10px] font-mono text-slate-500">{key}</kbd>
                             </button>
                         ))}
                         <button onClick={toggleFollow} className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs ${follow ? 'text-sky-300 bg-sky-500/15' : 'text-slate-200 hover:bg-white/[0.06]'}`} aria-pressed={follow}>
                             <span className="flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5" /> Follow object</span><kbd className="text-[10px] font-mono text-slate-500">0</kbd>
                         </button>
                         <p className="px-2 pt-1 text-[11px] leading-snug text-slate-500">Follow tracks the selected object, or the main one.</p>
                     </div>
                 )}
             </div>
             <div className="hidden sm:block">{divider}</div>
             {/* Help is mostly keyboard shortcuts, so phones find it in the menu instead */}
             {onOpenHelp && (
                 <button onClick={onOpenHelp} className={`${barButton} ${barIdle} hidden sm:block`} title="Keyboard shortcuts and help ( ? )" aria-label="Help">
                     <HelpCircle className="w-[18px] h-[18px]" />
                 </button>
             )}
             <button onClick={toggleSidePanel} className={`${barButton} ${showSettings ? barOn : barIdle}`} title={showSettings ? "Hide the side panel" : "Show the readout and settings"} aria-label={showSettings ? "Hide the side panel" : "Show the side panel"} aria-pressed={showSettings}>
                 {showSettings ? <PanelRightClose className="w-[18px] h-[18px]" /> : <PanelRightOpen className="w-[18px] h-[18px]" />}
             </button>
         </div>
      </div>

      {/* The view, with nothing over it, and the side panel beside it */}
      <div className="flex-1 min-h-0 flex">
        <div
            ref={containerRef}
            className={`relative flex-1 min-w-0 overflow-hidden ${rulerMode ? 'cursor-crosshair' : ''} ${arranging ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
          {/* Arranging: a soft frame around the view (drawn on its edge, never over the scene) */}
          {arranging && <div className="absolute inset-0 z-10 pointer-events-none rounded-xs ring-2 ring-inset ring-amber-300/50"></div>}
          {/* Ruler: the distance, placed on the measured line by the render loop (it belongs to the line) */}
          <div ref={rulerLabelRef} className="absolute top-0 left-0 z-10 pointer-events-none px-2 py-1 rounded-md bg-yellow-300 text-slate-900 text-xs font-bold font-mono shadow-lg whitespace-nowrap" style={{ visibility: 'hidden' }}>
              {rulerInfo.distance.toFixed(2)} m
          </div>
        </div>

        {showSettings && (
          <aside
              className={`w-[min(300px,45%)] shrink-0 border-l border-white/[0.06] bg-slate-950/20 overflow-y-auto p-3 space-y-3`}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Readout and settings"
          >
              {/* The scene's live readout (filled in by the effect above; hidden until the scene reports something) */}
              <div
                  ref={readoutPanelRef}
                  className={`${card} px-3.5 py-3 text-[12px]`}
                  style={{ display: 'none' }}
                  role="status"
                  aria-live="off"
              ></div>

              {/* Object Inspector: live data and editing for the selected object */}
              {selectedLabel && editInfo && (
                  <ObjectInspector
                      label={selectedLabel}
                      api={simApi}
                      info={editInfo}
                      panelRef={inspectorRef}
                      onClose={() => selectObject(null)}
                      onMass={updateSelectedMass}
                      onScale={updateSelectedScale}
                      onRotate={updateSelectedRotation}
                      onColor={updateSelectedColor}
                      onSound={updateSelectedSound}
                      onBounce={updateSelectedBounce}
                      onDuplicate={duplicateSelected}
                      onDelete={deleteSelected}
                  />
              )}

              {showStopwatch && <Stopwatch api={simApi} onClose={() => setShowStopwatch(false)} />}

              {sourceVideoUrl && showCompare && (
                  <ComparePanel url={sourceVideoUrl} api={simApi} onClose={() => setShowCompare(false)} />
              )}

              {/* Settings */}
              <div className={`${card} flex flex-col overflow-hidden`}>
                  <div className="h-9 shrink-0 border-b border-white/[0.05] flex items-center px-3 select-none">
                      <div className="flex items-center gap-1.5 text-slate-300 text-[12px] font-medium">
                          <Sliders className="w-3.5 h-3.5 text-blue-300" /> Settings
                      </div>
                  </div>
                  <div className="flex shrink-0 p-1.5 gap-1 bg-black/20">
                      <button
                          onClick={() => setSettingsTab('physics')}
                          className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium transition-colors flex items-center justify-center gap-1 ${settingsTab === 'physics' ? 'bg-slate-700/80 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                          <MoveDiagonal className="w-3 h-3" /> Physics
                      </button>
                      <button
                          onClick={() => setSettingsTab('environment')}
                          className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium transition-colors flex items-center justify-center gap-1 ${settingsTab === 'environment' ? 'bg-slate-700/80 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                          <Sun className="w-3 h-3" /> Scene
                      </button>
                  </div>

                  <div className="p-3 space-y-3">
                      {settingsTab === 'physics' ? (
                          <>
                              {/* Speed: built in for every simulation */}
                              <div className="space-y-1.5 pb-3 border-b border-white/5">
                                  <div className="flex justify-between gap-2 text-[12px] leading-tight text-slate-200">
                                      <span className="flex items-center gap-1 font-medium"><Gauge className="w-3.5 h-3.5 text-emerald-400" /> Speed</span>
                                      <span className="font-mono tabular-nums text-emerald-300">{speed.toFixed(2)}×</span>
                                  </div>
                                  <input
                                      type="range"
                                      aria-label="Simulation speed"
                                      min={SPEED_MIN} max={SPEED_MAX} step={0.05}
                                      value={speed}
                                      onChange={(e) => changeSpeed(parseFloat(e.target.value))}
                                      className={sliderClass('bg-emerald-400')}
                                  />
                                  <div className="flex gap-1">
                                      {SPEED_PRESETS.map(preset => (
                                          <button
                                              key={preset}
                                              onClick={() => changeSpeed(preset)}
                                              className={`flex-1 py-0.5 rounded-sm text-[11px] font-mono transition-colors ${Math.abs(speed - preset) < 0.001 ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40' : 'bg-slate-800 text-slate-400 border border-transparent hover:text-slate-200'}`}
                                          >
                                              {preset}×
                                          </button>
                                      ))}
                                  </div>
                              </div>

                              {/* A simulation's own 'scale' slider is replaced by the Speed control above */}
                              {simulationData.sliders.filter(s => s.property !== 'scale').map((s, i) => (
                                  <div key={i} className="space-y-1.5">
                                      <div className="flex justify-between gap-2 text-[12px] leading-tight text-slate-300">
                                          <span>{s.label}</span>
                                          <span className="font-mono tabular-nums text-slate-400">{sliderValues[s.label]?.toFixed(2)}</span>
                                      </div>
                                      <input
                                          type="range"
                                          aria-label={s.label}
                                          min={s.min} max={s.max} step={s.step || 0.1}
                                          value={sliderValues[s.label] ?? s.value}
                                          onChange={(e) => handleSliderChange(s.label, parseFloat(e.target.value))}
                                          className={sliderClass('bg-blue-400')}
                                      />
                                  </div>
                              ))}
                          </>
                      ) : (
                          <>
                              {/* Backdrop: the sky and lighting only; the scene's objects stay as they are */}
                              <div className="space-y-2 pb-3 border-b border-white/5">
                                  <div className="text-[12px] leading-tight text-slate-200 font-medium">Backdrop</div>
                                  <div className="grid grid-cols-3 gap-1.5">
                                      {THEMES.map(t => (
                                          <button
                                              key={t.id}
                                              onClick={() => changeTheme(t.id)}
                                              title={`${t.label}: ${t.blurb}`}
                                              aria-label={`${t.label} backdrop`}
                                              aria-pressed={theme === t.id}
                                              className={`relative h-12 rounded-lg overflow-hidden border transition-all duration-150 ${theme === t.id ? 'border-violet-300 ring-2 ring-violet-400/70 shadow-[0_0_14px_rgba(167,139,250,0.45)]' : 'border-white/10 hover:border-white/35 hover:-translate-y-px'}`}
                                              style={{ background: t.swatch }}
                                          >
                                              <span className="absolute inset-x-0 bottom-0 px-1.5 pt-3 pb-1 text-left text-[10px] font-medium leading-none bg-gradient-to-t from-[rgba(0,0,0,0.65)] to-transparent" style={{ color: '#ffffff' }}>{t.label}</span>
                                          </button>
                                      ))}
                                  </div>
                                  <div className="text-[11px] text-slate-400">{THEMES.find(t => t.id === theme)?.blurb ?? 'Your own background colour'}</div>
                              </div>
                              <div className="space-y-1.5">
                                  <div className="flex justify-between gap-2 text-[12px] leading-tight text-slate-300">
                                      <span className="flex items-center gap-1"><Volume2 className="w-3.5 h-3.5" /> Sound volume</span>
                                      <span className="font-mono text-slate-400">{muted ? 'muted' : `${Math.round(volume * 100)}%`}</span>
                                  </div>
                                  <input
                                      type="range" min="0" max="1" step="0.05"
                                      aria-label="Sound volume"
                                      value={volume}
                                      onChange={(e) => { simAudio.unlock(); setVolume(parseFloat(e.target.value)); if (muted) setMuted(false); }}
                                      className={sliderClass('bg-amber-400')}
                                  />
                              </div>
                              <label className="flex items-center justify-between gap-2 text-[12px] leading-tight text-slate-300 cursor-pointer" title="Camera shake on heavy impacts, plus device vibration on phones that support it">
                                  <span className="flex items-center gap-1"><Vibrate className="w-3.5 h-3.5" /> Vibration</span>
                                  <input
                                      type="checkbox"
                                      checked={vibration}
                                      onChange={(e) => setVibration(e.target.checked)}
                                      className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                                  />
                              </label>
                              <div className="space-y-1.5">
                                  <div className="text-[12px] leading-tight text-slate-300">Background colour</div>
                                  <input
                                      type="color"
                                      aria-label="Background colour"
                                      value={bgColor}
                                      onChange={(e) => changeBackground(e.target.value)}
                                      className="w-full h-7 rounded-sm cursor-pointer bg-transparent"
                                  />
                              </div>
                              <div className="space-y-1.5">
                                  <div className="text-[12px] leading-tight text-slate-300">Light intensity</div>
                                  <input
                                      type="range" min="0" max="5" step="0.1"
                                      aria-label="Light intensity"
                                      value={lightSettings.intensity}
                                      onChange={(e) => updateLighting({ ...lightSettings, intensity: parseFloat(e.target.value) })}
                                      className={sliderClass('bg-amber-400')}
                                  />
                              </div>
                              <div className="space-y-1.5">
                                  <div className="text-[12px] leading-tight text-slate-300">Sun position (azimuth)</div>
                                  <input
                                      type="range" min="0" max="360"
                                      aria-label="Sun position"
                                      value={lightSettings.azimuth}
                                      onChange={(e) => updateLighting({ ...lightSettings, azimuth: parseFloat(e.target.value) })}
                                      className={sliderClass('bg-amber-400')}
                                  />
                              </div>
                          </>
                      )}
                  </div>
              </div>
          </aside>
        )}
      </div>

      {/* Status line under the view: the start prompt, measuring hints and short confirmations */}
      <div
          className={`shrink-0 min-h-[40px] flex items-center gap-3 px-3 py-1.5 border-t border-white/[0.06] bg-slate-950/25 text-[12px]`}
          role="status"
          aria-live="polite"
          onMouseDown={(e) => e.stopPropagation()}
      >
          {arranging ? (
              <span className="min-w-0 flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-200">
                      <Hand className="w-3.5 h-3.5" />
                  </span>
                  <span className="truncate">
                      <span className="font-medium text-amber-100">Arrange mode: time is frozen</span>
                      <span className="text-slate-400"> · Drag any object to place it; it stays where you let go. Press Play or Space to run from here.</span>
                  </span>
              </span>
          ) : awaitingStart ? (
              <span className="min-w-0 flex items-center gap-2.5">
                  <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400/25 animate-[breathe_4s_ease-in-out_infinite]"></span>
                      <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
                          <MousePointerClick className="w-3.5 h-3.5" />
                      </span>
                  </span>
                  <span className="truncate">
                      <span className="font-medium text-slate-50">{rulerMode ? 'Finish measuring, then click the view to start' : (simulationData.startHint || 'Click anywhere to start')}</span>
                      <span className="text-slate-400"> · No rush: drag to look around first</span>
                  </span>
              </span>
          ) : rulerMode ? (
              <span className="min-w-0 flex items-center gap-2.5">
                  <Ruler className="w-3.5 h-3.5 shrink-0 text-yellow-300" />
                  {rulerInfo.points === 2 ? (
                      <span className="font-mono truncate">
                          <span className="text-yellow-300 font-bold">{rulerInfo.distance.toFixed(2)} m</span>
                          <span className="text-slate-400"> · across {Math.hypot(rulerInfo.dx, rulerInfo.dz).toFixed(2)} · up {rulerInfo.dy.toFixed(2)}</span>
                      </span>
                  ) : (
                      <span className="text-slate-300 truncate">{rulerInfo.points === 0 ? 'Click the first point' : 'Click the second point'}</span>
                  )}
                  <button onClick={() => setRuler(false)} className="shrink-0 px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-[11px] font-medium">Done</button>
              </span>
          ) : (
              <span className="min-w-0 truncate text-slate-500">Drag to look around · scroll to zoom · click an object to see its data</span>
          )}
          {toast && (
              <span className="ml-auto shrink-0 flex items-center gap-1.5 text-slate-100">
                  <Check className="w-3.5 h-3.5 text-blue-300" /> {toast}
              </span>
          )}
      </div>

      {/* The "Change with AI" bar (from the app) */}
      {footer}
    </div>
  );
};
