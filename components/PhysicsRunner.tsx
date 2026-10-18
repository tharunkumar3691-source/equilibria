import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SimulationData } from '../types';
import { FloorBounds, findFloor, pickMainBody, addBoundaryWalls, enforceBounds, clampDragGoal } from '../lib/bounds';
import { simAudio, impactStrength, inferSoundMaterial, isSoundMaterial, AMBIENCES, Ambience, SoundMaterial, ImpactInfo } from '../lib/audio';
import { SweepBroadphase } from '../lib/broadphase';
import { compileScene, createRope } from '../lib/sandbox';
import { frameShot, shotPoints } from '../lib/framing';
import { createHuman, isHumanKind, Human } from '../lib/humans';
import { realMaterial, addGround } from '../lib/sceneKit';
import { Timeline } from '../lib/timeline';
import { ThemeController, THEMES, ThemeId } from '../lib/themes';
import { SceneRecorder, recordingSupported, downloadBlob, timestampName } from '../lib/capture';
import { bodyStats, hasEditableShapes, isConstrained, scaleBody, duplicateBody, getBodyBounce, setBodyBounce } from '../lib/objects';
import { safeFileName } from '../lib/library';
import { SimApi } from '../lib/simApi';
import { ObjectInspector, ObjectEditInfo } from './ObjectInspector';
import { ComparePanel } from './ComparePanel';
import { Stopwatch } from './Stopwatch';
import { Sliders, RotateCcw, MoveDiagonal, Play, Pause, Settings2, X, Sun, Plus, Square, Circle, Volume2, VolumeX, Minus, MousePointerClick, Gauge, Vibrate, ZoomIn, ZoomOut, Maximize, Minimize, Aperture, LocateFixed, Video, Camera, Ruler, Timer, MoveUpRight, PictureInPicture2, HelpCircle, Eye, Crosshair } from 'lucide-react';

interface PhysicsRunnerProps {
  simulationData: SimulationData;
  onError?: (error: string) => void;
  // The clip this simulation was generated from, when there is one (enables the side-by-side view)
  sourceVideoUrl?: string | null;
  onOpenHelp?: () => void;
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
const ZOOM_MAX_DISTANCE = 220;

// Realistic mode (full screen)
const CINEMA_UI_IDLE_MS = 2600;       // Controls fade out after this long without pointer movement
const CINEMA_ORBIT_IDLE_MS = 4000;    // The camera starts drifting around the scene after this long

const SPEED_MIN = 0.1;
const SPEED_MAX = 3;
const SPEED_PRESETS = [0.25, 0.5, 1, 2];
const clampSpeed = (v: number) => Math.min(Math.max(v, SPEED_MIN), SPEED_MAX);

type SettingsTab = 'physics' | 'environment';

export const PhysicsRunner: React.FC<PhysicsRunnerProps> = ({ simulationData, onError, sourceVideoUrl, onOpenHelp }) => {
  const containerRef = useRef<HTMLDivElement>(null);

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
  const themeRef = useRef<ThemeId>('original');
  const [theme, setTheme] = useState<ThemeId>('original');
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
      screenshot: noop, record: noop, follow: noop, escape: noop, view: (_view: CameraView) => {}
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

  // Realistic mode: read by the render loop, so mirrored in refs
  const cinematicRef = useRef(false);
  const lastPointerMoveRef = useRef(0);

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
  const [cinematicEnabled, setCinematicEnabled] = useState(true);
  const [uiHidden, setUiHidden] = useState(false);
  const cinematic = isFullscreen && cinematicEnabled;

  // Selection / Editing. The selected object itself lives in selectedObjRef (labels are not unique:
  // every brick in a wall shares one); the state holds what the inspector shows for it.
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [editInfo, setEditInfo] = useState<ObjectEditInfo | null>(null);

  // Unified Settings Panel State
  const [showSettings, setShowSettings] = useState(false);
  const [isSettingsMinimized, setIsSettingsMinimized] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('physics');
  const [lightSettings, setLightSettings] = useState({
      intensity: 1.5,
      ambient: 0.4,
      azimuth: 45, 
      elevation: 60 
  });
  const [bgColor, setBgColor] = useState('#0f172a');

  // Panel Positions
  // x < 0 means "not dragged yet": the panel stays docked in the top-right corner
  const [settingsPos, setSettingsPos] = useState({ x: -1, y: -1 });
  const settingsSize = { w: 190, h: 340 };
  const settingsRef = useRef<HTMLDivElement>(null);

  const [inspectorPos, setInspectorPos] = useState({ x: 12, y: 64 });
  const inspectorRef = useRef<HTMLDivElement>(null);

  // Drag System (UI Panels)
  const [isDraggingUI, setIsDraggingUI] = useState(false);
  const dragRef = useRef<{
    target: 'settings' | 'inspector';
    startX: number; 
    startY: number; 
    startPosX: number; 
    startPosY: number;
  }>({ target: 'settings', startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

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
    setPausedState(!pausedRef.current);
    // Don't deselect label on pause, it's annoying for editing
  };

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
      if (themeControllerRef.current) themeControllerRef.current.apply(id);
  };

  // --- FULL SCREEN & CINEMATIC MODE ---
  const toggleFullscreen = () => {
      const el = containerRef.current;
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
      const onChange = () => setIsFullscreen(!!containerRef.current && document.fullscreenElement === containerRef.current);
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
      cinematicRef.current = cinematic;
      lastPointerMoveRef.current = performance.now();
      if (!cinematic) setUiHidden(false);
  }, [cinematic]);

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
          title.className = 'text-[10px] font-bold uppercase tracking-widest text-sky-300 mb-1.5';
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

