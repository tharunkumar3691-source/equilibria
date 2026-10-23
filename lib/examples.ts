// Worked examples for the AI: before a scene is generated, the closest scene the user liked and the
// closest built-in demo are found by keyword and shown to the model, so it starts from something that
// already works instead of from nothing.
import { listLiked, LikedScene } from './feedback';
import { DEMOS, DemoScenario } from './demos';

// What each built-in demo shows, in the words people use to ask for it
const DEMO_KEYWORDS: Record<string, string[]> = {
  'domino-spiral': ['domino', 'dominoes', 'dominos', 'topple', 'chain', 'reaction', 'fall', 'falling'],
  'newtons-cradle': ['newton', 'cradle', 'momentum', 'collision', 'elastic', 'balls', 'steel', 'pendulum', 'pendulums', 'transfer'],
  'bowling-strike': ['bowling', 'pins', 'pin', 'lane', 'strike', 'roll', 'rolling', 'ball'],
  'tree-height': ['tree', 'height', 'shadow', 'trigonometry', 'tangent', 'tan', 'angle', 'elevation', 'similar', 'triangle', 'triangles', 'clinometer', 'thales'],
  'black-hole': ['black', 'hole', 'horizon', 'singularity', 'accretion', 'quasar', 'neutron', 'pulsar', 'spaghettification', 'lensing', 'einstein', 'relativity', 'schwarzschild', 'swallow', 'swallowed'],
  'solar-system': ['orbit', 'orbits', 'orbiting', 'planet', 'planets', 'sun', 'moon', 'earth', 'space', 'satellite', 'gravity', 'solar'],
  'pendulum-wave': ['pendulum', 'pendulums', 'wave', 'oscillation', 'oscillate', 'period', 'swing', 'harmonic'],
  'loop-the-loop': ['loop', 'track', 'roller', 'coaster', 'ramp', 'slope', 'incline', 'rolling', 'roll', 'marble', 'circular', 'centripetal'],
  'block-tower': ['jenga', 'tower', 'stack', 'stacked', 'blocks', 'block', 'balance', 'collapse', 'pile'],
  'seesaw': ['seesaw', 'see-saw', 'teeter', 'lever', 'torque', 'balance', 'pivot', 'fulcrum', 'playground'],
  'crate-push': ['push', 'pushing', 'pushes', 'friction', 'crate', 'box', 'slide', 'sliding', 'drag', 'static', 'kinetic', 'warehouse']
};

const STOP = new Set(['the', 'and', 'with', 'from', 'into', 'onto', 'that', 'this', 'then', 'there', 'their', 'them', 'they', 'what', 'when', 'which',
  'while', 'about', 'over', 'under', 'some', 'very', 'just', 'like', 'each', 'other', 'scene', 'video', 'shows', 'showing', 'person', 'object', 'objects']);

export const words = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(w => !STOP.has(w)).map(w => w.replace(/'s$/, '')));

// Plural and singular forms count as the same word
const same = (a: string, b: string) => a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;
const overlap = (query: Set<string>, keys: Iterable<string>) => {
  let score = 0;
  for (const k of keys) for (const q of query) if (same(q, k)) { score++; break; }
  return score;
};

export interface ExamplePicks {
  liked: LikedScene | null;
  demo: DemoScenario | null;
}

const MAX_EXAMPLE_CODE = 16000;

export async function pickExamples(request: string): Promise<ExamplePicks> {
  const query = words(request);
  if (!query.size) return { liked: null, demo: null };

  // The closest scene the user liked: it already follows every rule, so it is the better example
  let liked: LikedScene | null = null, likedScore = 1;
  for (const entry of listLiked()) {
    const score = overlap(query, words(`${entry.title} ${entry.request}`));
    if (score > likedScore) { liked = entry; likedScore = score; }
  }

  let demo: DemoScenario | null = null, demoScore = 0;
  for (const d of DEMOS) {
    const keys = DEMO_KEYWORDS[d.id];
    if (!keys || d.data.code.length > MAX_EXAMPLE_CODE) continue;
    const score = overlap(query, keys) + overlap(query, words(d.title)) * 0.5;
    if (score > demoScore) { demo = d; demoScore = score; }
  }
  return { liked, demo: demoScore >= 1 ? demo : null };
}

// The examples as text for the request, or '' when there are none
export function examplesText(picks: ExamplePicks): string {
  const parts: string[] = [];
  if (picks.liked) {
    parts.push(`EXAMPLE THE USER LIKED (a similar request: "${picks.liked.request.slice(0, 300)}"). It follows every rule and is the quality the user wants. Match its realism, structure and readout; build what THIS request asks for, not a copy:
\`\`\`javascript
${picks.liked.data.code.trim()}
\`\`\``);
  }
  if (picks.demo) {
    parts.push(`PHYSICS REFERENCE: the app's built-in "${picks.demo.title}" demo (${picks.demo.tagline}), a working scene with a similar mechanism. Reuse what makes its physics work (constraints, dimensions, masses, timing, the readout's quantities). Do NOT copy its look: it predates the realism kit and builds its own floor and plain materials, while your scene must use addGround, realMaterial and everything else the rules require:
\`\`\`javascript
${picks.demo.data.code.trim()}
\`\`\``);
  }
  return parts.join('\n\n');
}
