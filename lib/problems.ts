// Problem -> Simulation -> Verified solution.
// A student types or photographs a textbook problem, and gets a worked solution whose answers were
// measured in a 3D simulation of the problem before they see it:
//  1. read:   transcribe the problem; list the givens, what is asked, and the set-up to simulate.
//  2. then, at the same time:
//       solve: a step-by-step worked solution;
//       build: the scene and its measurement code, from the set-up alone. The builder never sees the
//              solution, so when the two agree that means something.
//  3. verify: run the scene (lib/measure.ts) and compare each measured answer with the solution's.
//     Where they disagree, a reviewer works out which is wrong, and the solution or the scene is fixed.
import { Type, ThinkingLevel } from "@google/genai";
import {
  ProblemAnswer, ProblemGiven, ProblemSolution, SimulationData, SolutionStep
} from "../types";
import {
  withModelFallback, generateThinking, requestScene, reviewScene, loadKeyCount, bulletList,
  GenerationOptions, SceneContext, Candidate, MODEL_CHAIN, QUALITY_CHAIN, SCENE_TIMEOUT_MS, QUALITY_TIMEOUT_MS, MAX_REPAIRS
} from "./gemini";
import { checkSimulation, problemsOf } from "./validate";
import { measureScene, agrees } from "./measure";
import { buildHeadless } from "./headless";
import { feedbackNote } from "./feedback";

export const MAX_PROBLEM_LENGTH = 3000;
const DEFAULT_TOLERANCE = 0.02;   // Measured and worked answers agree within 2 %
const MAX_RECONCILES = 2;         // Rounds of "which one is wrong?" when they disagree
const READ_TIMEOUT_MS = 45000;

export interface ProblemInput {
  text: string;                                      // The problem, or a note about the photo
  image?: { base64Data: string; mimeType: string };  // A photo of the problem
}

// --- 1. Reading the problem ---

const READ_INSTRUCTION = `
    You are a physics teacher reading a problem a student has given you, typed or as a photo of a textbook or
    worksheet page. Do not solve it yet.
    - 'statement': the problem, transcribed exactly with every number and unit. From a photo, take the problem the
      student means (the one their note names, otherwise the first complete one), including the labels and numbers
      of any figure, described in words.
    - 'givens': every given quantity with its symbol and its value with unit.
    - 'asked': one entry per quantity asked for, in order: a snake_case id, a name, a symbol, and the unit the answer
      is given in (SI: m, s, kg, N, J, W, m/s, m/s², rad/s, Hz, N/m; degrees for angles).
      Decide for each whether a rigid-body simulation of the set-up can MEASURE it from the motion: times, positions,
      distances, heights, ranges, speeds, velocities, accelerations, angles, angular speeds, periods, speeds after a
      collision, how far something slides. Mark it not measurable (with a short 'reason') when it is a force, energy,
      work, power, impulse or coefficient, or when the set-up needs what a rigid-body engine cannot model faithfully:
      strings over pulleys, fluids and buoyancy, electric and magnetic fields, circuits, heat, light, sound, waves,
      relativity, quantum effects.
      For a measurable quantity write 'how': the event and the reading that measures it, e.g. "the time from release
      until the block has slid 5.0 m along the incline". Never include the answer or a formula for it.
    - 'setup': everything someone needs to build a simulation of the situation, using the problem's numbers: every
      object with its size, mass and material; every surface with its angle and friction; starting positions and
      velocities; g; what happens. Where the problem leaves a size out (a "block", a "ball"), say a small realistic
      size will do. Never include the answers or how to work them out.
    - 'assumptions': the idealisations a textbook solution makes (g = 9.8 m/s² as given, no air resistance, the block
      is a particle, the string is light and inextensible...). 'air_resistance' is true only if the problem includes it.
    If the input is not a physics problem, or the photo cannot be read, put a short friendly explanation in
    'not_a_problem' and leave the other fields empty.
`;

