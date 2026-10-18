// Procedural sound and haptics for the physics view.
// Nothing here is a recording: every sound is synthesised from what the physics engine reports
// (impact speed, mass, object size, material), so what you hear follows what actually happened.

export type SoundMaterial = 'metal' | 'wood' | 'stone' | 'glass' | 'rubber' | 'plastic' | 'soft' | 'generic';
export const SOUND_MATERIALS: SoundMaterial[] = ['metal', 'wood', 'stone', 'glass', 'rubber', 'plastic', 'soft', 'generic'];

// 'space' is a vacuum: a faint drone, and no air sounds (no whoosh). 'wind' is an outdoor breeze.
export type Ambience = 'none' | 'space' | 'wind';
export const AMBIENCES: Ambience[] = ['none', 'space', 'wind'];

interface MaterialVoice {
  base: number;      // Ring frequency (Hz) of an object about 1 unit in radius
  ratios: number[];  // Overtones relative to the base; inharmonic sets sound like solid objects
  decay: number;     // Ring time in seconds for a 1-unit object
  noise: number;     // Loudness of the contact "click" relative to the ring
  noiseFreq: number; // Centre frequency of that click
}

const MATERIALS: Record<SoundMaterial, MaterialVoice> = {
  // No metallic clang: metal objects knock with the same short, dull voice as 'generic' (no ring)
  metal:   { base: 420,  ratios: [1, 2.1, 3.4],        decay: 0.1,  noise: 0.6,  noiseFreq: 1800 },
  glass:   { base: 1900, ratios: [1, 2.32, 4.25],      decay: 0.5,  noise: 0.3,  noiseFreq: 6000 },
  wood:    { base: 520,  ratios: [1, 2.57, 4.9],       decay: 0.11, noise: 0.6,  noiseFreq: 2200 },
  stone:   { base: 330,  ratios: [1, 1.78, 2.9],       decay: 0.07, noise: 0.9,  noiseFreq: 1500 },
  plastic: { base: 640,  ratios: [1, 2.2, 3.6],        decay: 0.08, noise: 0.5,  noiseFreq: 3000 },
  rubber:  { base: 150,  ratios: [1, 2.0],             decay: 0.14, noise: 0.35, noiseFreq: 700 },
  soft:    { base: 110,  ratios: [1],                  decay: 0.09, noise: 0.5,  noiseFreq: 400 },
  generic: { base: 420,  ratios: [1, 2.1, 3.4],        decay: 0.1,  noise: 0.6,  noiseFreq: 1800 }
};

const AMBIENCE_AUDIBLE: boolean = false;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function isSoundMaterial(value: any): value is SoundMaterial {
  return typeof value === 'string' && (SOUND_MATERIALS as string[]).includes(value);
}

// Best guess at what an object is made of when the simulation code does not say.
export function inferSoundMaterial(label: string, metalness?: number): SoundMaterial {
  const l = (label || '').toLowerCase();
  if (/glass|bottle|marble|crystal|window/.test(l)) return 'glass';
  if (/rubber|tyre|tire|bouncy|basket|tennis|football|soccer|balloon/.test(l)) return 'rubber';
  if (/pillow|cloth|soft|sponge|foam|cushion/.test(l)) return 'soft';
  if (/plastic|toy|lego|cup|bowling|duck/.test(l)) return 'plastic';
  if (/wood|pin|plank|crate|log|domino|barrel|box|stick|bat/.test(l)) return 'wood';
  if (/brick|stone|rock|concrete|block|wall|boulder|planet|asteroid|moon/.test(l)) return 'stone';
  if (/steel|metal|iron|chain|wreck|cradle|bell|coin|car|hammer|anvil|cannon|pendulum|weight/.test(l)) return 'metal';
  if (typeof metalness === 'number' && metalness > 0.6) return 'metal';
  return 'generic';
}

export interface ImpactInfo {
  a: SoundMaterial;          // The object that hit
  b: SoundMaterial | null;   // What it hit; null for an unregistered surface such as the floor
  speed: number;             // Closing speed along the contact normal, in units/s
  mass: number;              // Effective mass of the collision (the lighter side dominates)
  sizeA: number;             // Bounding radius of each side
  sizeB: number;
}

