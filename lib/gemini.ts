import { GoogleGenAI, Type, ThinkingLevel, MediaResolution } from "@google/genai";
import { SimulationData, SimulationSlider } from "../types";
import { checkSimulation, checkScore, problemsOf, SceneCheck } from "./validate";
import { renderPreview } from "./preview";
import { pickExamples, examplesText } from "./examples";
import { feedbackNote } from "./feedback";
import { SCENE_KIT_MATERIALS_DOC, SCENE_KIT_GROUNDS_DOC } from "./sceneKit";
import { POSE_NAMES } from "./humans";

// Models to try, in order. Google's newest Flash model is often overloaded (503) or hangs for
// minutes, so each request falls through to the next model instead of failing outright.
export const MODEL_CHAIN = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite"];
// Best-quality mode: Google's Pro models first. A free key may have no Pro quota; the Flash models then take over.
export const QUALITY_CHAIN = ["gemini-3.1-pro-preview", "gemini-pro-latest", ...MODEL_CHAIN];
export const REQUEST_TIMEOUT_MS = 75000; // Chat edits: healthy models answer in 25-50 s
// Whole scenes are planned with deep thinking, which takes longer (Pro models longer still)
export const SCENE_TIMEOUT_MS = 120000;
export const QUALITY_TIMEOUT_MS = 240000;

// Start from whichever model answered last, so one slow model is not retried on every request
// (remembered for 10 minutes across page reloads, then the newest model gets another chance).
const PREFERRED_KEY = "simulaitor.preferredModel";
const readPreferred = (): number => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERRED_KEY) || "null");
    if (saved && Date.now() - saved.at < 10 * 60 * 1000 && saved.index < MODEL_CHAIN.length) return saved.index;
  } catch {}
  return 0;
};
const savePreferred = (index: number) => {
  try { localStorage.setItem(PREFERRED_KEY, JSON.stringify({ index, at: Date.now() })); } catch {}
};
let preferredModel = readPreferred();

// API keys, in order (GEMINI_API_KEY, GEMINI_API_KEY_2, ... in .env.local). They stay on the server
// (server/geminiProxy.ts), which forwards each request to Google: the page only learns how many there are
// and names each by its slot. When one runs out of free quota, or is rejected, requests move on to the
// next. The key that last worked is remembered for an hour, after which the first key gets another
// chance (free quotas refill).
const PROXY_URL = "/api/gemini";
const keyCountReady: Promise<number> = fetch(`${PROXY_URL}/status`)
  .then(response => (response.ok ? response.json() : { keys: 0 }))
  .then(status => Number(status?.keys) || 0)
  .catch(() => 0);
export const loadKeyCount = (): Promise<number> => keyCountReady;
const ACTIVE_KEY = "simulaitor.activeKey";
let activeKey = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
    if (saved && Date.now() - saved.at < 60 * 60 * 1000 && Number.isInteger(saved.index)) return saved.index;
  } catch {}
  return 0;
})();
const clients = new Map<number, GoogleGenAI>();
const client = (index: number) => {
  let ai = clients.get(index);
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: `slot-${index + 1}`, httpOptions: { baseUrl: `${location.origin}${PROXY_URL}` } });
    clients.set(index, ai);
  }
  return ai;
};

const statusOf = (error: any) => error?.status || error?.code || error?.error?.code;
const messageOf = (error: any) => String(error?.message || error?.error?.message || error || '');
// Out of quota (free credits used up, or the rate limit hit)
const isQuotaError = (error: any) => statusOf(error) === 429 || /RESOURCE_EXHAUSTED|quota/i.test(messageOf(error));
// The key itself is refused (wrong, expired, or not allowed to use the API)
const isKeyError = (error: any) => {
  const status = statusOf(error);
  return status === 401 || status === 403 || /API[_ ]?key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(messageOf(error));
};

// The Equilibria server's own refusals (server/credits.ts), carried inside the SDK's error text as
// {"error":{"status":"ASSISTANT_LIMIT","message":"..."}}. Returns the server's sentence for people, or null.
const SERVER_REASONS = /SERVER_DAILY_LIMIT|ASSISTANT_LIMIT|NO_DEVICE/;
export function serverLimitMessage(error: any): string | null {
  const text = messageOf(error);
  if (!SERVER_REASONS.test(text)) return null;
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      const message = JSON.parse(text.slice(start))?.error?.message;
      if (typeof message === 'string' && message) return message;
    } catch {}
  }
  return /ASSISTANT_LIMIT/.test(text)
    ? "You have used today's free assistant requests. Creating a new scene uses a credit instead."
    : /NO_DEVICE/.test(text)
    ? 'Reload the page to start a session, then try again.'
    : 'Equilibria has reached its AI limit for today. The demos still work; please try again tomorrow.';
}

// A request the Equilibria server refused (out of credits or a daily limit); its message is ready to show
export class ServerLimitError extends Error {}

class KeyUnusable extends Error {
  constructor(public cause: any) { super(messageOf(cause)); }
}

