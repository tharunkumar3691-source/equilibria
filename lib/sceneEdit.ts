// Editing a simulation by conversation: "add a second ball", "remove the ramp", "make it bouncier".
// The assistant either answers in words or rewrites the scene through the update_simulation tool. A rewrite is
// never shown untested: it is built and run headlessly first (lib/validate.ts), and if it fails the problems
// are handed back to the model to fix (up to MAX_REPAIRS times). A rewrite that still fails is not applied,
// so the scene the user had stays exactly as it was.
import { GoogleGenAI, Chat, Type, FunctionDeclaration, ThinkingLevel } from '@google/genai';
import { SimulationData } from '../types';
import { withModelFallback, normalizeSimulation, REQUEST_TIMEOUT_MS, SCENE_KIT_GUIDE } from './gemini';
import { checkSimulation, problemsOf } from './validate';
import { PAYMENT_INSTRUCTION, PAYMENT_TOOL_NAMES, PAYMENT_TOOLS, runPaymentTool } from './paymentAgent';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export type EditStage = 'thinking' | 'testing' | 'repairing';

export type EditOutcome =
  | { kind: 'reply'; text: string }
  | { kind: 'edit'; data: SimulationData; summary: string; repairs: number }
  | { kind: 'failed'; text: string };

const MAX_REPAIRS = 2;
const CHANGES_HEADING = 'Changes made in the chat:';

const UPDATE_TOOL: FunctionDeclaration = {
  name: 'update_simulation',
  description: "Rewrites the 3D physics simulation to make the change the user asked for. Call it only when the user wants the scene changed; answer questions in plain text instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING, description: "One short sentence for the user saying what changed, e.g. 'Added a second steel ball next to the first'." },
      edits: {
        type: Type.ARRAY,
        description: "PREFERRED: exact find-and-replace edits on the current code, applied in order. Each 'find' is copied character for character from the current code and occurs there exactly once (include a neighbouring line if needed to make it unique). To add new code, 'find' a line next to where it goes and 'replace' it with that line plus the new code. To remove code, 'replace' it with an empty string.",
        items: {
          type: Type.OBJECT,
          properties: { find: { type: Type.STRING }, replace: { type: Type.STRING } },
          required: ['find', 'replace']
        }
      },
      code: { type: Type.STRING, description: "ONLY for changes that rewrite most of the scene: the COMPLETE new scene code. Leave it out when you give 'edits'." },
      sliders: {
        type: Type.ARRAY,
        description: "The complete slider list after the change. Leave it out to keep the current sliders unchanged.",
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            targetLabel: { type: Type.STRING, description: "The label used in addSimulationObject (a prefix such as 'ball' also drives 'ball_1', 'ball_2'...), or 'world'." },
            property: { type: Type.STRING, enum: ['mass', 'friction', 'restitution', 'gravity', 'damping'] },
            min: { type: Type.NUMBER },
            max: { type: Type.NUMBER },
            value: { type: Type.NUMBER },
            step: { type: Type.NUMBER }
          },
          required: ['label', 'targetLabel', 'property', 'min', 'max', 'value']
        }
      },
      startMode: { type: Type.STRING, enum: ['click', 'auto'], description: "Omit to keep the current start mode." },
      startHint: { type: Type.STRING, description: "Short prompt such as 'Click anywhere to roll the ball' (startMode 'click' only)." }
    },
    required: ['summary']
  }
};

// The scene's code after the model's find-and-replace edits, or the problems that stopped them applying
function applyEdits(code: string, edits: any[]): { code: string } | { problems: string[] } {
  let result = code;
  const problems: string[] = [];
  edits.forEach((edit, i) => {
    const find = edit && typeof edit.find === 'string' ? edit.find : '';
    const replace = edit && typeof edit.replace === 'string' ? edit.replace : '';
    if (!find) { problems.push(`Edit ${i + 1} has an empty 'find'.`); return; }
    const first = result.indexOf(find);
    if (first < 0) {
      problems.push(`Edit ${i + 1}: its 'find' text does not occur in the current code. Copy it exactly from the code, including spaces and line breaks: ${JSON.stringify(find.slice(0, 120))}`);
      return;
    }
    if (result.indexOf(find, first + 1) >= 0) {
      problems.push(`Edit ${i + 1}: its 'find' text occurs more than once. Include a neighbouring line so it is unique: ${JSON.stringify(find.slice(0, 120))}`);
      return;
    }
    result = result.slice(0, first) + replace + result.slice(first + find.length);
  });
  return problems.length ? { problems } : { code: result };
}

