// Timeline: a recording of the physics state that can be scrubbed, stepped and replayed.
// Every moving body's pose and velocity is stored a fixed number of times per simulated second.
// Replaying shows exactly what was recorded (no re-simulation), so a replay never differs from the
// original run. Kept free of React and rendering so it can be tested on its own.
import * as CANNON from 'cannon-es';
import type { ImpactInfo } from './audio';

const STRIDE = 14;                 // position 3, quaternion 4, velocity 3, angular velocity 3, sleep state 1
const MAX_FLOATS = 6_000_000;      // About 24 MB; the oldest part of the recording is dropped beyond this
const MAX_EVENTS = 20_000;

// A collision that made a sound, so a replay can sound the same as the original run
export interface TimelineEvent {
  t: number;
  info: ImpactInfo;
  speed: number;
  mass: number;
}

interface Frame {
  t: number;               // Seconds since the scene started
  worldTime: number;       // The physics engine's own clock at that moment
  bodies: CANNON.Body[];   // Which bodies 'data' describes (shared between frames while the set is unchanged)
  data: Float32Array;
}

export class Timeline {
  frames: Frame[] = [];
  events: TimelineEvent[] = [];
  cursor = -1;      // Index of the frame the world currently shows
  playTime = 0;     // Scene time the world currently shows (can lie between two frames)
  private floats = 0;
  private tracked: CANNON.Body[] = [];

  get last() { return this.frames.length - 1; }
  get isEmpty() { return this.frames.length === 0; }
  // True when the world shows the newest recorded moment, i.e. the simulation is "live"
  get atEnd() { return this.cursor >= this.last; }
  get startTime() { return this.frames.length ? this.frames[0].t : 0; }
  get endTime() { return this.frames.length ? this.frames[this.last].t : 0; }

  clear() {
    this.frames = [];
    this.events = [];
    this.cursor = -1;
    this.playTime = 0;
    this.floats = 0;
    this.tracked = [];
  }