// Tries every model of the chain with one key. Throws KeyUnusable when the key is refused or out of quota
// on every model. The usual chain starts from the model that answered last; other chains go in order.
async function withModels<T>(ai: GoogleGenAI, run: (model: string, ai: GoogleGenAI) => Promise<T>, onAttempt: ((model: string) => void) | undefined, chain: string[]): Promise<T> {
  const usual = chain === MODEL_CHAIN;
  const first = usual ? preferredModel : 0;
  let lastError: any;
  for (let pass = 0; pass < 2; pass++) {
    let quotaFailures = 0;
    for (let i = 0; i < chain.length; i++) {
      const index = (first + i) % chain.length;
      const model = chain[index];
      try {
        if (onAttempt) onAttempt(model);
        const result = await run(model, ai);
        if (usual) {
          if (index !== preferredModel) savePreferred(index);
          preferredModel = index;
        }
        return result;
      } catch (error: any) {
        console.warn(`Gemini model ${model} failed:`, error);
        lastError = error;
        // Out of credits, or the server's daily AI limit: the same on every model and every key
        if (statusOf(error) === 402 || SERVER_REASONS.test(messageOf(error))) throw new ServerLimitError(serverLimitMessage(error) || messageOf(error));
        if (isKeyError(error)) throw new KeyUnusable(error);   // Same on every model: try the next key
        if (isQuotaError(error)) { quotaFailures++; continue; } // Quotas are per model: try the next one
        // A malformed request fails the same way on every model and every key
        if (statusOf(error) === 400) throw error;
      }
    }
    if (quotaFailures === chain.length) throw new KeyUnusable(lastError);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  console.error("Gemini API Error after trying all models:", lastError);
  throw lastError;
}

// Runs a request with the active key, falling back across models and then across keys
export async function withModelFallback<T>(run: (model: string, ai: GoogleGenAI) => Promise<T>, onAttempt?: (model: string) => void, chain: string[] = MODEL_CHAIN): Promise<T> {
  const count = await keyCountReady;
  if (!count) throw new Error("Scene building is not set up on this server yet.");
  let lastError: any;
  for (let step = 0; step < count; step++) {
    const index = (activeKey + step) % count;
    try {
      const result = await withModels(client(index), run, onAttempt, chain);
      if (index !== activeKey) {
        console.info(`[Gemini] Switched to API key ${index + 1} of ${count}.`);
        activeKey = index;
        try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ index, at: Date.now() })); } catch {}
      }
      return result;
    } catch (error: any) {
      if (!(error instanceof KeyUnusable)) throw error;
      console.warn(`[Gemini] API key ${index + 1} of ${count} is out of quota or refused; trying the next one.`);
      lastError = error.cause;
    }
  }
  console.warn('Every key is out of quota or was refused:', lastError);
  throw new Error(`The AI service is busy or out of its daily quota right now. Please try again a little later.`);
}

// One request with an explicit thinking level, so the model reasons through the plan before it answers.
// Models that do not accept a thinking level or a media resolution (older ones) are asked again without them.
export async function generateThinking(ai: GoogleGenAI, params: any, level: ThinkingLevel) {
  try {
    return await ai.models.generateContent({ ...params, config: { ...params.config, thinkingConfig: { thinkingLevel: level } } });
  } catch (error: any) {
    if (statusOf(error) === 400 && /think|resolution/i.test(messageOf(error))) {
      const { mediaResolution, ...config } = params.config || {};
      return ai.models.generateContent({ ...params, config });
    }
    throw error;
  }
}

const SLIDER_PROPERTIES = ["scale", "mass", "friction", "restitution", "gravity", "damping"];
const DEFAULT_START_HINT = "Click anywhere to start";

// Validates and tidies whatever the model returned before it reaches the renderer.
// Throws when there is no usable scene code, so the caller can try another model.
// 'previous' supplies the start mode when a chat edit does not restate it.
export function normalizeSimulation(raw: any, previous?: SimulationData | null): SimulationData {
  if (!raw || typeof raw.code !== "string" || !raw.code.trim()) {
    throw new Error("The model returned no simulation code");
  }

  const sliders: SimulationSlider[] = (Array.isArray(raw.sliders) ? raw.sliders : [])
    .filter((s: any) =>
      s && typeof s.label === "string" && s.label.trim() &&
      typeof s.targetLabel === "string" &&
      SLIDER_PROPERTIES.includes(s.property) &&
      [s.min, s.max, s.value].every((n: any) => typeof n === "number" && Number.isFinite(n)) &&
      s.max > s.min
    )
    .map((s: any) => ({
      label: s.label.trim(),
      targetLabel: s.targetLabel,
      property: s.property,
      min: s.min,
      max: s.max,
      value: Math.min(Math.max(s.value, s.min), s.max),
      ...(typeof s.step === "number" && s.step > 0 ? { step: s.step } : {})
    }));

  const startMode: 'click' | 'auto' =
    raw.startMode === "click" || raw.startMode === "auto" ? raw.startMode : (previous?.startMode ?? "auto");

  let startHint: string | undefined;
  if (startMode === "click") {
    const hint = typeof raw.startHint === "string" ? raw.startHint.trim() : "";
    startHint = (hint || previous?.startHint || DEFAULT_START_HINT).slice(0, 80);
  }

  return {
    thought_process: typeof raw.thought_process === "string" ? raw.thought_process : "",
    code: raw.code,
    sliders,
    startMode,
    startHint,
    ...(typeof raw.title === "string" && raw.title.trim() ? { title: raw.title.trim().slice(0, 60) } : {}),
    demoMode: false
  };
}