const READ_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    not_a_problem: { type: Type.STRING, description: "Empty for a physics problem; otherwise why this cannot be solved." },
    title: { type: Type.STRING, description: "2 to 5 words naming the problem, e.g. 'Block on an Incline'." },
    topic: { type: Type.STRING, description: "Area and topic, e.g. 'Mechanics · Newton's laws on an incline'." },
    statement: { type: Type.STRING },
    givens: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { symbol: { type: Type.STRING }, name: { type: Type.STRING }, value: { type: Type.STRING } },
        required: ["symbol", "name", "value"]
      }
    },
    asked: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          symbol: { type: Type.STRING },
          unit: { type: Type.STRING },
          measurable: { type: Type.BOOLEAN },
          how: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["id", "name", "symbol", "unit", "measurable"]
      }
    },
    setup: { type: Type.STRING },
    assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    air_resistance: { type: Type.BOOLEAN }
  },
  required: ["not_a_problem", "title", "topic", "statement", "givens", "asked", "setup", "assumptions", "air_resistance"],
  propertyOrdering: ["not_a_problem", "title", "topic", "statement", "givens", "asked", "setup", "assumptions", "air_resistance"]
};

interface ReadProblem {
  title: string;
  topic: string;
  statement: string;
  givens: ProblemGiven[];
  asked: { id: string; name: string; symbol: string; unit: string; measurable: boolean; how?: string; reason?: string }[];
  setup: string;
  assumptions: string[];
  airResistance: boolean;
}

const str = (v: any, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strings = (v: any, max = 400): string[] => (Array.isArray(v) ? v.map(s => str(s, max)).filter(Boolean) : []);
const snake = (v: any): string => str(v, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// The input as the model gets it: the photo first, then what the student typed
function inputParts(input: ProblemInput): any[] {
  const parts: any[] = [];
  if (input.image) parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64Data } });
  const text = input.text.trim();
  if (input.image) parts.push({ text: text ? `The student's note about the photo:\n"""\n${text}\n"""` : 'The problem is in the photo.' });
  else parts.push({ text: `The problem:\n"""\n${text}\n"""` });
  return parts;
}