  // In realistic mode the controls fade away while the pointer rests and return when it moves
  useEffect(() => {
      if (!cinematic) return;
      const el = containerRef.current;
      if (!el) return;
      const wake = () => {
          lastPointerMoveRef.current = performance.now();
          setUiHidden(false);
      };
      const timer = window.setInterval(() => {
          if (performance.now() - lastPointerMoveRef.current > CINEMA_UI_IDLE_MS) setUiHidden(true);
      }, 400);
      el.addEventListener('pointermove', wake);
      el.addEventListener('pointerdown', wake);
      window.addEventListener('keydown', wake);
      return () => {
          window.clearInterval(timer);
          el.removeEventListener('pointermove', wake);
          el.removeEventListener('pointerdown', wake);
          window.removeEventListener('keydown', wake);
      };
  }, [cinematic]);

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
      if (controller) controller.apply('original');
      themeRef.current = 'original';
      setTheme('original');
      scene.background = new THREE.Color(hex);
      const fog = scene.fog as THREE.Fog | null;
      if (fog && fog.color) fog.color.set(hex);
      if (controller) controller.capture();
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
    scrubResumeRef.current = false;
    stepRequestRef.current = 0;
    selectObjectRef.current(null);
    if (controlsRef.current) controlsRef.current.enabled = true; // Ensure controls are re-enabled