const SYSTEM_INSTRUCTION = `
You are the editor inside Equilibria, an app of interactive 3D physics simulations built with Three.js and cannon-es.
The user is looking at a running simulation and talks to you about it. Two kinds of turn:
- A question ("why does the ball slow down?", "what is the period?"): answer in plain, friendly words, with the physics
  and numbers that matter. Do not call the tool.
- A change ("add a second ball", "remove the ramp", "make the floor ice", "make it heavier", "add a wall at the end"):
  call update_simulation with the COMPLETE new scene code.

HOW TO EDIT (the most important rules):
- Start from the current code you are given and change ONLY what the user asked for. Keep every other line as it is:
  the same objects, labels, positions, materials, camera, lighting, ground, readout, sliders and start mode.
- Adding something: build it like the real thing (several parts, realMaterial, true size and mass), register anything
  that moves or can be touched with addSimulationObject(label, mesh, body, { sound }), give it a new unique label, and
  place it so it does not overlap anything (rest it on its support: centre y = support top + half its height + 0.001).
  Keep it in the camera's view; move the camera or lookAt only if the new thing would otherwise be out of the shot.
- Removing something: remove its mesh, its body, its ropes and constraints, its contact materials, every frame or click
  callback that uses it, the readout rows about it and the sliders that target it. Nothing may refer to it afterwards.
- Changing a property (heavier, faster, bouncier, slipperier, bigger, another colour or material): change it in the
  code at its source (mass, velocity, ContactMaterial restitution or friction, geometry and shape sizes together,
  realMaterial name or colour). If there is a slider for it, set the slider's value to match.
- "Like the Moon / Mars / Jupiter": set world.gravity to the real value (1.62, 3.71, 24.79 m/s²) and update any gravity
  slider and readout.
- Never make changes nobody asked for. Do not restyle, re-floor, re-light, re-colour or "improve" what already exists:
  if the scene builds its own floor, do not add addGround; if it uses plain materials, keep them. The realism kit
  below is only for NEW things you add, and they should match the style of what is already there.
- Your summary must list every change you made, and you must make no change your summary does not mention.
- HOW TO SEND THE CHANGE: prefer 'edits', a short list of exact find-and-replace pairs on the current code (fast, and
  it cannot disturb anything else). Copy each 'find' character for character from the current code; it must occur
  exactly once. Send the complete program in 'code' only when the change rewrites most of the scene. Leave 'sliders'
  out unless they change (then give the complete new list).
- Keep any { main: true } flag on the object the user launches, and keep the readout working and truthful.
- Never add a speed or time-scale slider: the app has its own Speed control.

THE CODE ENVIRONMENT:
'THREE', 'CANNON', 'scene', 'world' and 'camera' are given; do not import or redeclare them.
- addSimulationObject(label, mesh, body, { sound, main }): registers an object. 'sound' is what it is made of:
  'metal', 'wood', 'stone', 'glass', 'rubber', 'plastic', 'soft' or 'generic'.
- addFrameCallback(fn): runs every frame. addClickCallback(fn): fn(label) runs when an object is clicked; return true
  to keep the inspector closed.
- getSimulationObject(label): returns { mesh, body } for an existing object.
- addRope([x, y, z], body): hangs a body from a fixed point at its current distance and draws the rope. Use it for every
  rope, chain or pendulum. Never use CANNON.PointToPointConstraint as a rope in new code.
- setAmbience(kind): 'space', 'wind' or 'none'.
${SCENE_KIT_GUIDE}
FORBIDDEN: world.getBody(), world.getMesh(), timers or your own start-on-click logic (the app starts 'click' scenes).

START MODE: "click" freezes the scene until the user clicks (one-off events: a release, throw, launch, drop);
"auto" runs at once (continuous motion). Keep the current mode unless the user asks or the change requires it.

If the app tells you your change was rejected (an edit did not match the code, or the result failed its automatic
test), call update_simulation again. Your rejected change was NOT applied, so write your edits against the original
current code again. Fix exactly the problems listed and keep the change the user asked for.
${PAYMENT_INSTRUCTION}`;
// Payment tool rounds in one turn (check the balance, then buy), so a confused model cannot loop
const MAX_PAYMENT_ROUNDS = 4;

// The scene's explanation, with this change added to a running list of what was changed in the chat
function withChangeNote(explanation: string, summary: string): string {
  const text = (explanation || '').trimEnd();
  const line = `- ${summary.trim().replace(/\.$/, '')}.`;
  return text.includes(CHANGES_HEADING) ? `${text}\n${line}` : `${text}\n\n${CHANGES_HEADING}\n${line}`;
}