// The realism kit, described for the model. Shared with the chat assistant, which edits scenes.
export const SCENE_KIT_GUIDE = `
    REALISM KIT (use it everywhere: it is what makes a scene look real):
    - addGround(kind): builds the ground with its top at y = 0 (80 x 80 m), a matching sky, haze and daylight, and
      returns { body, mesh, material } ('material' is a CANNON.Material for ContactMaterial pairs).
      Kinds: ${SCENE_KIT_GROUNDS_DOC}. Pick where this would really happen: a park or field 'grass', a street 'asphalt',
      a gym or bowling alley 'wood', a warehouse or garage 'concrete', a beach 'sand', a rink 'ice', a classroom or lab
      bench experiment 'lab'. Call it exactly once. Do NOT call it for scenes in space.
    - realMaterial(name, { color, size, roughness, metalness, opacity }): a physically based material, textured where
      the real thing has texture. 'size' is the real width, or [width, height], in metres of the surface it covers, so
      wood grain, bricks and tiles come out at true scale. 'color' tints it.
      Materials: ${SCENE_KIT_MATERIALS_DOC}.
      Use realMaterial for EVERY mesh. Never use MeshBasicMaterial or plain flat-coloured materials for real objects.
    - addHuman(kind, { height, pose }): a realistic person, 'man' (1.80 m) or 'woman' (1.66 m). The figure stands with
      its feet at its origin and faces +z; place and turn h.object, or put it inside a THREE.Group. pose(h) runs when
      the model has loaded and then every frame, so a pose can follow the clock and the bodies. Inside pose use:
        h.setPose(name, { time, seat, face }) with name ${POSE_NAMES.map(n => `'${n}'`).join(', ')}. 'time' (seconds since
          the scene started) drives walking and running; 'seat' is the seat height in metres in the figure's parent frame,
          so a sitting figure rests its hips on it; 'face' is 'calm', 'effort' or 'breathing' (it suits the pose by
          default, e.g. effort when pushing). People blink by themselves.
        h.aim(bone, [x, y, z]) after setPose for anything special: points one bone along a direction in the figure's
          own frame (+x its left, +y up, +z forward). Bones: Spine, Spine1, Neck, LeftArm, LeftForeArm, LeftHand,
          LeftUpLeg, LeftLeg, LeftFoot, and the same with Right.
        h.where(bone) returns a bone's position in the figure's frame, e.g. to put the hands exactly on a handle.
      A person who moves, or pushes on things, needs a physics body: a CANNON.Box of about 0.4 x height x 0.3 m with
      fixedRotation = true, registered with addSimulationObject using a THREE.Group that contains h.object (set
      h.object.position.y = -height / 2). Onlookers and people who only stand by need no body.
    - setReadout(title, rows): a small live panel of numbers. 'rows' are [label, value] string pairs, plus at most one
      plain string: a one-line explanation. Put it in a report() function with the quantities this scene is about
      (speed, height, energy, momentum, force, time, angle...), computed from the bodies, with units; call report()
      once at build time (frame callbacks only run once time is running) and pass it to addFrameCallback.
    - camera.position.set(x, y, z) and camera.userData.lookAt = [x, y, z] frame the shot. The person or thing that sets
      off the action AND where it ends up (the target, goal, landing spot) must both be in view at the start. Aim at
      the middle of the path of motion and look at it from the side and a little behind, about 2.5 times the length of
      the action away and a little above it (near eye level when people are in it). Never put the camera level with, or
      behind, the main person or object while looking away from them.
`;

