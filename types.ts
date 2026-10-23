
export interface SimulationSlider {
  label: string;
  targetLabel: string; // The label of the Object, or 'world' for global
  property: 'scale' | 'mass' | 'friction' | 'restitution' | 'gravity' | 'damping';
  min: number;
  max: number;
  value: number;
  step?: number;
}

export interface SimulationData {
  thought_process: string;
  code: string; // The raw JS code to execute
  sliders: SimulationSlider[];
  demoMode?: boolean;
  // 'click': the scene is built but time stays frozen until the user clicks the simulation view.
  //          Use for one-off triggered events (a release, throw, launch or strike).
  // 'auto':  physics runs as soon as the scene loads. Use for continuous motion (orbits, oscillation).
  startMode?: 'click' | 'auto';
  startHint?: string; // Short prompt shown while waiting, e.g. "Click anywhere to roll the ball"
  title?: string;     // Short display name, used by the library and in exported file names
  request?: string;   // What the scene was generated from: the description, or what the video showed
  keepView?: boolean; // Shown after an edit: keep the camera where the user had it (not saved or shared)
  // Where the scene really happens, shown in Realistic mode (see lib/environments.ts). Demos name theirs;
  // generated scenes get one chosen from what they show.
  environment?: { setting: string; realSize?: number; upm?: number; dressOnly?: boolean };
  // Contact physics as textbooks have it (friction mu x N, exact bounces, fine steps): see lib/textbookPhysics.ts.
  // Problem scenes use it.
  textbookPhysics?: boolean;
  // A textbook problem this scene was built from, with its worked solution checked in the simulation
  problem?: ProblemSolution;
}

// --- Textbook problems (lib/problems.ts) ---

export interface ProblemGiven {
  symbol: string;   // e.g. "m"
  name: string;     // e.g. "mass of the block"
  value: string;    // with its unit, e.g. "2.0 kg"
}

export interface SolutionStep {
  title: string;
  text: string;       // Plain text; inline maths between $...$ (LaTeX)
  equation?: string;  // A displayed equation (LaTeX)
}

export interface ProblemAnswer {
  id: string;              // snake_case key, shared by the solution and the measurement
  name: string;            // e.g. "Time to reach the bottom"
  symbol: string;
  unit: string;            // The unit of both 'value' and 'measured'
  value: number | null;    // The solution's answer
  display: string;         // As the solution states it, e.g. "2.02 s"
  measurable: boolean;     // Whether the simulation can measure it
  how?: string;            // What the simulation measures
  reason?: string;         // Why it cannot be measured
  tolerance: number;       // Relative difference still counted as agreeing
  measured?: number;       // What the simulation measured
  status: 'verified' | 'mismatch' | 'unchecked';
}

export interface ProblemSolution {
  statement: string;       // The problem as read (typed or from the photo)
  topic: string;
  givens: ProblemGiven[];
  assumptions: string[];
  steps: SolutionStep[];
  answers: ProblemAnswer[];
  summary: string;
  measureCode: string;     // Runs on a copy of the scene and returns { [answer id]: number }
  verdict: 'verified' | 'partial' | 'mismatch' | 'unchecked';
  note?: string;           // How a disagreement between solution and simulation was resolved
}

// A simulation the user saved in this browser
export interface LibraryEntry {
  id: string;
  name: string;
  savedAt: number;
  data: SimulationData;
}