// How hard an impact is on a 0..1 scale. Shared by sound, haptics and camera shake so they agree.
export function impactStrength(speed: number, mass: number): number {
  const v = clamp(speed / 14, 0, 1.4);
  const massWeight = clamp(0.45 + 0.22 * Math.log10(1 + Math.max(mass, 0)), 0.3, 1.25);
  return clamp(Math.pow(v, 1.1) * massWeight, 0, 1);
}

class SimAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private captureDestination: MediaStreamAudioDestinationNode | null = null;
  private noise: AudioBuffer | null = null;
  private roll: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private whoosh: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private ambienceNodes: { stop: () => void } | null = null;
  private ambience: Ambience = 'none';
  private muted = false;
  private volume = 0.8;
  private hapticsOn = true;
  private voices = 0;              // Impact voices currently sounding
  private recent: number[] = [];   // Start times of recent impacts, for rate limiting
  private lastVibration = 0;
  private unlockInstalled = false;

  // Browsers only allow audio after a user gesture, so listen for the first one anywhere on the page.
  installUnlock() {
    if (this.unlockInstalled || typeof window === 'undefined') return;
    this.unlockInstalled = true;
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      // A limiter keeps a pile-up of simultaneous impacts from clipping
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 12;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(limiter);
      limiter.connect(ctx.destination);

      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.limiter = limiter;
      this.noise = buffer;
      // Only collisions between objects make sound. The continuous noise voices (rolling rumble,
      // air whoosh), the background ambience and the UI tick are deliberately never created, so
      // nothing is heard when a simulation starts until objects actually hit each other.
      return ctx;
    } catch {
      return null;
    }
  }

  private get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  // The simulation's sound as a stream, so a video recording of the view can include it.
  // Returns null where the browser has no audio.
  captureStream(): MediaStream | null {
    const ctx = this.ensure();
    if (!ctx || !this.limiter) return null;
    if (!this.captureDestination) {
      this.captureDestination = ctx.createMediaStreamDestination();
      this.limiter.connect(this.captureDestination);
    }
    return this.captureDestination.stream;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 1);
    if (this.ctx && this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  setHaptics(on: boolean) {
    this.hapticsOn = on;
  }

  // Short UI tick for buttons
  click() {
    // Silent on purpose: only object collisions make sound
  }

  // One collision: a contact click, each object ringing at a pitch set by its size and material,
  // and a low thump when something heavy is involved. Returns the 0..1 strength it used.
  impact(info: ImpactInfo): number {
    const strength = impactStrength(info.speed, info.mass);
    if (strength < 0.03 || !this.ready) return strength;
    const ctx = this.ctx!, now = ctx.currentTime;

    // Rate limit: a collapsing wall makes hundreds of contacts; keep the loudest few per moment
    this.recent = this.recent.filter(t => now - t < 0.1);
    if (this.recent.length >= 8 || (this.voices >= 14 && strength < 0.5)) return strength;
    this.recent.push(now);

    const amp = 0.5 * Math.pow(strength, 1.3);
    const sides: { material: SoundMaterial; size: number; level: number }[] = [{ material: info.a, size: info.sizeA, level: 1 }];
    if (info.b) sides.push({ material: info.b, size: info.sizeB, level: 0.6 });

    let longest = 0.05;
    sides.forEach(side => {
      const m = MATERIALS[side.material];
      const size = clamp(side.size || 1, 0.15, 12);
      const f0 = clamp(m.base / Math.sqrt(size), 55, 6000) * (0.94 + Math.random() * 0.12);
      const decay = m.decay * (0.6 + 0.4 * Math.sqrt(size)) * (0.7 + 0.6 * strength);
      longest = Math.max(longest, decay);
      m.ratios.forEach((ratio, i) => {
        const freq = f0 * ratio;
        if (freq > 12000) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const level = (amp * side.level) / (1 + i * 1.4) / Math.sqrt(m.ratios.length);
        const ring = decay / (1 + i * 0.8); // Higher overtones die away sooner
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.004 + ring);
        osc.connect(gain);
        gain.connect(this.master!);
        osc.start(now);
        osc.stop(now + ring + 0.03);
      });
    });

    // Contact click: a very short burst of filtered noise from the harder-sounding side
    const click = MATERIALS[info.a];
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = click.noiseFreq * (0.8 + 0.5 * strength);
    filter.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    const noiseLen = 0.02 + 0.03 * strength;
    noiseGain.gain.setValueAtTime(amp * click.noise, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseLen);
    src.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.master!);
    src.start(now, Math.random() * 1.5, noiseLen + 0.02);

    // Weight: heavy, hard impacts get a falling low-frequency thump
    const heft = clamp(Math.log10(1 + info.mass) / 2.7, 0, 1);
    if (info.mass > 8 && strength > 0.25) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(36, now + 0.25);
      gain.gain.setValueAtTime(0.55 * strength * heft, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(now);
      osc.stop(now + 0.34);
      longest = Math.max(longest, 0.32);
    }

    this.voices++;
    setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, longest * 1000 + 60);
    return strength;
  }

  // Continuous rumble of things rolling or sliding over each other. intensity and brightness are 0..1.
  setRoll(intensity: number, brightness: number) {
    if (!this.ctx || !this.roll) return;
    const now = this.ctx.currentTime;
    this.roll.gain.gain.setTargetAtTime(0.24 * clamp(intensity, 0, 1), now, 0.06);
    this.roll.filter.frequency.setTargetAtTime(120 + 1500 * clamp(brightness, 0, 1), now, 0.06);
  }

  // Air rushing past a fast object. Silent in 'space', where there is no air.
  setWhoosh(intensity: number) {
    if (!this.ctx || !this.whoosh) return;
    const now = this.ctx.currentTime;
    const level = this.ambience === 'space' ? 0 : clamp(intensity, 0, 1);
    this.whoosh.gain.gain.setTargetAtTime(0.16 * level, now, 0.08);
    this.whoosh.filter.frequency.setTargetAtTime(250 + 900 * level, now, 0.08);
  }

  // Fade the continuous voices out (paused, waiting to start, or scene torn down)
  hush() {
    this.setRoll(0, 0);
    this.setWhoosh(0);
  }

  setAmbience(kind: Ambience) {
    if (kind === this.ambience) return;
    this.ambience = kind;
    this.applyAmbience();
  }

  private applyAmbience() {
    if (this.ambienceNodes) { this.ambienceNodes.stop(); this.ambienceNodes = null; }
    const ctx = this.ctx;
    // Background ambience is switched off: only object collisions make sound
    if (!AMBIENCE_AUDIBLE || !ctx || !this.master || this.ambience === 'none') return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.connect(this.master);
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];

    if (this.ambience === 'space') {
      // Two slightly detuned low tones beat slowly against each other
      [55, 55.6, 82.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = i === 2 ? 0.25 : 0.5;
        osc.connect(gain);
        gain.connect(out);
        osc.start();
        sources.push(osc);
      });
      out.gain.exponentialRampToValueAtTime(0.05, now + 2);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.5;
      // Slow swell so the breeze is not a flat hiss
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.13;
      depth.gain.value = 160;
      lfo.connect(depth);
      depth.connect(filter.frequency);
      src.connect(filter);
      filter.connect(out);
      src.start();
      lfo.start();
      sources.push(src, lfo);
      out.gain.exponentialRampToValueAtTime(0.035, now + 2);
    }

    this.ambienceNodes = {
      stop: () => {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setTargetAtTime(0.0001, t, 0.15);
        sources.forEach(s => { try { s.stop(t + 0.8); } catch {} });
        setTimeout(() => { try { out.disconnect(); } catch {} }, 1000);
      }
    };
  }

  // Device vibration (phones and tablets that support it). strength is 0..1.
  vibrate(strength: number) {
    if (!this.hapticsOn || strength < 0.2) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const now = Date.now();
    if (now - this.lastVibration < 90) return;
    this.lastVibration = now;
    try { navigator.vibrate(Math.round(12 + 70 * clamp(strength, 0, 1))); } catch {}
  }
}

export const simAudio = new SimAudio();
simAudio.installUnlock();