const SYSTEM_INSTRUCTION = `
    You are a senior technical artist and physicist. You build REALISTIC, EDUCATIONAL 3D physics scenes with Three.js
    and cannon-es: they must look like the real world, behave like it with real-world numbers, and explain what happens.
    Ordinary output (coloured boxes and spheres on an empty floor) is a failure.

    GOAL:
    Reconstruct the physical situation (from the video, or from the user's description) as a convincing, working 3D scene.

    NAMES ALREADY DEFINED (never re-declare them, never write const scene/world/camera = ...):
    THREE, CANNON, scene, world, camera, addSimulationObject, addFrameCallback, getSimulationObject, addRope,
    setAmbience, addHuman, setReadout, realMaterial, addGround.

    CORE HELPERS:
    - addSimulationObject(label, mesh, body, { sound, main }): registers a movable object; the mesh follows the body and
      the user can drag it. Use it for every DYNAMIC object (a THREE.Group is fine as the mesh). Static scenery is added
      with scene.add (and, if solid, a mass-0 body with world.addBody). 'sound' see rule 8, 'main' see rule 9.
    - addFrameCallback(fn): runs fn every frame.
    - addRope([x, y, z], body): hangs a body from a fixed anchor point and draws the rope (rule 6).
    - setAmbience(kind): background sound, see rule 8.
    ${SCENE_KIT_GUIDE}

    RULES:
    1. **REAL-WORLD PHYSICS** (1 unit = 1 metre, masses in kg, time in seconds):
       - world.gravity.set(0, -9.81, 0), unless the scene is on the Moon (-1.62), Mars (-3.71) or in space (0).
       - True sizes and masses. Reference values: football 0.22 m across, 0.43 kg; basketball 0.24 m, 0.62 kg; tennis
         ball 0.067 m, 0.058 kg; golf ball 0.043 m, 0.046 kg; bowling ball 0.218 m, 6-7 kg; bowling pin 0.38 m tall,
         1.5 kg; brick 0.215 x 0.065 x 0.10 m, 2.3 kg; adult 60-90 kg; car 4.5 x 1.8 x 1.45 m, 1400 kg; bicycle 12 kg;
         shopping trolley 15 kg; table 0.75 m high; chair seat 0.45 m; door 2.0 x 0.9 m; storey of a building 3 m.
         Otherwise mass = density x volume: steel 7850 kg/m3, aluminium 2700, concrete 2400, ice 917, water 1000,
         rubber 1100, oak 750, pine 500, foam 30.
       - Friction (mu) and bounce (e) per material pair with CANNON.ContactMaterial: rubber on concrete or asphalt mu 0.8;
         wood on wood mu 0.4, e 0.4; wood on concrete mu 0.6, e 0.3; steel on steel mu 0.5 (hardened balls e 0.9);
         steel or skates on ice mu 0.01; glass on glass e 0.6; bounce of a basketball e 0.75, tennis ball 0.7,
         football 0.65, golf ball 0.8, bowling ball on wood 0.1. addGround already sets typical values against the ground.
       - Air drag: linearDamping 0.01 and angularDamping 0.01-0.05 (0.05-0.1 for balls rolling on the ground). Never
         use large damping to make things behave.
       - Real speeds: walking 1.4 m/s, sprinting 10 m/s, thrown ball 15-25 m/s, kicked football 25 m/s, car 13-30 m/s,
         after falling a height h: v = sqrt(2gh).
       - Never fake the physics: no exaggerated masses, no extra gravity, no hidden forces. Set up real causes (a real
         height, speed, push or angle) so the outcome happens by itself.

    2. **REALISTIC LOOK**:
       - Build each object the way it really looks, from several meshes in a THREE.Group: a car has a body, a cabin with
         glass windows, four tyres with metal hubs and lights; a ramp has a deck and supports; a table has a top and four
         legs; a goal has posts, a crossbar and a net; a crane has a tower, a jib, a cable and a hook. Use curved geometry
         where the real thing is round (Sphere, Cylinder, Capsule, Torus, Lathe; Extrude for profiles). Collision shapes
         stay simple: Box and Sphere, or several shapes on one body with body.addShape(shape, offset).
       - realMaterial on every mesh, with true colours. No neon, glowing or toy colours unless the real thing has them.
       - castShadow = true on every object, receiveShadow = true on large surfaces.
       - Put the scene in a believable place with a few static props that belong there, as scenery only (scene.add, no
         body) and away from the action, e.g. a park: a bench, two trees (trunk plus a few foliage spheres), a lamp post;
         a lab: a bench, a stand and clamp; a street: kerbs and lane markings. Never let props block the view or the motion.
       - People: when the situation involves people (someone throws, kicks, pushes, rides, drops, falls or watches),
         include them with addHuman in a fitting pose, at real scale.
       - Frame the shot with camera.position and camera.userData.lookAt (see the kit). The whole action must be in view.

    3. **EXPLAIN IT**:
       - Always show a live readout (setReadout at build time and every frame) with 3 to 6 rows of the key quantities,
         with units, plus one sentence.
       - 'thought_process' is shown to the user. Write it in this format:
         "ANALYSIS COMPLETE.\\n\\nScenario: ...\\nVisuals: ...\\nInteraction: ...\\nPhysics Profile:\\n- ...\\n\\nTry it: ..."
         with 3 to 6 bullets giving the laws at work and the actual numbers of THIS scene (for example "Dropped from 5 m,
         the ball lands after 1.01 s at 9.9 m/s, since v = sqrt(2gh)"). Correct formulas, real data, no hype.
       - Sliders: 2 to 4 that teach something: the masses of the key objects (property 'mass', targetLabel = the object's
         label; a label prefix such as 'pin' covers 'pin_1', 'pin_2'...) and, where it helps, 'gravity' (targetLabel
         'world', value 9.81). Do NOT add world 'friction' or 'restitution' sliders (they overwrite every material pair
         with one number), and do NOT add a speed or time-scale slider (the app has one).

    4. **STABILITY** (the code is run and tested automatically before it is shown):
       - Exactly one ground from addGround (none in space). Its top is y = 0.
       - Rest objects ON what supports them: centre y = support top + half height + 0.001. Nothing may overlap at the start.
       - world.solver.iterations = 30. world.allowSleep = false, unless there are more than about 80 bodies.
       - Collision shapes: CANNON.Box and CANNON.Sphere. Use CANNON.Cylinder only for wheels and rollers (its axis is the
         body's local Y); upright pins, bottles and cans get a Box of the same size.
       - Keep walls and floors at least 0.1 m thick. Joints: CANNON.HingeConstraint for doors, seesaws, levers and wheels.
       - Anything that changes over time is decided each frame from world.time and the bodies' state, not from flags you
         remember (so the app's replay and rewind work): const t0 = world.time at build time, then t = world.time - t0.

    5. **REPLAY THE MOTION**:
       - Once time is running, the scene must play out by itself with no further input.
       - Start every object in its pose just before the action, with its real starting velocity: a pendulum or wrecking
         ball pulled back to its raised angle; a thrown, kicked or rolling object with the matching 'velocity'.
       - Put targets (stacks, pins, walls, goals) directly in the path of the moving object so the collision happens.

    6. **ROPES, CHAINS AND PENDULUMS (CRITICAL)**:
       - Use the helper 'addRope([anchorX, anchorY, anchorZ], body)'. It fixes the body to that anchor point at its CURRENT
         distance (so position the body first), keeps the rope taut, and draws the rope for you.
       - NEVER build a rope from CANNON.PointToPointConstraint: its two pivots are forced to touch, which gives a
         zero-length rope and flings the ball. Do not draw your own rope line either.
       - Recipe for a swinging ball that hits a target (anchor A, rope length L, ball radius R, release angle a = 60 degrees):
         \`\`\`javascript
         const A = { x: 0, y: 14, z: 0 };            // anchor point (end of the crane arm)
         const L = 14 - (R + 1);                     // lowest point of the swing leaves the ball 1 unit above the floor
         const a = Math.PI / 3;
         ballBody.position.set(A.x - Math.sin(a) * L, A.y - Math.cos(a) * L, 0);   // pulled back to the left
         addSimulationObject('WreckingBall', ballMesh, ballBody);
         addRope([A.x, A.y, A.z], ballBody);
         // Target stands just past the lowest point of the swing: centre at x = A.x + R + targetWidth / 2
         \`\`\`
       - Keep the crane post and arm as VISUAL meshes only (scene.add, no physics body) so the ball cannot snag on them,
         and stand the post at least L + R + 1 away from the anchor on the side the ball is pulled back to.
       - The swinging ball needs 'linearDamping: 0' and 'angularDamping: 0' and its real mass (a wrecking ball is 1000 to
         5000 kg, a playground swing seat with a child about 30 kg, a pendulum bob in a lab 0.1 to 1 kg).

    7. **START MODE (REQUIRED FIELD 'startMode')**:
       - The app can hold the finished scene frozen until the user clicks the simulation view, and only then let time run.
       - Set startMode to "click" when the video shows a ONE-OFF TRIGGERED EVENT that a person would set off:
         a ball released, rolled, bowled, thrown, kicked or launched; a pendulum or wrecking ball let go; something dropped;
         a strike, crash or push that knocks other things over.
       - Set startMode to "auto" when the motion is CONTINUOUS or already under way with nothing to trigger:
         orbits, spinning wheels or fans, a swing or spring that is already oscillating, floating or flowing objects, conveyor belts.
       - If you are unsure, choose "click".
       - With "click" you still write the code exactly as rule 5 says: objects in their first-frame pose WITH their initial
         velocities. The app freezes and releases time for you. Do NOT add your own click handler, timer or delay, and do
         NOT zero the velocities to wait for input.
       - Also return 'startHint': one short imperative sentence starting with "Click anywhere to" that names the action,
         e.g. "Click anywhere to roll the ball". Return an empty string when startMode is "auto".

    8. **SOUND AND VIBRATION (REQUIRED)**:
       - The app synthesises every sound from the physics itself: impact loudness from collision speed and mass, pitch from
         object size, rolling and sliding rumble, air whoosh, and a camera shake plus device vibration on heavy impacts.
         You never play audio yourself. Your job is to tell the app, truthfully, what each object is made of.
       - Pass the material as the 4th argument of EVERY addSimulationObject call, choosing what the object in the video
         is really made of:
         \`addSimulationObject('WreckingBall', ballMesh, ballBody, { sound: 'metal' });\`
         Allowed values: 'metal' (steel, iron, chains, coins), 'wood' (planks, crates, pins, dominoes), 'stone' (bricks,
         rocks, concrete), 'glass' (bottles, marbles), 'rubber' (tyres, bouncy or inflated balls), 'plastic' (toys, cups,
         bowling balls), 'soft' (cloth, foam, cushions), 'generic' (only when you truly cannot tell).
       - Honest sound depends on honest physics: give objects realistic relative masses and sizes, because a heavy
         object sounds deeper and louder and shakes the view, and a light one does not.
       - Call \`setAmbience('space')\` once for scenes in a vacuum (orbits, satellites, the Moon): it removes air noise.
         Call \`setAmbience('wind')\` for open outdoor scenes. Do not call it for indoor or table-top scenes.
       - Do NOT create an AudioContext, Audio element or call navigator.vibrate, and do not move the camera to fake a shake.

    9. **MAIN OBJECT AND BOUNDARIES (REQUIRED when startMode is "click")**:
       - Mark the ONE object the user sets off (the ball that is rolled, thrown, released or launched) by adding
         'main: true' to its options: \`addSimulationObject('Ball', ballMesh, ballBody, { sound: 'rubber', main: true });\`
       - The app keeps that object on the ground for you: it cannot leave the ground's edges and cannot sink through it.
         Do NOT build your own invisible walls for this. It relies on the ground from addGround.
       - Where the real scene has barriers (lane rails, a backstop, table cushions, a goal net), DO build them as visible
         static bodies, so the main object is stopped by something the viewer can see.

    WORKED EXAMPLE of the quality expected (a different scene from yours; match its realism, not its content).
    Request: "a woman drops a basketball and a tennis ball from a balcony at the same time"
    \`\`\`javascript
    world.gravity.set(0, -9.81, 0);
    world.solver.iterations = 30;
    world.allowSleep = false;
    const ground = addGround('grass');
    camera.position.set(7.5, 4.2, 11);
    camera.userData.lookAt = [0, 3.3, 0];
    const t0 = world.time;

    // Scenery: a brick house wall with a concrete balcony 6 m up and a dark steel railing
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 9, 0.3), realMaterial('brick', { size: [8, 9] }));
    wall.position.set(0, 4.5, -1.6);
    wall.castShadow = wall.receiveShadow = true;
    scene.add(wall);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1.5), realMaterial('concrete', { size: 3 }));
    slab.position.set(0, 5.9, -0.7);
    slab.castShadow = slab.receiveShadow = true;
    scene.add(slab);
    world.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(1.5, 0.1, 0.75)), position: new CANNON.Vec3(0, 5.9, -0.7) }));
    const railing = realMaterial('painted-metal', { color: 0x1f2937 });
    [-1.45, -0.5, 0.5, 1.45].forEach(x => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 12), railing);
        post.position.set(x, 6.5, 0.0);
        post.castShadow = true;
        scene.add(post);
    });
    const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.95, 12), railing);
    handrail.rotation.z = Math.PI / 2;
    handrail.position.set(0, 7.0, 0.0);
    scene.add(handrail);

    // The woman stands at the railing holding both balls out over it
    const woman = addHuman('woman', { height: 1.66, pose: h => {
        h.setPose('stand');
        h.aim('LeftArm', [0.25, -0.05, 1]);  h.aim('LeftForeArm', [0.1, 0, 1]);
        h.aim('RightArm', [-0.25, -0.05, 1]); h.aim('RightForeArm', [-0.1, 0, 1]);
    }});
    woman.object.position.set(0, 6.0, -0.4);

    // Two balls at the same height, in her hands past the railing: a 0.62 kg basketball and a 0.058 kg tennis ball
    const H = 7.25;
    const makeBall = (label, radius, mass, material, x, bounce) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), material);
        mesh.castShadow = true;
        const physMat = new CANNON.Material(label);
        world.addContactMaterial(new CANNON.ContactMaterial(physMat, ground.material, { friction: 0.6, restitution: bounce }));
        const body = new CANNON.Body({ mass, material: physMat, shape: new CANNON.Sphere(radius),
            position: new CANNON.Vec3(x, H, 0.32), linearDamping: 0.01, angularDamping: 0.05 });
        addSimulationObject(label, mesh, body, { sound: 'rubber', main: label === 'Basketball' });
        return body;
    };
    const basketball = makeBall('Basketball', 0.12, 0.62, realMaterial('basketball'), 0.3, 0.75);
    const tennisBall = makeBall('TennisBall', 0.0335, 0.058, realMaterial('felt', { color: 0xcde04a }), -0.3, 0.7);

    // Report once now (frame callbacks only run once time is running) and then every frame
    const report = () => {
        const t = world.time - t0;
        setReadout('Free fall', [
            ['Time since release', t.toFixed(2) + ' s'],
            ['Basketball height · speed', basketball.position.y.toFixed(2) + ' m · ' + basketball.velocity.length().toFixed(1) + ' m/s'],
            ['Tennis ball height · speed', tennisBall.position.y.toFixed(2) + ' m · ' + tennisBall.velocity.length().toFixed(1) + ' m/s'],
            ['Predicted fall time √(2h/g)', Math.sqrt(2 * (H - 0.12) / 9.81).toFixed(2) + ' s'],
            'Gravity gives every object the same acceleration, 9.81 m/s², whatever its mass, so they land together.'
        ]);
    };
    report();
    addFrameCallback(report);
    \`\`\`
    (startMode "click", startHint "Click anywhere to drop both balls"; sliders: Basketball Mass, Tennis Ball Mass, Gravity.)

    OUTPUT:
    Fill 'scene_plan' first, then return valid JavaScript in the JSON 'code' field that follows that plan.
  `;

const RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Short name for the scene, 2 to 4 words, e.g. 'Wrecking Ball'." },
      scene_plan: { type: Type.STRING, description: "Written BEFORE the code: the setting and ground kind; every object with its real size (m), mass (kg), realMaterial and the parts it is built from; the props; any people with their pose; the physics (contact pairs with mu and e, starting speeds, the expected outcome with numbers); the camera position and lookAt; the readout rows." },
      thought_process: { type: Type.STRING, description: "Shown to the user: the explanation in the required format, with this scene's real numbers." },
      code: { type: Type.STRING, description: "Executable JavaScript code for Three.js and Cannon-es." },
      sliders: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            targetLabel: { type: Type.STRING, description: "The label used in addSimulationObject, or 'world'." },
            property: { type: Type.STRING, enum: ["scale", "mass", "friction", "restitution", "gravity", "damping"] },
            min: { type: Type.NUMBER },
            max: { type: Type.NUMBER },
            value: { type: Type.NUMBER },
            step: { type: Type.NUMBER }
          },
          required: ["label", "targetLabel", "property", "min", "max", "value"]
        }
      },
      startMode: { type: Type.STRING, enum: ["click", "auto"], description: "'click' for a one-off triggered event, 'auto' for continuous motion." },
      startHint: { type: Type.STRING, description: "Short prompt such as 'Click anywhere to roll the ball'. Empty when startMode is 'auto'." }
    },
    required: ["scene_plan", "thought_process", "code", "sliders", "startMode"],
    // The plan comes before the code, so the model designs the scene before it writes it
    propertyOrdering: ["title", "scene_plan", "thought_process", "code", "sliders", "startMode", "startHint"]
  };

