
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
}

// A simulation the user saved in this browser
export interface LibraryEntry {
  id: string;
  name: string;
  savedAt: number;
  data: SimulationData;
}
