// Saving simulations in this browser, and packing one into a link or a file so it can be shared.
// There is no server: a share link carries the whole scene (compressed) after the '#'.
import { LibraryEntry, SimulationData } from '../types';
import { normalizeSimulation } from './gemini';
import { parseProblem } from './problems';

const LIBRARY_KEY = 'simulaitor.library';
const SHARE_PREFIX = '#sim=';
const MAX_ENTRIES = 40;

// --- Library (localStorage) ---

export function listLibrary(): LibraryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(e => e && typeof e.id === 'string' && typeof e.name === 'string' && e.data && typeof e.data.code === 'string');
  } catch {
    return [];
  }
}

function writeLibrary(entries: LibraryEntry[]) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
  } catch {
    throw new Error('Could not save: this browser\'s storage is full or blocked. Delete a saved simulation or export to a file instead.');
  }
}

// Only what is needed to rebuild the scene is kept
const pack = (data: SimulationData): SimulationData => ({
  thought_process: data.thought_process,
  code: data.code,
  sliders: data.sliders,
  startMode: data.startMode,
  startHint: data.startHint,
  title: data.title,
  ...(data.environment ? { environment: data.environment } : {}),
  ...(data.textbookPhysics ? { textbookPhysics: true } : {}),
  ...(data.problem ? { problem: data.problem } : {})
});

export function saveToLibrary(name: string, data: SimulationData): LibraryEntry[] {
  const entry: LibraryEntry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 60) || 'Untitled simulation',
    savedAt: Date.now(),
    data: { ...pack(data), title: name.trim().slice(0, 60) || data.title }
  };
  const entries = [entry, ...listLibrary()].slice(0, MAX_ENTRIES);
  writeLibrary(entries);
  return entries;
}

export function removeFromLibrary(id: string): LibraryEntry[] {
  const entries = listLibrary().filter(e => e.id !== id);
  writeLibrary(entries);
  return entries;
}

// A readable default name: the scene's title, else the "Scenario:" line of its analysis
export function suggestName(data: SimulationData): string {
  if (data.title) return data.title;
  const match = /scenario:\s*(.+)/i.exec(data.thought_process || '');
  if (match) return match[1].replace(/[.\s]+$/, '').slice(0, 60);
  return 'My simulation';
}

// --- Sharing ---

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, transform: any): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

// 'g.' = gzip, 'p.' = plain (browsers without CompressionStream)
export async function encodeShare(data: SimulationData): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(pack(data)));
  if (canCompress()) return 'g.' + toBase64Url(await pipe(bytes, new CompressionStream('gzip')));
  return 'p.' + toBase64Url(bytes);
}

// Throws with a readable message when the payload is damaged or not a simulation
export async function decodeShare(payload: string): Promise<SimulationData> {
  try {
    const kind = payload.slice(0, 2);
    let bytes = fromBase64Url(payload.slice(2));
    if (kind === 'g.') {
      if (!canCompress()) throw new Error('unsupported');
      bytes = await pipe(bytes, new DecompressionStream('gzip'));
    } else if (kind !== 'p.') {
      throw new Error('unknown format');
    }
    return parseShared(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('This share link is damaged or incomplete. Ask for it to be sent again, or use an exported file instead.');
  }
}

// Validates anything that came from outside (a link or a file) before it is used
export function parseShared(raw: any): SimulationData {
  const data = normalizeSimulation(raw);
  const problem = parseProblem(raw.problem);
  return {
    ...data, title: typeof raw.title === 'string' ? raw.title.slice(0, 60) : undefined, ...parseEnvironment(raw.environment),
    ...(raw.textbookPhysics === true ? { textbookPhysics: true } : {}),
    ...(problem ? { problem } : {})
  };
}

// The real-world setting, if it is well formed (unknown settings are ignored where it is used)
function parseEnvironment(env: any): Pick<SimulationData, 'environment'> {
  if (!env || typeof env.setting !== 'string') return {};
  const positive = (n: any) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return { environment: {
    setting: env.setting.slice(0, 24),
    ...(positive(env.realSize) ? { realSize: env.realSize } : {}),
    ...(positive(env.upm) ? { upm: env.upm } : {}),
    ...(env.dressOnly === true ? { dressOnly: true } : {})
  } };
}

export const shareUrl = (payload: string): string =>
  `${window.location.origin}${window.location.pathname}${SHARE_PREFIX}${payload}`;

export function readSharePayload(): string | null {
  const hash = window.location.hash || '';
  return hash.startsWith(SHARE_PREFIX) && hash.length > SHARE_PREFIX.length ? hash.slice(SHARE_PREFIX.length) : null;
}

// Removes the payload from the address bar once it has been read
export function clearSharePayload() {
  if (window.location.hash.startsWith(SHARE_PREFIX)) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export function exportFileContent(data: SimulationData): string {
  return JSON.stringify({ app: 'equilibria', version: 1, ...pack(data) }, null, 2);
}

export function parseImportedFile(text: string): SimulationData {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not an Equilibria simulation (it is not valid JSON).'); }
  try { return parseShared(raw); } catch { throw new Error('That file is not an Equilibria simulation (it has no scene code).'); }
}

export const safeFileName = (name: string): string =>
  (name || 'simulation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'simulation';