async function readProblem(input: ProblemInput, ctx: SceneContext, options: GenerationOptions): Promise<ReadProblem> {
  const raw = await withModelFallback(async (model, ai) => {
    const response = await generateThinking(ai, {
      model,
      contents: [{ parts: inputParts(input) }],
      // Reading is a short job: a model that takes longer is stuck, and the next one is tried
      config: { systemInstruction: READ_INSTRUCTION, responseMimeType: "application/json", responseSchema: READ_SCHEMA, httpOptions: { timeout: Math.min(ctx.timeout, READ_TIMEOUT_MS) } }
    }, ThinkingLevel.MEDIUM);
    if (!response.text) throw new Error("No response text");
    return JSON.parse(response.text);
  }, (model) => options.onStage?.('reading', model), ctx.chain);

  if (str(raw.not_a_problem)) throw new Error(str(raw.not_a_problem, 400));
  const seen = new Set<string>();
  const asked = (Array.isArray(raw.asked) ? raw.asked : []).map((a: any, i: number) => {
    let id = snake(a?.id) || `answer_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    return {
      id, name: str(a?.name, 120) || id, symbol: str(a?.symbol, 30), unit: str(a?.unit, 30),
      measurable: a?.measurable === true && !!str(a?.how),
      ...(str(a?.how) ? { how: str(a.how, 400) } : {}),
      ...(str(a?.reason) ? { reason: str(a.reason, 300) } : {})
    };
  });
  const statement = str(raw.statement);
  if (!statement || !asked.length) throw new Error("I couldn't find a question to answer in that problem. Please check it asks for something, or type it out.");
  return {
    title: str(raw.title, 60) || 'Physics problem',
    topic: str(raw.topic, 100),
    statement,
    givens: (Array.isArray(raw.givens) ? raw.givens : [])
      .map((g: any) => ({ symbol: str(g?.symbol, 30), name: str(g?.name, 120), value: str(g?.value, 60) }))
      .filter((g: ProblemGiven) => g.value),
    asked,
    setup: str(raw.setup, 6000),
    assumptions: strings(raw.assumptions),
    airResistance: raw.air_resistance === true
  };
}

// --- 2a. The worked solution ---

const SOLVE_INSTRUCTION = `
    You are an excellent physics teacher writing the worked solution a student will study. Solve the problem step by
    step, the way a good textbook does:
    - Start from the physics: name the principle (Newton's second law along the incline, conservation of energy,
      constant-acceleration kinematics...) and set up the free-body diagram or energy balance in words.
    - One idea per step: a short title, a short explanation, and at most one displayed equation in LaTeX. Write the
      relation in symbols first, then substitute the numbers with their units, then the result. Inline maths in the
      explanation goes between $...$.
    - Keep full precision in intermediate values; round only the final answers, to 3 significant figures unless the
      problem asks otherwise.
    - Check the results: units, sign, size, and a quick limiting case where there is one.
    - 'answers': one entry per asked quantity, with its id, its value as a number in the stated unit (null only when the
      answer is not a single number) and how it is written for the student (e.g. "2.02 s").
    - 'summary': one or two sentences giving the final answers.
`;

const STEPS_PROPERTY = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: { title: { type: Type.STRING }, text: { type: Type.STRING }, equation: { type: Type.STRING, description: "LaTeX, without $ signs. Empty if none." } },
    required: ["title", "text"]
  }
};
const ANSWERS_PROPERTY = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: { id: { type: Type.STRING }, value: { type: Type.NUMBER, nullable: true }, display: { type: Type.STRING } },
    required: ["id", "value", "display"]
  }
};

const SOLVE_SCHEMA = {
  type: Type.OBJECT,
  properties: { steps: STEPS_PROPERTY, answers: ANSWERS_PROPERTY, summary: { type: Type.STRING } },
  required: ["steps", "answers", "summary"],
  propertyOrdering: ["steps", "answers", "summary"]
};

interface WorkedSolution {
  steps: SolutionStep[];
  answers: Record<string, { value: number | null; display: string }>;
  summary: string;
}

const askedText = (read: ReadProblem) => bulletList(read.asked.map(a => `${a.id}: ${a.name}${a.symbol ? ` (${a.symbol})` : ''}, in ${a.unit || 'its unit'}`));
const givensText = (read: ReadProblem) => bulletList(read.givens.map(g => `${g.symbol ? `${g.symbol} = ` : ''}${g.value}${g.name ? ` (${g.name})` : ''}`));

function parseSolution(raw: any): WorkedSolution | null {
  const steps = (Array.isArray(raw?.steps) ? raw.steps : [])
    .map((s: any) => ({ title: str(s?.title, 160), text: str(s?.text, 2000), ...(str(s?.equation) ? { equation: str(s.equation, 1000) } : {}) }))
    .filter((s: SolutionStep) => s.title || s.text);
  const answers: WorkedSolution['answers'] = {};
  (Array.isArray(raw?.answers) ? raw.answers : []).forEach((a: any) => {
    const id = snake(a?.id);
    if (!id) return;
    const value = typeof a?.value === 'number' && Number.isFinite(a.value) ? a.value : null;
    answers[id] = { value, display: str(a?.display, 80) };
  });
  if (!steps.length || !Object.keys(answers).length) return null;
  return { steps, answers, summary: str(raw?.summary, 1000) };
}

async function solveProblem(input: ProblemInput, read: ReadProblem, ctx: SceneContext, options: GenerationOptions): Promise<WorkedSolution> {
  return withModelFallback(async (model, ai) => {
    const response = await generateThinking(ai, {
      model,
      contents: [{ parts: [
        ...(input.image ? [{ inlineData: { mimeType: input.image.mimeType, data: input.image.base64Data } }] : []),
        { text: `Problem:\n"""\n${read.statement}\n"""\n\nGiven:\n${givensText(read)}\n\nAssumptions:\n${bulletList(read.assumptions)}\n\nFind (use these ids in 'answers'):\n${askedText(read)}` }
      ] }],
      config: { systemInstruction: SOLVE_INSTRUCTION, responseMimeType: "application/json", responseSchema: SOLVE_SCHEMA, httpOptions: { timeout: ctx.timeout } }
    }, ThinkingLevel.HIGH);
    if (!response.text) throw new Error("No response text");
    const solution = parseSolution(JSON.parse(response.text));
    if (!solution) throw new Error("The model returned no usable solution");
    return solution;
  }, (model) => options.onStage?.('solving', model), ctx.chain);
}

// --- 2b. The simulation, built from the set-up alone ---

const PROBLEM_SCENE_NOTE = `

    THIS SCENE IS A TEXTBOOK PROBLEM. The app MEASURES the problem's answers in your simulation and compares them with a
    worked solution a student will study, so the physics must be exactly the problem's. These rules come before the
    realism rules above where they differ:
    - Use the problem's numbers exactly: masses, lengths, heights, angles, speeds, coefficients, spring constants, and
      g as stated (world.gravity.set(0, -9.8, 0) when the problem uses 9.8; -9.81 when it gives no value).
    - Ideal conditions unless the problem says otherwise: linearDamping 0 and angularDamping 0 on every moving body (no
      air resistance). Restitution as given: 0 for a perfectly inelastic collision, 1 for an elastic one. Do not set
      contactEquationStiffness or contactEquationRelaxation: the app sets contacts up so e comes out exact.
    - Friction: the app applies Coulomb friction, at most mu x N with the real normal force. Give every contact pair
      that matters its own CANNON.ContactMaterial with the problem's coefficient (the kinetic one when both are given),
      and friction 0 where the problem says smooth or frictionless. Build each surface the problem describes (a slope,
      a table top, a track) as its own static body with its own material; do not rely on addGround's defaults for it.
    - A "block" or particle is a small CANNON.Box (a ball is a Sphere), about 0.2 m unless the problem gives a size.
    - Objects that start on a surface start resting ON it (centre = surface top + radius or half height + 0.001),
      never floating above it. Bodies in a head-on collision have their centres at the same height when they meet:
      give them the same size, or set each on the surface so the centres line up, otherwise the collision is
      oblique and the answers change.
    - Slopes: a static slab tilted by the problem's angle, with the block's bottom face ON its top surface (not on the
      slab's centre line: the surface is half the slab's thickness above it). Follow this recipe (angle th, slope
      length L, block side s, going down towards +x with its bottom end just above the ground):
        const dir = new CANNON.Vec3(Math.cos(th), -Math.sin(th), 0);   // down the slope
        const nrm = new CANNON.Vec3(Math.sin(th), Math.cos(th), 0);    // out of the surface
        const q = new CANNON.Quaternion(); q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -th);
        const T = 0.2;                                                  // slab thickness
        const top = new CANNON.Vec3(-L * Math.cos(th), 0.3 + L * Math.sin(th), 0);   // top end of the SURFACE
        const slab = new CANNON.Body({ mass: 0, material: slopeMat, shape: new CANNON.Box(new CANNON.Vec3(L / 2 + 0.3, T / 2, 0.5)) });
        slab.quaternion.copy(q);
        slab.position.copy(top.vadd(dir.scale(L / 2)).vsub(nrm.scale(T / 2)));   // 0.3 m spare at each end
        world.addBody(slab);
        block.quaternion.copy(q);
        block.position.copy(top.vadd(nrm.scale(s / 2 + 0.001)));         // resting on the surface at the top end
      Its mesh: a BoxGeometry(L + 0.6, T, 1.0) at the slab's position and rotation. Distance travelled down the slope
      is block.position.vsub(start).dot(dir).
    - Start at the problem's initial instant: every object at its starting position with its starting velocity.
      startMode "click".
    - Never script the motion. Frame callbacks only update the readout and visuals. A force the problem describes (a
      push or pull, thrust, a spring) is applied every physics step, at the centre of mass:
      world.addEventListener('preStep', () => body.applyForce(new CANNON.Vec3(Fx, Fy, 0)));
      (applyForce's optional second argument is a point RELATIVE to the centre of mass, never body.position.)
      A spring is a CANNON.Spring with the problem's k and natural length: world.addEventListener('preStep', () => spring.applyForce()).
    - A sliding block or particle cannot tip or spin: give its body fixedRotation: true. Only objects the problem
      says roll, swing or rotate keep their rotation.
    - Lay the motion out along +x (and +y up), so distances and heights are easy to read, and frame it like a
      textbook figure: the camera side-on, in front of the x-y plane (+z), level with the middle of the motion and
      far enough back to show the whole path; camera.userData.lookAt at the middle of the path. Scenery stays
      behind the motion (at negative z) or well to the sides, never between the camera and the moving objects.
    - The readout shows the quantities the problem asks for, live, with units.
    - Keep a believable setting (a lab bench, a classroom, a playground...), but nothing in the scenery may touch the
      moving objects or block the view of them.

    MEASUREMENT CODE ('measure_code'): JavaScript that the app runs on a copy of your scene, before the student sees it,
    to measure the asked quantities. It starts at the scene's first instant (time 0) with time running, and has:
      get(label)               the CANNON.Body you registered with addSimulationObject(label, ...)
      runUntil(cond, maxSec)   steps the physics until cond() is true and returns the time in s since the start. If
                               the event never happens within maxSec it stops the measurement with an error, so the
                               problem in the scene gets fixed; never catch that or return a placeholder instead.
      runFor(seconds)          steps the physics for that long; returns the time
      time()                   seconds since the start
      world, CANNON
    It returns an object with one number per quantity to measure, keyed by its id, in that quantity's unit. Measure by
    running the physics and reading the bodies (positions, velocities, angular velocities, times, distances travelled).
    Never compute an answer from a formula or from the given values, and never return a constant or a placeholder such
    as 0. Track extremes in variables updated inside the runUntil condition. It does not see the scene code's
    variables: define again any constants it needs (angles, lengths). Not async: no await. Example (a block
    released on an incline: its speed after 1.5 s, and when it has slid 5 m down the slope, direction 'dir'):
      const block = get('Block');
      const start = block.position.clone();
      const dir = new CANNON.Vec3(Math.cos(th), -Math.sin(th), 0);
      runFor(1.5);
      const speed = block.velocity.length();
      const t = runUntil(() => block.position.vsub(start).dot(dir) >= 5.0, 20);
      return { speed_after_1_5_s: speed, time_to_bottom: t };
`;

const MEASURE_FIELDS = {
  properties: {
    measure_code: { type: Type.STRING, description: "The measurement code: plain JavaScript statements ending in a return of { id: number }." }
  },
  required: ["measure_code"]
};

function sceneBrief(read: ReadProblem): string {
  const measurable = read.asked.filter(a => a.measurable);
  return `TEXTBOOK PROBLEM
"""
${read.statement}
"""

Set-up to simulate:
${read.setup}

Given:
${givensText(read)}

Assumptions:
${bulletList(read.assumptions)}

Quantities to measure in 'measure_code' (id: what, unit; then how):
${measurable.length ? bulletList(measurable.map(a => `${a.id}: ${a.name}, in ${a.unit}. Measure: ${a.how}`)) : '- none (return {} from measure_code)'}`;
}

interface ProblemScene {
  candidate: Candidate;
  measureCode: string;
  measured: Record<string, number>;
  measureError?: string;
}

const measureCodeOf = (candidate: Candidate) => str(candidate.raw?.measure_code, 20000);

// The automatic test of a problem scene: the usual pre-flight check, the problem's own rules, and a measurement
async function testProblemScene(candidate: Candidate, read: ReadProblem): Promise<ProblemScene> {
  candidate.data = { ...candidate.data, textbookPhysics: true };
  const check = await checkSimulation(candidate.data);
  // A problem may be about something at rest (does the block slide?), so standing still is no fault here
  check.issues = check.issues.filter(issue => !issue.startsWith('Nothing moves'));

  const measureCode = measureCodeOf(candidate);
  let measured: Record<string, number> = {};
  let measureError: string | undefined;
  if (check.ok) {
    if (!read.airResistance) {
      const damped = findDamped(candidate.data);
      if (damped.length) check.issues.push(`${damped.slice(0, 3).map(l => `'${l}'`).join(', ')} ${damped.length === 1 ? 'has' : 'have'} damping (air drag). The problem has no air resistance: give every moving body linearDamping: 0 and angularDamping: 0.`);
    }
    const ids = read.asked.filter(a => a.measurable).map(a => a.id);
    if (ids.length) {
      const result = measureScene(candidate.data, measureCode);
      measured = result.values;
      const missing = ids.filter(id => !(id in measured));
      if (result.error) measureError = result.error;
      else if (missing.length) measureError = `The measurement code returned no number for ${missing.join(', ')} (a runUntil that never became true returns null: the event did not happen in the simulation, or the condition is wrong).`;
      if (measureError) check.issues.push(measureError);
    }
  }
  candidate.check = check;
  return { candidate, measureCode, measured, measureError };
}

// Labels of moving bodies with any air drag, read from a fresh build of the scene
function findDamped(data: SimulationData): string[] {
  try {
    const labels: string[] = [];
    const h = buildHeadless(data);
    h.objects.forEach(o => { if (o.body.mass > 0 && (o.body.linearDamping > 1e-6 || o.body.angularDamping > 1e-6)) labels.push(o.label); });
    h.dispose();
    return labels;
  } catch {
    return [];
  }
}

const sceneScore = (scene: ProblemScene) => (scene.candidate.check!.ok ? scene.candidate.check!.issues.length : 1000);

async function buildProblemScene(read: ReadProblem, ctx: SceneContext, options: GenerationOptions): Promise<ProblemScene> {
  let best = await testProblemScene(await requestScene(ctx, options, 'solving'), read);
  for (let attempt = 0; attempt < MAX_REPAIRS && sceneScore(best) > 0; attempt++) {
    options.onStage?.('repairing');
    try {
      const repaired = await testProblemScene(await requestScene(ctx, options, 'repairing', {
        kind: 'repair', code: best.candidate.data.code, problems: problemsOf(best.candidate.check!),
        extra: `Your previous measurement code:\n\`\`\`javascript\n${best.measureCode}\n\`\`\``
      }), read);
      if (sceneScore(repaired) < sceneScore(best)) best = repaired;
    } catch (e) {
      if (!best.candidate.check!.ok) throw e;
      console.warn('[Problem] Repair request failed; keeping the best scene so far:', e);
      break;
    }
  }
  if (!best.candidate.check!.ok) {
    throw new Error(`The simulation of this problem did not pass its physics check, even after ${MAX_REPAIRS} repair attempts. ${best.candidate.check!.error}. Please try again.`);
  }

  // The model looks at pictures of the scene and fixes what shows (mostly the framing). The improved scene is
  // kept only if it still passes its test and measures every answer. Optional: a failure keeps the scene.
  if (!best.measureError) {
    try {
      options.onStage?.('reviewing');
      const changes = await reviewScene(ctx, options, `A textbook problem: ${read.statement}`, best.candidate);
      if (changes.length) {
        options.onStage?.('improving');
        const improved = await testProblemScene(await requestScene(ctx, options, 'improving', {
          kind: 'improve', code: best.candidate.data.code, problems: changes,
          extra: `Your previous measurement code:\n\`\`\`javascript\n${best.measureCode}\n\`\`\``
        }), read);
        if (improved.candidate.check!.ok && !improved.measureError && sceneScore(improved) <= sceneScore(best)) best = improved;
      }
    } catch (e) {
      console.warn('[Problem] Visual review skipped:', e);
    }
  }
  return best;
}