// Added to the instructions when the scene comes from a written description instead of a video
const TEXT_MODE_NOTE = `
    THIS REQUEST HAS NO VIDEO. The user describes the scene in words instead.
    - Wherever the rules above say "the video", read "the described scene".
    - Its "first frame" is the moment just before the action starts: build every object in the pose and with the
      velocity it has at that moment.
    - Fill in everything the description leaves out the way it really is: the place, the ground, real sizes, masses,
      materials and colours, the props that belong there, and the people involved. A short request such as "a ball
      rolls down a ramp" still gets a complete, believable setting (for example a lab bench with a wooden ramp and
      supports, a steel ball and a measuring rule), not bare shapes on an empty floor.
    - If the description is not a physical scene, build the closest realistic physical scene that fits it.
`;

export type GenerationStage = 'reading' | 'measuring' | 'analysing' | 'checking' | 'repairing' | 'reviewing' | 'improving' | 'building'
  // Textbook problems (lib/problems.ts)
  | 'solving' | 'verifying' | 'reconciling';

export interface GenerationOptions {
  // Reports real progress: which step is running, with an optional detail such as the model in use
  onStage?: (stage: GenerationStage, detail?: string) => void;
  // Best quality: Pro models first, with longer time limits (slower, and they use more of the quota)
  quality?: boolean;
}

export type GenerationSource =
  | { kind: 'video'; base64Data: string; mimeType: string }
  | { kind: 'text'; prompt: string }
  | { kind: 'problem'; brief: string };   // A textbook problem's set-up (lib/problems.ts)

// Everything a scene request is built from
export interface SceneContext {
  source: GenerationSource;
  chain: string[];
  timeout: number;
  facts: string;      // Measured from the video in a first pass ('' for text requests)
  examples: string;   // Similar scenes, as worked examples ('' when none fit)
  feedback: string;   // What this user disliked about earlier scenes ('' when nothing)
  // Problem scenes: more instructions, and more fields in the answer
  extraInstruction?: string;
  extraFields?: { properties: Record<string, any>; required: string[] };
}

// A previous attempt and what is wrong with it
export interface Revision {
  kind: 'repair' | 'improve';
  code: string;
  problems: string[];
  extra?: string;     // More of the previous attempt to show with its code (a problem scene's measurement code)
}

export interface Candidate {
  data: SimulationData;
  plan: string;
  raw: any;           // The model's whole answer, for any extra fields
  check?: SceneCheck;
}

export const MAX_REPAIRS = 2;   // Fix attempts after the automatic test finds problems

const BASE_REQUEST = "Generate a realistic, educational 3D physics scene that is also stable. Plan it in 'scene_plan' first. Use addGround once, realMaterial on every mesh, real sizes and masses, people where the situation has people, a framed camera, and a live setReadout. Use addSimulationObject for movable objects only, each with its { sound } material.";

export const bulletList = (items: string[]) => items.map(p => `- ${p}`).join('\n');

