// Thumbs up / down on generated scenes, kept in this browser.
// - A liked scene becomes an example: when a similar scene is requested later, its code is shown to
//   the AI as a model of the quality wanted (lib/examples.ts).
// - A disliked scene records what was wrong with it; the most common complaints are passed on to the AI
//   as things to take extra care with.
import { SimulationData } from '../types';

const LIKED_KEY = 'simulaitor.liked';
const RATINGS_KEY = 'simulaitor.ratings';
const COMPLAINTS_KEY = 'simulaitor.complaints';
const MAX_LIKED = 12;
const MAX_CODE = 16000;   // Larger scenes are not kept as examples (they would crowd out the request)

export interface LikedScene {
  id: string;
  title: string;
  request: string;       // What was asked for: the description, or what the video showed
  likedAt: number;
  data: SimulationData;
}

export type Rating = 'up' | 'down';

export const COMPLAINTS = {
  look: 'Looks fake or toy-like',
  physics: 'Physics is wrong',
  camera: 'Bad camera view',
  nothing: 'Nothing happens',
  mismatch: 'Not what I asked for'
} as const;
export type Complaint = keyof typeof COMPLAINTS;

// What the AI is told for each complaint
const COMPLAINT_NOTES: Record<Complaint, string> = {
  look: 'scenes looked fake or toy-like: build objects from several parts, realMaterial on every mesh, true colours, a believable setting',
  physics: 'the physics looked wrong: real masses, sizes, speeds and friction, nothing faked, nothing overlapping or floating',
  camera: 'the camera view was poor: frame the whole action from the side and a little above, at about 2.5 times its length',
  nothing: 'nothing happened: give the moving object its real starting velocity or pose so the action plays out by itself',
  mismatch: 'the scene did not match the request: include every object, person and event that was asked for'
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// A short fingerprint of a scene's code, so a rating stays with that exact scene
export function sceneId(data: SimulationData): string {
  let hash = 2166136261;
  for (let i = 0; i < data.code.length; i++) {
    hash ^= data.code.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36) + data.code.length.toString(36);
}

export function listLiked(): LikedScene[] {
  const raw = read<any[]>(LIKED_KEY, []);
  return Array.isArray(raw) ? raw.filter(e => e && typeof e.id === 'string' && e.data && typeof e.data.code === 'string') : [];
}

export function getRating(data: SimulationData): Rating | null {
  const ratings = read<Record<string, Rating>>(RATINGS_KEY, {});
  return ratings[sceneId(data)] || null;
}

function setRating(id: string, rating: Rating | null) {
  const ratings = read<Record<string, Rating>>(RATINGS_KEY, {});
  if (rating) ratings[id] = rating; else delete ratings[id];
  // Only the newest few hundred ratings are kept
  const entries = Object.entries(ratings);
  write(RATINGS_KEY, Object.fromEntries(entries.slice(Math.max(0, entries.length - 300))));
}

// Returns false when the scene is too large to keep as an example (the rating is still recorded)
export function likeScene(data: SimulationData): boolean {
  const id = sceneId(data);
  setRating(id, 'up');
  if (data.code.length > MAX_CODE) return false;
  const entry: LikedScene = {
    id,
    title: data.title || 'Untitled scene',
    request: data.request || data.title || '',
    likedAt: Date.now(),
    data: { thought_process: data.thought_process, code: data.code, sliders: data.sliders, startMode: data.startMode, startHint: data.startHint, title: data.title }
  };
  write(LIKED_KEY, [entry, ...listLiked().filter(e => e.id !== id)].slice(0, MAX_LIKED));
  return true;
}

export function dislikeScene(data: SimulationData, complaints: Complaint[]) {
  const id = sceneId(data);
  setRating(id, 'down');
  write(LIKED_KEY, listLiked().filter(e => e.id !== id));
  if (!complaints.length) return;
  const counts = read<Record<string, number>>(COMPLAINTS_KEY, {});
  complaints.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  write(COMPLAINTS_KEY, counts);
}

export function clearRating(data: SimulationData) {
  const id = sceneId(data);
  setRating(id, null);
  write(LIKED_KEY, listLiked().filter(e => e.id !== id));
}

// The complaints made so far, most frequent first, as guidance for the next scene
export function feedbackNote(): string {
  const counts = read<Record<string, number>>(COMPLAINTS_KEY, {});
  const top = (Object.keys(COMPLAINT_NOTES) as Complaint[])
    .filter(c => counts[c] > 0)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 3);
  if (!top.length) return '';
  return `FEEDBACK FROM THIS USER ON EARLIER SCENES (take extra care with these): ${top.map(c => `${COMPLAINT_NOTES[c]} (${counts[c]}x)`).join('; ')}.`;
}