    // The scene's own backdrop and lighting come back before it is rebuilt (the theme is re-applied below)
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
    generatedMeshesRef.current.forEach(mesh => {
        if (!mesh) return;
        if (mesh.parent) mesh.parent.remove(mesh);
        
        // Dispose geometry/material if possible
        mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            }
        });
    });
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
   const addHuman = (kind: string, options?: { height?: number; pose?: (human: Human) => void }) => {
       const safeKind = isHumanKind(kind) ? kind : 'man';
       if (safeKind !== kind) console.warn(`[AI Sandbox] addHuman: unknown kind '${kind}'. Use 'man' or 'woman'.`);
       const pose = options && typeof options.pose === 'function' ? options.pose : null;
       const sceneAtBuild = sceneRef.current;
       const callbacks = frameCallbacksRef.current;
       const human = createHuman(safeKind, options && Number(options.height), h => {
           // The scene may have been rebuilt while the model loaded; this figure is then gone
           if (frameCallbacksRef.current !== callbacks || !pose) return;
           try { pose(h); } catch (e) { console.error('[AI Sandbox] addHuman: pose threw:', e); }
       });
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
           realMaterial, (kind: string) => addGround(sceneProxy, world, kind));
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
    }
    simAudio.setAmbience(ambienceRef.current);

    // The freshly built scene's look is its 'original'; the chosen environment theme goes on top
    if (themeControllerRef.current) {
        themeControllerRef.current.capture();
        themeControllerRef.current.apply(themeRef.current);
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
        sceneRef.current.add(outline);
        generatedMeshesRef.current.push(outline);
    }
    boundsRef.current = bounds;
    mainBodyRef.current = main;
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
        
        // Apply physics params ('scale' is handled by the Speed control above)
        if (slider.property === 'scale') {
            return;
        } else if (slider.targetLabel === 'world' && slider.property === 'gravity') {
            worldRef.current!.gravity.y = -Math.abs(val); 
        } else if (slider.targetLabel === 'world' && slider.property === 'damping') {
             worldRef.current!.bodies.forEach(b => {
                 if (b.mass > 0) b.linearDamping = val;
             });
        }

        const targets = objectsRef.current.filter(o => o.label === slider.targetLabel || o.label.startsWith(slider.targetLabel + '_'));
        targets.forEach(obj => {
             if (slider.property === 'mass') {
                obj.body.mass = val;
                obj.body.updateMassProperties();
             } else if (slider.property === 'damping') {
                obj.body.linearDamping = val;
                obj.body.angularDamping = val;
             }
        });
    });
    setSliderValues(newValues);
    sliderValuesRef.current = newValues; // Sync Ref
    
    // Speed is always available, so the panel always has something to show
    setShowSettings(true);

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

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = ZOOM_MIN_DISTANCE;
    controls.maxDistance = ZOOM_MAX_DISTANCE;
    controls.autoRotateSpeed = 0.7; // Used by realistic mode: one slow orbit in about 85 seconds
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
    // Drag steering: runs before every physics step while something is held.
    // The held body's velocity is set toward the cursor, its spin is cancelled and gravity is offset,
    // so it follows the pointer smoothly without swinging, spinning or building up energy.
    const dragVelocity = new CANNON.Vec3();
    const dragGoal = new CANNON.Vec3();
    world.addEventListener('preStep', () => {
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
        );        const dragSpeed = dragVelocity.length();
        if (dragSpeed > DRAG_MAX_SPEED) dragVelocity.scale(DRAG_MAX_SPEED / dragSpeed, dragVelocity);
        b.velocity.copy(dragVelocity);
        b.angularVelocity.set(0, 0, 0);
        // Offset gravity for the held body (forces are cleared after every step)
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
        if (awaitingStartRef.current) {
            // Waiting for the start click: nothing can be grabbed yet, but the camera can still be orbited
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
    // Always: light from a sky-and-ground environment (natural soft fill and real reflections on shiny
    // surfaces) in place of most of the flat ambient light, with neutral tone mapping (true colours,
    // soft highlights). Realistic mode (full screen) adds ambient occlusion, multisampled anti-aliasing
    // and a faint glow on the very brightest highlights; that chain is built on first use.
    let composer: any = null;
    let environment: THREE.Texture | null = null;
    let fxActive: boolean | null = null;  // What the renderer is currently set up for (null: not yet)
    let fxDisabled = false;   // Set when this device cannot keep up; the rest of realistic mode stays on
    let slowFrames = 0;
    const ensureComposer = () => {
        if (composer) return composer;
        const size = renderer.getSize(new THREE.Vector2());
        // Multisampled, or the post-processing chain would lose the renderer's anti-aliasing
        composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
        composer.addPass(new RenderPass(scene, camera));
        // Ambient occlusion: the soft darkening where objects meet the floor and each other
        const ao = new GTAOPass(scene, camera, size.x, size.y);
        ao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
        ao.blendIntensity = 0.85;
        composer.addPass(ao);
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.3, 1.0));
        composer.addPass(new OutputPass()); // Applies the tone mapping and converts to screen colours
        return composer;
    };
    // Sky above, a darker ground below and a soft horizon between: tops of objects catch the most
    // light, sides less and undersides little, as outdoors, and shiny surfaces reflect a horizon.
    const ensureEnvironment = () => {
        if (environment) return environment;
        const sky = new THREE.Color(0.95, 0.98, 1.0), horizon = new THREE.Color(0.5, 0.5, 0.52), ground = new THREE.Color(0.1, 0.095, 0.09);
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
        const pmrem = new THREE.PMREMGenerator(renderer);
        environment = pmrem.fromScene(envScene, 0.02).texture;
        pmrem.dispose();
        geometry.dispose();
        material.dispose();
        return environment;
    };
    // The environment takes over most of the flat ambient light and follows its strength, so dark
    // scenes (night, space, the solar system) stay dark. The ambient is put back after the frame.
    const renderFrame = (fx: boolean, dt: number) => {
        const ambient = ambientLight.intensity;
        scene.environmentIntensity = Math.min(ambient * 1.1, 0.8);
        ambientLight.intensity = ambient * 0.2;
        if (fx) ensureComposer().render(dt);
        else renderer.render(scene, camera);
        ambientLight.intensity = ambient;
    };
    const applyRenderMode = (fx: boolean) => {
        if (fx === fxActive) return;
        fxActive = fx;
        const ratio = fx ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
        renderer.setPixelRatio(ratio);
        renderer.toneMapping = THREE.NeutralToneMapping;
        renderer.toneMappingExposure = 1;
        scene.environment = ensureEnvironment();
        const w = container.clientWidth, h = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        if (fx) {
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
            if (awaitingStartRef.current) { e.preventDefault(); beginSimulationRef.current(); }
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
            v: actions.vectors, m: actions.ruler, p: actions.screenshot, e: actions.record,
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
            bounds: boundsRef, main: mainBodyRef, cinematic: cinematicRef, zoomGoal: zoomGoalRef,
            fx: () => ({ active: fxActive, disabled: fxDisabled, composer: !!composer, toneMapping: renderer.toneMapping, pixelRatio: renderer.getPixelRatio() }),
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
    const maxSubSteps = 10;
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
        const cinema = cinematicRef.current;

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
            if (awaitingStartRef.current) {
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

        // Realistic mode: once the pointer has rested, the camera drifts slowly around the scene.
        // (The controls pause the drift by themselves while the user is orbiting.)
        controls.autoRotate = cinema && !drag && time - lastPointerMoveRef.current > CINEMA_ORBIT_IDLE_MS;
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

        // Realistic mode renders through its own chain; if this device cannot hold a usable frame
        // rate with it, fall back to the plain renderer and keep the rest of realistic mode.
        const fx = cinema && !fxDisabled;
        applyRenderMode(fx);
        if (fx) {
            if (frameSeconds < 0.5) slowFrames = frameSeconds > 0.05 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
            if (slowFrames > 90) {
                fxDisabled = true;
                console.info('[Simul-AI-tor] Realistic rendering switched off: the frame rate was too low on this device.');
            }
        }
        renderFrame(fx, dt);
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
        themeController.dispose();
        themeControllerRef.current = null;
        selectedObjRef.current = null;
        runFrameCallbacksRef.current = () => {};
        if (composer) composer.dispose();
        if (environment) environment.dispose();
        renderer.dispose();

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

      if (slider.property === 'scale') {
          changeSpeed(newVal);
      } else if (slider.targetLabel === 'world') {
          if (slider.property === 'gravity') worldRef.current.gravity.y = -Math.abs(newVal);
          if (slider.property === 'damping') worldRef.current.bodies.forEach(b => b.linearDamping = newVal);
          if (slider.property === 'restitution' || slider.property === 'friction') {
             worldRef.current.contactmaterials.forEach(cm => {
                 (cm as any)[slider.property] = newVal;
             });
          }
      } else {
          // MODIFIED: Support partial string matching so 'chain' slider affects 'chain_0', 'chain_1', etc.
          const targets = objectsRef.current.filter(o => o.label === slider.targetLabel || o.label.startsWith(slider.targetLabel + '_'));
          targets.forEach(obj => {
               if (slider.property === 'mass') {
                  obj.body.mass = newVal;
                  obj.body.updateMassProperties();
               } else if (slider.property === 'damping') {
                  obj.body.linearDamping = newVal;
                  obj.body.angularDamping = newVal;
               }
          });
      }
      // No physics step is needed here: the render loop picks the new values up on its next frame
      // (stepping with a zero time step, as this used to, divides by zero inside the solver).
  };

  const startDrag = (e: React.MouseEvent, target: 'settings' | 'inspector') => {
      e.stopPropagation(); // CRITICAL: Stop propagation to prevent 3D controls from interfering
      // A docked settings panel has no stored position yet, so read it from the DOM
      const docked = target === 'settings' && settingsPos.x < 0 && settingsRef.current;
      const settingsStart = docked ? { x: settingsRef.current!.offsetLeft, y: settingsRef.current!.offsetTop } : settingsPos;
      dragRef.current = {
          target,
          startX: e.clientX,
          startY: e.clientY,
          startPosX: target === 'settings' ? settingsStart.x : inspectorPos.x,
          startPosY: target === 'settings' ? settingsStart.y : inspectorPos.y
      };
      setIsDraggingUI(true);
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
      escape: () => {
          if (rulerModeRef.current) setRuler(false);
          else if (showCameraMenu) setShowCameraMenu(false);
          else selectObject(null);
      }
  };

  // In realistic mode the controls fade out while the pointer rests
  const fade = `transition-opacity duration-500 ${uiHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'}`;
  const viewButton = "p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors";
  const barButton = "shrink-0 p-2 rounded-full transition-colors";
  const barIdle = "text-slate-400 hover:text-white hover:bg-white/10";
  const barOn = "text-sky-300 bg-sky-500/15";
  const divider = <div className="shrink-0 w-px h-6 bg-white/10 mx-0.5"></div>;
  const recordClock = `${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, '0')}`;

  return (
    <div
        className={`w-full h-full relative overflow-hidden ${uiHidden ? 'cursor-none' : ''} ${rulerMode ? 'cursor-crosshair' : ''}`}
        style={isFullscreen ? { backgroundColor: '#020617' } : undefined}
        ref={containerRef}
    >
      {/* Control Bar */}
      <div
          className={`absolute top-3 left-1/2 -translate-x-1/2 max-w-[calc(100%-1.5rem)] overflow-x-auto flex items-center gap-0.5 p-1 bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-full shadow-xl z-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${fade}`}
          onMouseDown={(e) => e.stopPropagation()}
          data-tour="toolbar"
      >
         <button onClick={() => resetSimulation(true)} className={`${barButton} ${barIdle}`} title="Reset simulation ( R )" aria-label="Reset simulation">
             <RotateCcw className="w-[18px] h-[18px]" />
         </button>
         <button onClick={togglePause} className={`${barButton} ${paused ? 'text-amber-400 bg-amber-500/10' : 'text-slate-200 hover:bg-white/10'}`} title={paused ? "Resume ( Space )" : "Pause ( Space )"} aria-label={paused ? "Resume" : "Pause"}>
             {paused ? <Play className="w-[18px] h-[18px] fill-current" /> : <Pause className="w-[18px] h-[18px] fill-current" />}
         </button>
         <button onClick={() => spawnObject('box')} className={`${barButton} text-slate-400 hover:text-blue-400 hover:bg-white/10`} title="Add a box" aria-label="Add a box">
             <Square className="w-[18px] h-[18px]" />
         </button>
         <button onClick={() => spawnObject('sphere')} className={`${barButton} text-slate-400 hover:text-blue-400 hover:bg-white/10`} title="Add a sphere" aria-label="Add a sphere">
             <Circle className="w-[18px] h-[18px]" />
         </button>
         {divider}
         {canRecord && (
             <button
                 onClick={toggleRecording}
                 className={`${barButton} flex items-center gap-1.5 ${recording ? 'text-red-300 bg-red-500/20 pr-3' : barIdle}`}
                 title={recording ? "Stop recording and save the video ( E )" : "Record a video of the simulation ( E )"}
                 aria-label={recording ? "Stop recording" : "Record video"}
                 aria-pressed={recording}
             >
                 {recording
                     ? <><span className="relative flex h-[18px] w-[18px] items-center justify-center"><span className="absolute h-3 w-3 rounded-full bg-red-500 animate-ping opacity-70"></span><span className="relative h-2.5 w-2.5 rounded-sm bg-red-500"></span></span><span className="text-[11px] font-mono tabular-nums">{recordClock}</span></>
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
         <button onClick={() => setShowStopwatch(!showStopwatch)} className={`${barButton} ${showStopwatch ? barOn : barIdle}`} title="Stopwatch" aria-label="Stopwatch" aria-pressed={showStopwatch}>
             <Timer className="w-[18px] h-[18px]" />
         </button>
         <button onClick={toggleVectors} className={`${barButton} ${showVectors ? barOn : barIdle}`} title="Show velocity arrows ( V )" aria-label="Velocity arrows" aria-pressed={showVectors}>
             <MoveUpRight className="w-[18px] h-[18px]" />
         </button>
         {sourceVideoUrl && (
             <button onClick={() => setShowCompare(!showCompare)} className={`${barButton} ${showCompare ? barOn : barIdle}`} title="Compare with your video" aria-label="Compare with your video" aria-pressed={showCompare}>
                 <PictureInPicture2 className="w-[18px] h-[18px]" />
             </button>
         )}
         {divider}
         <button onClick={handleSoundToggle} className={`${barButton} ${barIdle}`} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"}>
             {muted ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
         </button>
         <button onClick={() => setShowSettings(!showSettings)} className={`${barButton} ${showSettings ? 'text-blue-400 bg-blue-500/10' : barIdle}`} title="Settings" aria-label="Settings" aria-pressed={showSettings}>
             <Settings2 className="w-[18px] h-[18px]" />
         </button>
         {onOpenHelp && (
             <button onClick={onOpenHelp} className={`${barButton} ${barIdle}`} title="Keyboard shortcuts and help ( ? )" aria-label="Help">
                 <HelpCircle className="w-[18px] h-[18px]" />
             </button>
         )}
      </div>

      {/* Bottom row: view controls (kept clear of the chat button on the right) */}
      <div className={`absolute bottom-3 left-3 flex flex-wrap-reverse items-end gap-2 z-10 pointer-events-none ${isFullscreen ? 'right-3' : 'right-3 sm:right-[84px]'} ${fade}`}>
          <div className="relative pointer-events-auto" onMouseDown={(e) => e.stopPropagation()}>
              {showCameraMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-44 p-1.5 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Camera</div>
                      {([['home', 'Scene view', '1'], ['top', 'Top', '2'], ['front', 'Front', '3'], ['side', 'Side', '4']] as [CameraView, string, string][]).map(([view, name, key]) => (
                          <button key={view} onClick={() => setCameraView(view)} className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-slate-200 hover:bg-white/10">
                              <span>{name}</span><kbd className="text-[10px] font-mono text-slate-500">{key}</kbd>
                          </button>
                      ))}
                      <button onClick={toggleFollow} className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs ${follow ? 'text-sky-300 bg-sky-500/15' : 'text-slate-200 hover:bg-white/10'}`} aria-pressed={follow}>
                          <span className="flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5" /> Follow object</span><kbd className="text-[10px] font-mono text-slate-500">0</kbd>
                      </button>
                      <p className="px-2 pt-1 text-[10px] leading-snug text-slate-500">Follow tracks the selected object, or the main one.</p>
                  </div>
              )}
              <div className="flex items-center gap-1 p-1 bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-full shadow-xl">
                 <button onClick={() => zoomBy(1 / ZOOM_STEP)} className={viewButton} title="Zoom out ( - )" aria-label="Zoom out">
                     <ZoomOut className="w-5 h-5" />
                 </button>
                 <button onClick={() => zoomBy(ZOOM_STEP)} className={viewButton} title="Zoom in ( + )" aria-label="Zoom in">
                     <ZoomIn className="w-5 h-5" />
                 </button>
                 <button onClick={resetView} className={viewButton} title="Reset view ( 1 )" aria-label="Reset view">
                     <LocateFixed className="w-5 h-5" />
                 </button>
                 <button onClick={() => setShowCameraMenu(!showCameraMenu)} className={`${viewButton} ${showCameraMenu || follow ? '!text-sky-300 bg-sky-500/15' : ''}`} title="Camera views" aria-label="Camera views" aria-expanded={showCameraMenu}>
                     <Eye className="w-5 h-5" />
                 </button>
                 {fullscreenSupported && (
                     <>
                         <div className="w-px h-6 bg-white/10 mx-0.5"></div>
                         <button onClick={toggleFullscreen} className={viewButton} title={isFullscreen ? "Exit full screen ( F or Esc )" : "Full screen ( F )"} aria-label={isFullscreen ? "Exit full screen" : "Full screen"}>
                             {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                         </button>
                     </>
                 )}
                 {isFullscreen && (
                     <button
                         onClick={() => setCinematicEnabled(!cinematicEnabled)}
                         className={`flex items-center gap-1.5 pl-2.5 pr-3 py-2 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors ${cinematicEnabled ? 'text-amber-300 bg-amber-500/15' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                         title="Realistic mode: natural lighting, reflections and smooth edges, with the camera drifting slowly around the scene"
                         aria-pressed={cinematicEnabled}
                     >
                         <Aperture className="w-4 h-4" /> Realistic
                     </button>
                 )}
              </div>
          </div>
      </div>

      {/* The scene's live readout (filled in by the effect above, hidden until the scene reports something).
          It gives way to the object inspector, which opens in the same corner. */}
      <div
          ref={readoutPanelRef}
          className={`absolute left-3 top-[64px] z-10 w-[min(264px,calc(100%-1.5rem))] px-3 py-2.5 bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-xl shadow-xl text-[11px] pointer-events-none ${selectedLabel ? 'hidden' : ''} ${fade}`}
          style={{ display: 'none' }}
          role="status"
          aria-live="off"
      ></div>

      {/* Ruler: read-out placed over the measured line by the render loop, and a hint while measuring */}
      <div ref={rulerLabelRef} className="absolute top-0 left-0 z-10 pointer-events-none px-2 py-1 rounded-md bg-yellow-300 text-slate-900 text-xs font-bold font-mono shadow-lg whitespace-nowrap" style={{ visibility: 'hidden' }}>
          {rulerInfo.distance.toFixed(2)} m
      </div>
      {rulerMode && (
          <div className={`absolute top-[60px] left-1/2 -translate-x-1/2 z-10 max-w-[calc(100%-1.5rem)] flex items-center gap-3 px-3 py-1.5 rounded-full bg-slate-900/90 backdrop-blur-md border border-yellow-300/40 shadow-xl text-[11px] text-slate-200 ${fade}`} role="status" onMouseDown={(e) => e.stopPropagation()}>
              <Ruler className="w-3.5 h-3.5 shrink-0 text-yellow-300" />
              {rulerInfo.points === 2 ? (
                  <span className="font-mono whitespace-nowrap">
                      <span className="text-yellow-300 font-bold">{rulerInfo.distance.toFixed(2)} m</span>
                      <span className="text-slate-400"> · across {Math.hypot(rulerInfo.dx, rulerInfo.dz).toFixed(2)} · up {rulerInfo.dy.toFixed(2)}</span>
                  </span>
              ) : (
                  <span className="whitespace-nowrap">{rulerInfo.points === 0 ? 'Click the first point' : 'Click the second point'}</span>
              )}
              <button onClick={() => setRuler(false)} className="shrink-0 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-[10px] font-semibold">Done</button>
          </div>
      )}

      {/* Click-to-start prompt (lets clicks through to the canvas) */}
      {awaitingStart && (
        <div className="absolute inset-x-0 bottom-[72px] flex justify-center px-4 pointer-events-none z-10" role="status" aria-live="polite">
          <div className="flex items-center gap-3 pl-4 pr-5 py-2.5 rounded-full bg-slate-900/85 backdrop-blur-md border border-blue-400/40 shadow-2xl">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500/40 animate-ping"></span>
              <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white">
                <MousePointerClick className="w-4 h-4" />
              </span>
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-slate-100">{rulerMode ? 'Finish measuring, then click to start' : (simulationData.startHint || 'Click anywhere to start')}</span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Ready · drag to look around first</span>
            </span>
          </div>
        </div>
      )}

      {/* Short confirmations (saved a file, and so on) */}
      {toast && (
          <div className="absolute inset-x-0 bottom-[72px] flex justify-center px-4 pointer-events-none z-30" role="status" aria-live="polite">
              <div className="px-4 py-2 rounded-full bg-slate-800/95 border border-white/15 shadow-2xl text-xs text-slate-100">{toast}</div>
          </div>
      )}

      {showStopwatch && (
          <Stopwatch api={simApi} onClose={() => setShowStopwatch(false)} className={`left-1/2 -translate-x-1/2 ${rulerMode ? 'top-[104px]' : 'top-[60px]'} ${fade}`} />
      )}

      {sourceVideoUrl && showCompare && (
          <ComparePanel url={sourceVideoUrl} api={simApi} onClose={() => setShowCompare(false)} className={`left-3 bottom-[68px] ${fade}`} />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div
            className={`absolute bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-20 ${fade}`}
            style={{
                ...(settingsPos.x < 0 ? { right: 12, top: 60 } : { left: settingsPos.x, top: settingsPos.y }),
                width: settingsSize.w,
                maxHeight: `min(${settingsSize.h}px, calc(100% - 140px))`
            }}
            ref={settingsRef}
            onMouseDown={(e) => e.stopPropagation()} // Stop propagation on the panel itself
        >
           <div className="h-8 shrink-0 bg-white/5 border-b border-white/5 flex items-center justify-between px-2.5 cursor-move select-none"
                onMouseDown={(e) => startDrag(e, 'settings')}
           >
                <div className="flex items-center gap-1.5 text-slate-300 text-[10px] font-bold uppercase tracking-wider">
                    <Sliders className="w-3 h-3" /> Settings
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setIsSettingsMinimized(!isSettingsMinimized)}
                        className="p-1 hover:bg-white/10 rounded text-slate-400"
                        aria-label={isSettingsMinimized ? "Expand settings" : "Collapse settings"}
                    >
                        {isSettingsMinimized ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                    </button>
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setShowSettings(false)}
                        className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded text-slate-400"
                        aria-label="Close settings"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
           </div>

           {!isSettingsMinimized && (
               <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex shrink-0 p-1.5 gap-1 bg-black/20">
                        <button
                            onClick={() => setSettingsTab('physics')}
                            className={`flex-1 py-1 px-1.5 rounded-md text-[10px] font-medium transition-colors flex items-center justify-center gap-1 ${settingsTab === 'physics' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            <MoveDiagonal className="w-3 h-3" /> Physics
                        </button>
                        <button
                            onClick={() => setSettingsTab('environment')}
                            className={`flex-1 py-1 px-1.5 rounded-md text-[10px] font-medium transition-colors flex items-center justify-center gap-1 ${settingsTab === 'environment' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            <Sun className="w-3 h-3" /> Scene
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 custom-scrollbar">
                        {settingsTab === 'physics' ? (
                            <>
                                {/* Speed: built in for every simulation */}
                                <div className="space-y-1.5 pb-2.5 border-b border-white/5">
                                    <div className="flex justify-between gap-2 text-[11px] leading-tight text-slate-200">
                                        <span className="flex items-center gap-1 font-semibold"><Gauge className="w-3 h-3 text-emerald-400" /> Speed</span>
                                        <span className="font-mono text-emerald-300">{speed.toFixed(2)}×</span>
                                    </div>
                                    <input
                                        type="range"
                                        aria-label="Simulation speed"
                                        min={SPEED_MIN} max={SPEED_MAX} step={0.05}
                                        value={speed}
                                        onChange={(e) => changeSpeed(parseFloat(e.target.value))}
                                        className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:bg-emerald-400"
                                    />
                                    <div className="flex gap-1">
                                        {SPEED_PRESETS.map(preset => (
                                            <button
                                                key={preset}
                                                onClick={() => changeSpeed(preset)}
                                                className={`flex-1 py-0.5 rounded text-[10px] font-mono transition-colors ${Math.abs(speed - preset) < 0.001 ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40' : 'bg-slate-800 text-slate-400 border border-transparent hover:text-slate-200'}`}
                                            >
                                                {preset}×
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* A simulation's own 'scale' slider is replaced by the Speed control above */}
                                {simulationData.sliders.filter(s => s.property !== 'scale').map((s, i) => (
                                    <div key={i} className="space-y-1">
                                        <div className="flex justify-between gap-2 text-[11px] leading-tight text-slate-300">
                                            <span>{s.label}</span>
                                            <span className="font-mono opacity-50">{sliderValues[s.label]?.toFixed(2)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            aria-label={s.label}
                                            min={s.min} max={s.max} step={s.step || 0.1}
                                            value={sliderValues[s.label] ?? s.value}
                                            onChange={(e) => handleSliderChange(s.label, parseFloat(e.target.value))}
                                            className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:bg-blue-400"
                                        />
                                    </div>
                                ))}
                            </>
                        ) : (
                            <div className="space-y-2.5">
                                {/* Environment theme: backdrop and lighting only; the scene's objects stay as they are */}
                                <div className="space-y-1.5 pb-2.5 border-b border-white/5">
                                    <div className="text-[11px] leading-tight text-slate-200 font-semibold">Environment</div>
                                    <div className="grid grid-cols-5 gap-1">
                                        {THEMES.map(t => (
                                            <button
                                                key={t.id}
                                                onClick={() => changeTheme(t.id)}
                                                title={t.id === 'original' ? "The scene's own look" : `${t.label} backdrop and lighting`}
                                                aria-label={`${t.label} environment`}
                                                aria-pressed={theme === t.id}
                                                className={`h-7 rounded-md border transition-transform ${theme === t.id ? 'border-sky-300 ring-1 ring-sky-300 scale-105' : 'border-white/15 hover:border-white/40'}`}
                                                style={{ background: t.swatch }}
                                            ></button>
                                        ))}
                                    </div>
                                    <div className="text-[10px] text-slate-400">{THEMES.find(t => t.id === theme)?.label}</div>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex justify-between gap-2 text-[11px] leading-tight text-slate-300">
                                        <span className="flex items-center gap-1"><Volume2 className="w-3 h-3" /> Sound Volume</span>
                                        <span className="font-mono opacity-50">{muted ? 'muted' : `${Math.round(volume * 100)}%`}</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="1" step="0.05"
                                        aria-label="Sound volume"
                                        value={volume}
                                        onChange={(e) => { simAudio.unlock(); setVolume(parseFloat(e.target.value)); if (muted) setMuted(false); }}
                                        className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:rounded-full"
                                    />
                                </div>
                                <label className="flex items-center justify-between gap-2 text-[11px] leading-tight text-slate-300 cursor-pointer" title="Camera shake on heavy impacts, plus device vibration on phones that support it">
                                    <span className="flex items-center gap-1"><Vibrate className="w-3 h-3" /> Vibration</span>
                                    <input
                                        type="checkbox"
                                        checked={vibration}
                                        onChange={(e) => setVibration(e.target.checked)}
                                        className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                                    />
                                </label>
                                <div className="space-y-1">
                                    <div className="text-[11px] leading-tight text-slate-300">Background Color</div>
                                    <input
                                        type="color"
                                        aria-label="Background colour"
                                        value={bgColor}
                                        onChange={(e) => changeBackground(e.target.value)}
                                        className="w-full h-6 rounded cursor-pointer bg-transparent"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <div className="text-[11px] leading-tight text-slate-300">Light Intensity</div>
                                    <input
                                        type="range" min="0" max="5" step="0.1"
                                        aria-label="Light intensity"
                                        value={lightSettings.intensity}
                                        onChange={(e) => updateLighting({ ...lightSettings, intensity: parseFloat(e.target.value) })}
                                        className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:rounded-full"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <div className="text-[11px] leading-tight text-slate-300">Sun Position (Azimuth)</div>
                                    <input
                                        type="range" min="0" max="360"
                                        aria-label="Sun position"
                                        value={lightSettings.azimuth}
                                        onChange={(e) => updateLighting({ ...lightSettings, azimuth: parseFloat(e.target.value) })}
                                        className="w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:rounded-full"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
               </div>
           )}
        </div>
      )}

      {/* Object Inspector: live data and editing for the selected object */}
      {selectedLabel && editInfo && (
          <ObjectInspector
              label={selectedLabel}
              api={simApi}
              info={editInfo}
              panelRef={inspectorRef}
              style={{ left: inspectorPos.x, top: inspectorPos.y, width: 236, maxHeight: 'min(440px, calc(100% - 140px))' }}
              onHeaderMouseDown={(e) => startDrag(e, 'inspector')}
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

      {/* Global Drag Handler */}
      {isDraggingUI && (
         <div className="fixed inset-0 z-[100] cursor-move"
              onMouseMove={(e) => {
                  const dx = e.clientX - dragRef.current.startX;
                  const dy = e.clientY - dragRef.current.startY;
                  if (dragRef.current.target === 'settings') {
                      setSettingsPos({ x: dragRef.current.startPosX + dx, y: dragRef.current.startPosY + dy });
                  } else {
                      setInspectorPos({ x: dragRef.current.startPosX + dx, y: dragRef.current.startPosY + dy });
                  }
              }}
              onMouseUp={() => setIsDraggingUI(false)}
              onMouseLeave={() => setIsDraggingUI(false)}
         />
      )}
    </div>
  );
};