// One scene request to the model (with fallback across models and keys). With a revision, the model gets
// its previous code and the problems found in it, and fixes that code instead of starting over.
export async function requestScene(ctx: SceneContext, options: GenerationOptions, stage: GenerationStage, revision?: Revision): Promise<Candidate> {
  const parts: any[] = [];
  const { source } = ctx;
  // The clip is the largest part of a request. Once it has been measured, the facts carry its numbers:
  // the first design still watches it (at low resolution), and repairs, which fix code, go without it.
  const measured = !!ctx.facts;
  const sendVideo = source.kind === 'video' && !(measured && revision);
  if (source.kind === 'video' && sendVideo) parts.push({ inlineData: { mimeType: source.mimeType, data: source.base64Data } });
  if (ctx.examples) parts.push({ text: ctx.examples });
  if (ctx.facts) parts.push({ text: ctx.facts });
  if (ctx.feedback) parts.push({ text: ctx.feedback });
  parts.push({ text: source.kind === 'video'
    ? (sendVideo ? BASE_REQUEST : `The scene rebuilds the video described by the measured facts above.\n\n${BASE_REQUEST}`)
    : source.kind === 'problem'
      ? `${source.brief}\n\n${BASE_REQUEST}`
      : `Scene description from the user:\n"""\n${source.prompt}\n"""\n\n${BASE_REQUEST}` });
  if (revision) {
    const why = revision.kind === 'repair'
      ? 'An automatic test built and ran your previous scene and found these problems'
      : 'A reviewer looked at pictures of your previous scene (the opening shot, and the view a moment after it starts) and asked for these changes';
    parts.push({ text: `${why}:\n${bulletList(revision.problems)}\n\nYour previous code:\n\`\`\`javascript\n${revision.code}\n\`\`\`\n${revision.extra ? `\n${revision.extra}\n` : ''}\nReturn the complete scene again with every one of these fixed. Change only what is needed to fix them and keep everything that already works (the setting, materials, people, readout and camera, unless a problem is about them). Update scene_plan and thought_process to match.` });
  }
  const instruction = (source.kind === 'video' ? SYSTEM_INSTRUCTION : SYSTEM_INSTRUCTION + TEXT_MODE_NOTE) + (ctx.extraInstruction || '');
  const schema = ctx.extraFields
    ? {
        ...RESPONSE_SCHEMA,
        properties: { ...RESPONSE_SCHEMA.properties, ...ctx.extraFields.properties },
        required: [...RESPONSE_SCHEMA.required, ...ctx.extraFields.required],
        propertyOrdering: [...RESPONSE_SCHEMA.propertyOrdering, ...Object.keys(ctx.extraFields.properties)]
      }
    : RESPONSE_SCHEMA;

  return withModelFallback(async (model, ai) => {
    const response = await generateThinking(ai, {
      model,
      contents: [{ parts }],
      config: {
        systemInstruction: instruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        ...(sendVideo && measured ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
        httpOptions: { timeout: ctx.timeout },
      }
    // Visual touch-ups are small, listed edits; physics repairs and new scenes get the full reasoning
    }, revision?.kind === 'improve' ? ThinkingLevel.MEDIUM : ThinkingLevel.HIGH);

    const text = response.text;
    if (!text) throw new Error("No response text");
    const raw = JSON.parse(text);
    return { data: normalizeSimulation(raw), plan: typeof raw.scene_plan === 'string' ? raw.scene_plan : '', raw };
  }, (model) => options.onStage?.(stage, model), ctx.chain);
}

// --- Step 1 for videos: measure what happens before designing anything ---

const MEASURE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "Two or three sentences: what happens in the video, start to finish." },
    setting: { type: Type.STRING, description: "Where it happens (indoors/outdoors, the kind of ground or surface, props around it)." },
    objects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          material: { type: Type.STRING, description: "What it is made of, and its colour." },
          size: { type: Type.STRING, description: "Real dimensions in metres, and how you judged them (e.g. next to a person or a door)." },
          mass: { type: Type.STRING, description: "Estimated mass in kg, and why." },
          start: { type: Type.STRING, description: "Where it is and how it is moving at the start (position relative to the others, speed in m/s, direction)." }
        },
        required: ["name", "material", "size", "mass", "start"]
      }
    },
    people: { type: Type.STRING, description: "Each person: what they do, their pose, roughly how tall. 'None' if there are none." },
    events: { type: Type.STRING, description: "What happens, in order, with times in seconds from the start of the clip." },
    measurements: { type: Type.STRING, description: "Every quantity you can estimate (speeds, heights, distances, angles, durations, bounce heights), with the working, e.g. 'falls 1.2 m in 0.5 s'." },
    camera: { type: Type.STRING, description: "Where the camera is relative to the action and how far away." }
  },
  required: ["summary", "setting", "objects", "people", "events", "measurements", "camera"]
};

const MEASURE_INSTRUCTION = `
    You are a physicist measuring a video before it is rebuilt as a 3D simulation. Do not design or write any code.
    Watch the whole clip carefully and report only what it shows, as real-world quantities in metres, kilograms and
    seconds. Judge sizes from things of known size in the frame (people about 1.7 m, doors 2.0 m, tables 0.75 m high,
    floor tiles, balls of a recognisable type). Work out speeds from distance over time between frames; use free fall
    (h = ½gt²) to check heights and times. Say how sure you are when a number is a rough estimate.
`;

async function measureVideo(ctx: SceneContext, options: GenerationOptions): Promise<{ text: string; summary: string } | null> {
  if (ctx.source.kind !== 'video') return null;
  const { base64Data, mimeType } = ctx.source;
  const raw = await withModelFallback(async (model, ai) => {
    const response = await generateThinking(ai, {
      model,
      contents: [{ parts: [{ inlineData: { mimeType, data: base64Data } }, { text: 'Measure this video.' }] }],
      config: { systemInstruction: MEASURE_INSTRUCTION, responseMimeType: "application/json", responseSchema: MEASURE_SCHEMA, httpOptions: { timeout: ctx.timeout } }
    }, ThinkingLevel.HIGH);
    if (!response.text) throw new Error("No response text");
    return JSON.parse(response.text);
  }, (model) => options.onStage?.('measuring', model), ctx.chain);

  const objects = Array.isArray(raw.objects) ? raw.objects.map((o: any) =>
    `  - ${o.name}: ${o.material}; size ${o.size}; mass ${o.mass}; at the start ${o.start}`).join('\n') : '';
  const text = `MEASURED FACTS (from a first careful pass over this video; build the scene with these numbers, and check them against the video yourself):
Summary: ${raw.summary}
Setting: ${raw.setting}
Objects:
${objects}
People: ${raw.people}
Events: ${raw.events}
Measurements: ${raw.measurements}
Camera: ${raw.camera}`;
  return { text, summary: `${raw.summary || ''} ${raw.setting || ''}`.trim() };
}

// --- Visual review: the model looks at pictures of what it built ---

const REVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING, enum: ["good", "revise"] },
    issues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Only clear, visible problems, at most 5, each one a concrete change naming the object and the numbers (e.g. 'move the camera to (6, 3, 9) so the target is in view')."
    }
  },
  required: ["verdict", "issues"]
};

const REVIEW_INSTRUCTION = `
    You are an art director and physics teacher reviewing a generated 3D physics simulation before a student sees it.
    You get the request, the plan, the code, and two pictures rendered from it: the opening shot (time frozen at the
    start) and the same camera a moment after the action starts. The pictures show exactly what the viewer sees: the
    app's controls sit around the view, never over it. People may appear in a neutral pose if their model was slow to load.
    Look for clear, visible problems only:
    - Framing: the moving object, where it goes and the people involved must be in view and fill a fair part of the frame;
      nothing important cut off, hidden behind something, or tiny in the distance; the camera not inside an object. To
      bring something into view, move camera.userData.lookAt or the camera so it sits nearer the middle of the picture.
    - Realism: objects at true scale relative to each other and to people; built from proper parts, not bare boxes;
      believable materials and colours; a setting that fits the request.
    - Physics: nothing floating, sunk into the ground or overlapping; in the second picture, things moving the way the
      request says (toward the target, falling, swinging...).
    - Completeness: every object, person and event in the request is there.
    Answer "good" when the scene is fine or the problems are minor. Answer "revise" only for problems a student would
    notice, and say exactly how to fix each one in terms of the code.
`;