// One conversational turn. 'history' is the earlier conversation (plain text, user turn first).
export async function chatTurn(scene: SimulationData | null, history: ChatTurn[], message: string, onStage: (stage: EditStage) => void): Promise<EditOutcome> {
  // A conversation must start with the user's turn and alternate
  const turns: ChatTurn[] = [];
  history.forEach(t => {
    if (!turns.length && t.role !== 'user') return;
    if (turns.length && turns[turns.length - 1].role === t.role) turns[turns.length - 1] = { ...t, text: `${turns[turns.length - 1].text}\n${t.text}` };
    else turns.push(t);
  });
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();

  const prompt = scene
    ? `CURRENT SCENE${scene.title ? ` ("${scene.title}")` : ''}:\n\`\`\`javascript\n${scene.code}\n\`\`\`\n\nCurrent sliders: ${JSON.stringify(scene.sliders)}\nCurrent start mode: ${scene.startMode || 'auto'}\n\nThe user says: ${message}`
    : `There is no simulation open yet, so you can only answer questions (suggest a demo, or describing a scene in the Create panel) and help with credits.\n\nThe user says: ${message}`;

  onStage('thinking');
  return withModelFallback(async (model: string, ai: GoogleGenAI): Promise<EditOutcome> => {
    // Medium thinking: plenty for a targeted edit, and much quicker than the default deep thinking
    const makeChat = (thinking: boolean): Chat => ai.chats.create({
      model,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: scene ? [UPDATE_TOOL, ...PAYMENT_TOOLS] : PAYMENT_TOOLS }],
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } } : {})
      },
      history: turns.map(t => ({ role: t.role, parts: [{ text: t.text }] }))
    });

    let chat = makeChat(true);
    let response;
    try {
      response = await chat.sendMessage({ message: prompt });
    } catch (error: any) {
      // Models that do not take a thinking level are asked again without one
      const status = error?.status || error?.code || error?.error?.code;
      if (status !== 400 || !/think/i.test(String(error?.message || ''))) throw error;
      chat = makeChat(false);
      response = await chat.sendMessage({ message: prompt });
    }
    let attempt = 0;
    for (let paymentRounds = 0; ; ) {
      // Payment tools run first; their results go back to the model, which then answers or acts again
      const paymentCalls = (response.functionCalls || []).filter(c => c.name && PAYMENT_TOOL_NAMES.includes(c.name));
      if (paymentCalls.length && paymentRounds < MAX_PAYMENT_ROUNDS) {
        paymentRounds++;
        const parts = [];
        for (const c of paymentCalls) parts.push({ functionResponse: { name: c.name, response: await runPaymentTool(c.name!, c.args || {}) } });
        response = await chat.sendMessage({ message: parts });
        continue;
      }

      const call = response.functionCalls && response.functionCalls.find(c => c.name === 'update_simulation');
      if (!call || !scene) {
        const text = (response.text || '').trim();
        if (!text) throw new Error('The model gave no answer');
        return { kind: 'reply', text };
      }

      const args: any = call.args || {};
      const summary = typeof args.summary === 'string' && args.summary.trim() ? args.summary.trim() : 'Updated the scene';
      let candidate: SimulationData;
      let problems: string[];
      try {
        // The new code: the model's edits applied to the current code, or a complete rewrite
        let code: string | null = typeof args.code === 'string' && args.code.trim() ? args.code : null;
        if (!code) {
          const edits = Array.isArray(args.edits) ? args.edits : [];
          if (!edits.length) throw new Error("The change had neither 'edits' nor 'code'.");
          const applied = applyEdits(scene.code, edits);
          if ('problems' in applied) throw Object.assign(new Error('edits did not apply'), { problems: applied.problems });
          code = applied.code;
        }
        const sliders = Array.isArray(args.sliders) ? args.sliders : scene.sliders;
        candidate = normalizeSimulation({ ...args, code, sliders, title: scene.title }, scene);
        candidate = {
          ...candidate,
          demoMode: scene.demoMode,          // An edited demo keeps the demos' framing and style rules
          environment: scene.environment,    // ...and its real-world setting
          title: scene.title,
          request: scene.request,
          thought_process: withChangeNote(scene.thought_process, summary)
        };
        onStage('testing');
        const check = await checkSimulation(candidate);
        if (check.ok) return { kind: 'edit', data: candidate, summary, repairs: attempt };
        problems = problemsOf(check);
      } catch (e: any) {
        problems = e && Array.isArray(e.problems) ? e.problems : [e && e.message ? e.message : String(e)];
      }

      if (attempt >= MAX_REPAIRS) {
        console.warn('[Edit] The change still failed its test after repairs:', problems);
        return {
          kind: 'failed',
          text: `I tried that change ${attempt + 1} times, but the new scene did not pass its physics test (${problems[0]}). I've kept your scene as it was. Could you describe the change a little differently?`
        };
      }
      // Hand the problems back to the model as the tool's result, and ask for the corrected scene
      attempt++;
      onStage('repairing');
      response = await chat.sendMessage({
        message: [{
          functionResponse: {
            name: 'update_simulation',
            response: {
              status: 'rejected: the code failed the automatic physics test and was NOT applied',
              problems,
              instruction: 'Call update_simulation again with the complete corrected code. Fix exactly these problems and keep the requested change.'
            }
          }
        }]
      });
    }
  });
}