// --- 3. Verifying, and resolving disagreements ---

function compare(read: ReadProblem, solution: WorkedSolution, scene: ProblemScene): ProblemAnswer[] {
  return read.asked.map(a => {
    const worked = solution.answers[a.id];
    const value = worked ? worked.value : null;
    const measured = scene.measured[a.id];
    const base: ProblemAnswer = {
      id: a.id, name: a.name, symbol: a.symbol, unit: a.unit, value,
      display: worked?.display || (value !== null ? `${value} ${a.unit}` : '—'),
      measurable: a.measurable, tolerance: DEFAULT_TOLERANCE, status: 'unchecked',
      ...(a.how ? { how: a.how } : {}),
      ...(a.reason ? { reason: a.reason } : {})
    };
    if (!a.measurable) return base;
    if (measured === undefined) return { ...base, reason: scene.measureError ? 'The simulation could not measure it.' : base.reason };
    if (value === null) return { ...base, measured };
    return { ...base, measured, status: agrees(value, measured, DEFAULT_TOLERANCE) ? 'verified' : 'mismatch' };
  });
}

const RECONCILE_INSTRUCTION = `
    You are a physics professor settling a disagreement. A worked solution and an independent simulation of the same
    textbook problem disagree on some answers. The simulation was built from the problem's set-up without seeing the
    solution, and its answers were measured by running it (cannon-es rigid bodies, Coulomb friction mu x N, a 1/600 s
    step; air drag only where the code sets damping).
    The engine's contact physics (friction, restitution, applied forces, springs) has been checked against worked
    answers to within 0.5 %, at the step used, so a disagreement comes from the scene's set-up, the measurement code
    or the solution, not from solver stiffness, iterations or numerical error.
    Recompute the disputed answers yourself, independently, first. Then find what is wrong:
    - in the solution: the principle used, the free-body diagram, signs, components, algebra, arithmetic, units;
    - in the simulation: whether the scene matches the problem (masses, sizes, angles, starting positions and
      velocities, objects floating above or sunk into surfaces, centres not level in a head-on collision, friction and
      restitution of each contact pair, g, damping), and whether the measurement code measures
      exactly the asked quantity (the right body and event, distance along the right direction, the right moment).
    verdict 'solution': the solution is wrong; return the corrected 'steps', 'answers' (every asked id) and 'summary'.
    verdict 'simulation': the scene or its measurement is wrong; list in 'scene_fixes' exactly what to change in the
      scene code or the measurement code, with numbers.
    verdict 'both': both.
    'diagnosis' is shown to the student: one or two plain sentences on what was wrong and how it was found.
`;