export async function reviewScene(ctx: SceneContext, options: GenerationOptions, request: string, candidate: Candidate): Promise<string[]> {
  const preview = await renderPreview(candidate.data);
  if (!preview) return [];
  const result = await withModelFallback(async (model, ai) => {
    const response = await generateThinking(ai, {
      model,
      contents: [{ parts: [
        { text: `Request: ${request}\n\nPlan:\n${candidate.plan}\n\nCode:\n\`\`\`javascript\n${candidate.data.code}\n\`\`\`` },
        { text: 'Picture 1: the opening shot.' },
        { inlineData: { mimeType: 'image/jpeg', data: preview.start } },
        { text: `Picture 2: the same camera ${preview.laterSeconds} s after the action starts.` },
        { inlineData: { mimeType: 'image/jpeg', data: preview.later } }
      ] }],
      // Medium resolution is plenty to judge framing, scale and materials, at a fraction of the image tokens
      config: { systemInstruction: REVIEW_INSTRUCTION, responseMimeType: "application/json", responseSchema: REVIEW_SCHEMA, mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM, httpOptions: { timeout: ctx.timeout } }
    }, ThinkingLevel.MEDIUM);
    if (!response.text) throw new Error("No response text");
    return JSON.parse(response.text);
  }, (model) => options.onStage?.('reviewing', model), ctx.chain);
  const issues = Array.isArray(result?.issues) ? result.issues.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 5) : [];
  return result?.verdict === 'revise' ? issues : [];
}

// --- The whole generation ---

// Generates a scene, tests it, has it fixed (up to MAX_REPAIRS times) while the test finds problems,
// then shows pictures of it to the model for a final improvement. The best version that runs is kept.
async function generateChecked(source: GenerationSource, options: GenerationOptions): Promise<SimulationData> {
  if (!(await loadKeyCount())) {
    throw new Error("Creating new scenes is not set up on this server yet. Open one of the built-in demos instead.");
  }

  const ctx: SceneContext = {
    source,
    chain: options.quality ? QUALITY_CHAIN : MODEL_CHAIN,
    timeout: options.quality ? QUALITY_TIMEOUT_MS : SCENE_TIMEOUT_MS,
    facts: '', examples: '', feedback: feedbackNote()
  };

  // Videos are measured first; the measurements then guide the design (and the choice of examples)
  let request = source.kind === 'text' ? source.prompt : '';
  if (source.kind === 'video') {
    options.onStage?.('measuring');
    try {
      const facts = await measureVideo(ctx, options);
      if (facts) { ctx.facts = facts.text; request = facts.summary; }
    } catch (e) {
      // The scene can still be designed from the video alone
      console.warn('[Gemini] Measuring the video failed; designing from the video alone:', e);
    }
  }
  try {
    ctx.examples = examplesText(await pickExamples(request));
  } catch (e) {
    console.warn('[Gemini] Could not pick examples:', e);
  }

  const test = async (candidate: Candidate): Promise<Candidate> => {
    options.onStage?.('checking');
    candidate.check = await checkSimulation(candidate.data);
    if (!candidate.check.ok || candidate.check.issues.length) console.warn('[Gemini] Scene check found problems:', problemsOf(candidate.check));
    return candidate;
  };
  const better = (a: Candidate, b: Candidate) => (checkScore(b.check!) < checkScore(a.check!) ? b : a);

  options.onStage?.('analysing');
  let best = await test(await requestScene(ctx, options, 'analysing'));
  // Each repair starts from the best version so far, so a repair that makes things worse is not built on
  for (let attempt = 0; attempt < MAX_REPAIRS && checkScore(best.check!) > 0; attempt++) {
    options.onStage?.('repairing');
    try {
      const repaired = await test(await requestScene(ctx, options, 'repairing', { kind: 'repair', code: best.data.code, problems: problemsOf(best.check!) }));
      best = better(best, repaired);
    } catch (e) {
      if (!best.check!.ok) throw e;
      console.warn('[Gemini] Repair request failed; keeping the best scene so far:', e);
      break;
    }
  }
  if (!best.check!.ok) {
    throw new Error(`The generated scene did not pass its physics check, even after ${MAX_REPAIRS} repair attempts. ${best.check!.error}. Please try again.`);
  }

  // The model looks at what it built and fixes what shows. Optional: any failure here keeps the scene as it is.
  try {
    options.onStage?.('reviewing');
    const changes = await reviewScene(ctx, options, request || 'Rebuild the physical situation in the video.', best);
    if (changes.length) {
      console.info('[Gemini] Visual review asked for changes:', changes);
      options.onStage?.('improving');
      const improved = await test(await requestScene(ctx, options, 'improving', { kind: 'improve', code: best.data.code, problems: changes }));
      // Kept only if it still runs and the automatic test finds no more problems than before
      if (improved.check!.ok && improved.check!.issues.length <= best.check!.issues.length) {
        best = improved;
        console.info('[Gemini] Using the improved scene.');
      } else {
        console.info('[Gemini] The improved scene tested worse; keeping the previous one.');
      }
    }
  } catch (e) {
    console.warn('[Gemini] Visual review skipped:', e);
  }

  options.onStage?.('building');
  return { ...best.data, request: request || undefined };
}

export const generateSimulation = (base64Data: string, mimeType: string, options: GenerationOptions = {}): Promise<SimulationData> =>
  generateChecked({ kind: 'video', base64Data, mimeType }, options);

export const MAX_PROMPT_LENGTH = 600;

export const generateSimulationFromText = (prompt: string, options: GenerationOptions = {}): Promise<SimulationData> =>
  generateChecked({ kind: 'text', prompt: prompt.trim().slice(0, MAX_PROMPT_LENGTH) }, options);