  // The bodies worth recording: everything that can move. The same array is reused until the set changes.
  private track(world: CANNON.World): CANNON.Body[] {
    const bodies = world.bodies;
    let n = 0, same = true;
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i].type === CANNON.Body.STATIC) continue;
      if (same && this.tracked[n] !== bodies[i]) same = false;
      n++;
    }
    if (same && n === this.tracked.length) return this.tracked;
    this.tracked = bodies.filter(b => b.type !== CANNON.Body.STATIC);
    return this.tracked;
  }

  private static write(bodies: CANNON.Body[], data: Float32Array) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], o = i * STRIDE;
      data[o] = b.position.x; data[o + 1] = b.position.y; data[o + 2] = b.position.z;
      data[o + 3] = b.quaternion.x; data[o + 4] = b.quaternion.y; data[o + 5] = b.quaternion.z; data[o + 6] = b.quaternion.w;
      data[o + 7] = b.velocity.x; data[o + 8] = b.velocity.y; data[o + 9] = b.velocity.z;
      data[o + 10] = b.angularVelocity.x; data[o + 11] = b.angularVelocity.y; data[o + 12] = b.angularVelocity.z;
      data[o + 13] = b.sleepState;
    }
  }

  // Appends the world's current state. Only meaningful while live (atEnd).
  record(world: CANNON.World, t: number) {
    const bodies = this.track(world);
    const data = new Float32Array(bodies.length * STRIDE);
    Timeline.write(bodies, data);
    this.frames.push({ t, worldTime: world.time, bodies, data });
    this.floats += data.length;
    this.cursor = this.last;
    this.playTime = t;

    if (this.floats > MAX_FLOATS && this.frames.length > 120) {
      // Out of room: forget the oldest tenth
      const drop = Math.floor(this.frames.length / 10);
      for (let i = 0; i < drop; i++) this.floats -= this.frames[i].data.length;
      this.frames.splice(0, drop);
      this.cursor -= drop;
      const from = this.frames[0].t;
      this.events = this.events.filter(e => e.t >= from);
    }
  }

  addEvent(event: TimelineEvent) {
    if (this.events.length >= MAX_EVENTS) this.events.splice(0, MAX_EVENTS / 10);
    this.events.push(event);
  }

  // Events with a < t <= b, in order
  eventsBetween(a: number, b: number): TimelineEvent[] {
    if (b <= a || !this.events.length) return [];
    const out: TimelineEvent[] = [];
    for (let i = this.lowerBound(a); i < this.events.length && this.events[i].t <= b; i++) out.push(this.events[i]);
    return out;
  }

  // Index of the first event with t > a
  private lowerBound(a: number): number {
    let lo = 0, hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].t <= a) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // Index of the last frame at or before scene time t
  indexAt(t: number): number {
    if (!this.frames.length) return -1;
    let lo = 0, hi = this.last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Puts the world into the state of frame 'index', optionally blended 'alpha' (0..1) of the way
  // toward the next frame so slow playback stays smooth.
  apply(world: CANNON.World, index: number, alpha = 0) {
    if (!this.frames.length) return;
    index = Math.min(Math.max(index, 0), this.last);
    const f = this.frames[index];
    const next = alpha > 0 && index < this.last && this.frames[index + 1].bodies === f.bodies ? this.frames[index + 1] : null;
    const a = next ? Math.min(alpha, 1) : 0;
    const d = f.data, e = next ? next.data : d;

    for (let i = 0; i < f.bodies.length; i++) {
      const b = f.bodies[i];
      if (b.world !== world) continue; // Removed since this frame was recorded
      const o = i * STRIDE;
      if (next) {
        b.position.set(d[o] + (e[o] - d[o]) * a, d[o + 1] + (e[o + 1] - d[o + 1]) * a, d[o + 2] + (e[o + 2] - d[o + 2]) * a);
        // Shortest-path blend of the two orientations
        let qx = e[o + 3], qy = e[o + 4], qz = e[o + 5], qw = e[o + 6];
        if (d[o + 3] * qx + d[o + 4] * qy + d[o + 5] * qz + d[o + 6] * qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
        b.quaternion.set(d[o + 3] + (qx - d[o + 3]) * a, d[o + 4] + (qy - d[o + 4]) * a, d[o + 5] + (qz - d[o + 5]) * a, d[o + 6] + (qw - d[o + 6]) * a);
        b.quaternion.normalize();
      } else {
        b.position.set(d[o], d[o + 1], d[o + 2]);
        b.quaternion.set(d[o + 3], d[o + 4], d[o + 5], d[o + 6]);
      }
      b.velocity.set(d[o + 7], d[o + 8], d[o + 9]);
      b.angularVelocity.set(d[o + 10], d[o + 11], d[o + 12]);
      b.sleepState = d[o + 13] as any;
      b.previousPosition.copy(b.position);
      b.interpolatedPosition.copy(b.position);
      b.previousQuaternion.copy(b.quaternion);
      b.interpolatedQuaternion.copy(b.quaternion);
      b.force.set(0, 0, 0);
      b.torque.set(0, 0, 0);
      b.aabbNeedsUpdate = true;
    }

    world.time = next ? f.worldTime + (next.worldTime - f.worldTime) * a : f.worldTime;
    this.cursor = index;
    this.playTime = next ? f.t + (next.t - f.t) * a : f.t;
  }

  // Shows scene time t (clamped to what is recorded)
  seek(world: CANNON.World, t: number) {
    if (!this.frames.length) return;
    const clamped = Math.min(Math.max(t, this.startTime), this.endTime);
    const i = this.indexAt(clamped);
    const span = i < this.last ? this.frames[i + 1].t - this.frames[i].t : 0;
    this.apply(world, i, span > 0 ? (clamped - this.frames[i].t) / span : 0);
  }

  // Forgets everything after the moment currently shown. Used when the user changes something in the
  // past: from there on, history is rewritten.
  truncate() {
    if (this.cursor < 0 || this.cursor >= this.last) return;
    this.frames.length = this.cursor + 1;
    this.floats = 0;
    for (const f of this.frames) this.floats += f.data.length;
    this.events = this.events.filter(e => e.t <= this.playTime);
  }

  // Replaces the newest frame with the world's current state (after an edit made while paused)
  rewriteLast(world: CANNON.World) {
    if (!this.frames.length) return;
    const f = this.frames[this.last];
    const bodies = this.track(world);
    if (bodies !== f.bodies || f.data.length !== bodies.length * STRIDE) {
      this.floats -= f.data.length;
      f.bodies = bodies;
      f.data = new Float32Array(bodies.length * STRIDE);
      this.floats += f.data.length;
    }
    Timeline.write(bodies, f.data);
    const previous = this.last > 0 ? this.frames[this.last - 1].t : -Infinity;
    f.t = Math.max(this.playTime, previous);
    f.worldTime = world.time;
    this.cursor = this.last;
    this.playTime = f.t;
  }
}