const RECONCILE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING, enum: ["solution", "simulation", "both"] },
    diagnosis: { type: Type.STRING },
    scene_fixes: { type: Type.ARRAY, items: { type: Type.STRING } },
    steps: STEPS_PROPERTY,
    answers: ANSWERS_PROPERTY,
    summary: { type: Type.STRING }
  },
  required: ["verdict", "diagnosis"],
  propertyOrdering: ["verdict", "diagnosis", "scene_fixes", "steps", "answers", "summary"]
};

const formatNumber = (n: number) => (Math.abs(n) >= 1000 || Math.abs(n) < 0.01 ? n.toPrecision(4) : String(Number(n.toPrecision(4))));

async function reconcile(read: ReadProblem, solution: WorkedSolution, scene: ProblemScene, answers: ProblemAnswer[], ctx: SceneContext, options: GenerationOptions) {
  const disputed = answers.filter(a => a.status === 'mismatch')
    .map(a => `${a.id} (${a.name}): solution ${a.display} = ${a.value} ${a.unit}; simulation measured ${formatNumber(a.measured!)} ${a.unit}`);
  const solutionText = solution.steps.map((s, i) => `${i + 1}. ${s.title}\n${s.text}${s.equation ? `\n$$${s.equation}$$` : ''}`).join('\n\n');
  const raw = await withModelFallback(async (model, ai) => {
    const response = await generateThinking(ai, {
      model,
      contents: [{ parts: [{ text:
`Problem:
"""
${read.statement}
"""
Given:
${givensText(read)}
Assumptions:
${bulletList(read.assumptions)}
Asked (ids):
${askedText(read)}

WORKED SOLUTION:
${solutionText}
Answers: ${Object.entries(solution.answers).map(([id, a]) => `${id} = ${a.display}`).join('; ')}

SIMULATION plan:
${scene.candidate.plan}

Scene code:
\`\`\`javascript
${scene.candidate.data.code}
\`\`\`

Measurement code:
\`\`\`javascript
${scene.measureCode}
\`\`\`

They disagree on:
${bulletList(disputed)}` }] }],
      config: { systemInstruction: RECONCILE_INSTRUCTION, responseMimeType: "application/json", responseSchema: RECONCILE_SCHEMA, httpOptions: { timeout: ctx.timeout } }
    }, ThinkingLevel.HIGH);
    if (!response.text) throw new Error("No response text");
    return JSON.parse(response.text);
  }, (model) => options.onStage?.('reconciling', model), ctx.chain);

  const verdict: 'solution' | 'simulation' | 'both' = ['solution', 'simulation', 'both'].includes(raw?.verdict) ? raw.verdict : 'both';
  const corrected = verdict !== 'simulation' ? parseSolution(raw) : null;
  return {
    verdict,
    diagnosis: str(raw?.diagnosis, 600),
    solution: corrected && read.asked.every(a => a.id in corrected.answers) ? corrected : null,
    fixes: verdict !== 'solution' ? strings(raw?.scene_fixes, 600) : []
  };
}

