// What the simulation view exposes to the panels around it (timeline, inspector, stopwatch, video
// comparison). The panels poll this a few times a second instead of re-rendering the 3D view.
import type { BodyStats } from './objects';

export interface SimClock {
  time: number;       // Scene time currently shown, in simulated seconds
  start: number;      // Earliest time still in the recording
  end: number;        // Latest time recorded
  live: boolean;      // Showing the newest moment (not a replay of the past)
  running: boolean;   // Time is advancing (not paused, not waiting for the start click)
  awaiting: boolean;  // Waiting for the start click
  rate: number;       // Current playback speed (1 = real time), including slow motion
}

export interface SimApi {
  clock(): SimClock;
  seek(time: number): void;
  beginScrub(): void;           // Call when the user grabs the timeline: pauses while they drag
  endScrub(): void;             // ...and carries on afterwards if it was running
  step(direction: 1 | -1): void; // One recorded frame forward or back (pauses first)
  replay(): void;               // Back to the start of the recording, then play
  stats(): BodyStats | null;    // Live figures for the selected object
}