function verdictOf(answers: ProblemAnswer[]): ProblemSolution['verdict'] {
  if (answers.some(a => a.status === 'mismatch')) return 'mismatch';
  const verified = answers.filter(a => a.status === 'verified').length;
  if (verified === answers.length) return 'verified';
  return verified > 0 ? 'partial' : 'unchecked';
}

// --- The whole pipeline ---

export async function solveAndSimulate(input: ProblemInput, options: GenerationOptions = {}): Promise<SimulationData> {
  if (!(await loadKeyCount())) {
    throw new Error("Solving problems is not set up on this server yet. Open one of the built-in demos instead.");
  }
  input = { ...input, text: input.text.trim().slice(0, MAX_PROBLEM_LENGTH) };
  if (!input.text && !input.image) throw new Error('Type a problem or add a photo of one first.');

  const ctx: SceneContext = {
    source: { kind: 'problem', brief: '' },
    chain: options.quality ? QUALITY_CHAIN : MODEL_CHAIN,
    timeout: options.quality ? QUALITY_TIMEOUT_MS : SCENE_TIMEOUT_MS,
    facts: '', examples: '', feedback: feedbackNote(),
    extraInstruction: PROBLEM_SCENE_NOTE,
    extraFields: MEASURE_FIELDS
  };

  options.onStage?.('reading');
  const read = await readProblem(input, ctx, options);
  ctx.source = { kind: 'problem', brief: sceneBrief(read) };

  options.onStage?.('solving');
  let [solution, scene] = await Promise.all([
    solveProblem(input, read, ctx, options),
    buildProblemScene(read, ctx, options)
  ]);

  options.onStage?.('verifying');
  let answers = compare(read, solution, scene);
  let note: string | undefined;
  let blamed: 'solution' | 'simulation' | 'both' | undefined;
  for (let round = 0; round < MAX_RECONCILES && answers.some(a => a.status === 'mismatch'); round++) {
    options.onStage?.('reconciling');
    try {
      const outcome = await reconcile(read, solution, scene, answers, ctx, options);
      note = outcome.diagnosis || note;
      blamed = outcome.verdict;
      if (outcome.solution) solution = outcome.solution;
      if (outcome.fixes.length) {
        options.onStage?.('repairing');
        const fixed = await testProblemScene(await requestScene(ctx, options, 'repairing', {
          kind: 'repair', code: scene.candidate.data.code, problems: outcome.fixes,
          extra: `Your previous measurement code:\n\`\`\`javascript\n${scene.measureCode}\n\`\`\``
        }), read);
        // The fixed scene is used only if it still runs and its measurement works
        if (fixed.candidate.check!.ok && !fixed.measureError) scene = fixed;
      }
    } catch (e) {
      console.warn('[Problem] Resolving the disagreement failed:', e);
      break;
    }
    options.onStage?.('verifying');
    answers = compare(read, solution, scene);
  }
  // When the review found the simulation at fault and it could not be put right, it has checked nothing:
  // those answers are shown as not checked, not as contradicted
  if (blamed === 'simulation') {
    answers = answers.map(a => a.status === 'mismatch'
      ? { ...a, status: 'unchecked', measured: undefined, reason: 'The simulation of this part did not come out right, so it could not check this answer.' }
      : a);
  }

  options.onStage?.('building');
  const problem: ProblemSolution = {
    statement: read.statement,
    topic: read.topic,
    givens: read.givens,
    assumptions: read.assumptions,
    steps: solution.steps,
    answers,
    summary: solution.summary,
    measureCode: scene.measureCode,
    verdict: verdictOf(answers),
    ...(note ? { note } : {})
  };
  return {
    ...scene.candidate.data,
    title: read.title,
    request: read.statement.slice(0, 600),
    textbookPhysics: true,
    problem
  };
}

// --- Problems that come back from a link, a file or the library ---

export function parseProblem(raw: any): ProblemSolution | undefined {
  if (!raw || typeof raw !== 'object' || !str(raw.statement)) return undefined;
  const statuses = ['verified', 'mismatch', 'unchecked'];
  const verdicts = ['verified', 'partial', 'mismatch', 'unchecked'];
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const answers: ProblemAnswer[] = (Array.isArray(raw.answers) ? raw.answers : []).slice(0, 12).map((a: any) => ({
    id: snake(a?.id), name: str(a?.name, 120), symbol: str(a?.symbol, 30), unit: str(a?.unit, 30),
    value: num(a?.value) ?? null, display: str(a?.display, 80), measurable: a?.measurable === true,
    ...(str(a?.how) ? { how: str(a.how, 400) } : {}),
    ...(str(a?.reason) ? { reason: str(a.reason, 300) } : {}),
    tolerance: num(a?.tolerance) ?? DEFAULT_TOLERANCE,
    ...(num(a?.measured) !== undefined ? { measured: num(a.measured) } : {}),
    status: statuses.includes(a?.status) ? a.status : 'unchecked'
  })).filter((a: ProblemAnswer) => a.id);
  return {
    statement: str(raw.statement),
    topic: str(raw.topic, 100),
    givens: (Array.isArray(raw.givens) ? raw.givens : []).slice(0, 30)
      .map((g: any) => ({ symbol: str(g?.symbol, 30), name: str(g?.name, 120), value: str(g?.value, 60) })),
    assumptions: strings(raw.assumptions).slice(0, 12),
    steps: (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 40)
      .map((s: any) => ({ title: str(s?.title, 160), text: str(s?.text, 2000), ...(str(s?.equation) ? { equation: str(s.equation, 1000) } : {}) })),
    answers,
    summary: str(raw.summary, 1000),
    measureCode: str(raw.measureCode, 20000),
    verdict: verdicts.includes(raw.verdict) ? raw.verdict : 'unchecked',
    ...(str(raw.note) ? { note: str(raw.note, 600) } : {})
  };
}
