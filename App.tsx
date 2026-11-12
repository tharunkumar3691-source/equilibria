import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { PhysicsRunner } from './components/PhysicsRunner';
import { ChatAssistant } from './components/ChatAssistant';
import { ShortcutsDialog, Tour } from './components/HelpCenter';
import { generateSimulation, generateSimulationFromText, GenerationStage, loadKeyCount } from './lib/gemini';
import { solveAndSimulate } from './lib/problems';
import { SolutionPanel } from './components/SolutionPanel';
import { DEMOS, DemoScenario } from './lib/demos';
import {
  listLibrary, saveToLibrary, removeFromLibrary, encodeShare, decodeShare, shareUrl, readSharePayload, clearSharePayload,
  exportFileContent, parseImportedFile, safeFileName, suggestName
} from './lib/library';
import { downloadBlob } from './lib/capture';
import { getRating, likeScene, dislikeScene, clearRating, Rating, Complaint } from './lib/feedback';
import { LibraryEntry, SimulationData } from './types';
import { Play, AlertCircle, Menu, Check, ShieldAlert, Sigma } from 'lucide-react';
import { LogoMark, Wordmark } from './components/Logo';
import { AiCommandBar } from './components/AiCommandBar';
import { useSceneEditor } from './lib/useSceneEditor';
import { Balance, CreditError, CreditStatus, finishGeneration, loadCredits, PreparedOrder, spendCredit } from './lib/credits';
import { BALANCE_EVENT, CHECKOUT_EVENT } from './lib/paymentAgent';
import { CreditsDialog, CreditsRequest } from './components/CreditsDialog';

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;   // The analysis request carries the clip inline; larger ones are rejected
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;   // Photos of problems are scaled down before they are sent
const TOUR_KEY = 'simulaitor.tourDone';

type GenerationKind = 'video' | 'text' | 'problem' | 'demo';

interface Progress {
  kind: GenerationKind;
  stage: GenerationStage;
  detail?: string;
  history: GenerationStage[];   // Every step so far, in order (repairs add steps)
  startedAt: number;
}

const STAGE_LABELS: Record<GenerationStage, string> = {
  reading: 'Reading your video',
  measuring: 'Measuring the motion in your video',
  analysing: 'Designing the scene with Gemini',
  checking: 'Testing the physics',
  repairing: 'Fixing problems the test found',
  reviewing: 'Reviewing pictures of the scene',
  improving: 'Improving what the review found',
  building: 'Building the 3D scene',
  solving: 'Solving it, and building the simulation alongside',
  verifying: 'Measuring the answers in the simulation',
  reconciling: 'Working out why they disagree'
};
const stageLabel = (kind: GenerationKind, stage: GenerationStage) =>
  kind === 'problem' && stage === 'reading' ? 'Reading the problem' : STAGE_LABELS[stage];

// The steps every generation goes through; repairs and improvements are added as they happen
const PLANS: Record<'video' | 'text' | 'problem', GenerationStage[]> = {
  video: ['reading', 'measuring', 'analysing', 'checking', 'reviewing', 'building'],
  text: ['analysing', 'checking', 'reviewing', 'building'],
  problem: ['reading', 'solving', 'verifying', 'building']
};

// The steps done so far, then the planned steps still to come
const stagesFor = (progress: Progress): GenerationStage[] => {
  const plan = PLANS[progress.kind === 'demo' ? 'text' : progress.kind];
  const reached = Math.max(...progress.history.map(s => plan.indexOf(s)));
  return [...progress.history, ...plan.slice(reached + 1)];
};

const QUALITY_KEY = 'simulaitor.quality';

const errorText = (err: any): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) return err.message || err.error?.message || JSON.stringify(err);
  return String(err);
};

// Step-by-step progress for a generation, driven by what the generator reports (not a timer)
const GenerationProgress: React.FC<{ progress: Progress }> = ({ progress }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - progress.startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [progress.startedAt]);

  if (progress.kind === 'demo') {
    return (
      <div className="flex flex-col items-center">
        <div className="w-12 h-12 border-2 border-blue-400/20 border-t-blue-300 rounded-full animate-spin mb-4"></div>
        <span className="text-sm text-blue-200">Preparing the scene…</span>
      </div>
    );
  }

  const stages = stagesFor(progress);
  const activeIndex = progress.history.length - 1;

  return (
    <div className="w-[min(380px,calc(100vw-3rem))] p-6 rounded-3xl bg-slate-900/85 border border-white/[0.06] shadow-calm backdrop-blur-xl" role="status" aria-live="polite">
      <div className="flex items-center justify-between mb-5">
        <span className="font-display text-lg text-slate-50">Shaping your simulation</span>
        <span className="text-xs tabular-nums text-slate-400">{elapsed}s</span>
      </div>
      <ol className="space-y-2.5">
        {stages.map((stage, i) => {
          const done = i < activeIndex, active = i === activeIndex;
          return (
            <li key={`${stage}-${i}`} className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? 'bg-blue-400/15 border-blue-300/40 text-blue-200' : active ? 'border-blue-300/50' : 'border-slate-700'}`}>
                {done ? <Check className="w-3 h-3" /> : active ? <span className="h-3 w-3 rounded-full border-2 border-blue-400/25 border-t-blue-300 animate-spin"></span> : null}
              </span>
              <span className="flex flex-col leading-tight">
                <span className={`text-[13px] ${done ? 'text-slate-400' : active ? 'text-slate-50 font-medium' : 'text-slate-600'}`}>{stageLabel(progress.kind, stage)}</span>
                {active && progress.detail && <span className="text-[11px] text-slate-500">{progress.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-[12px] leading-relaxed text-slate-500">
        {progress.kind === 'problem'
          ? 'This usually takes one to three minutes. The answers are worked out, then measured in a simulation built without seeing them, before you see either.'
          : 'This usually takes one to three minutes. Each scene is tested, refined and checked from pictures before you see it, so there is time for a slow breath or two.'}
      </p>
    </div>
  );
};

export default function App() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [simulationData, setSimulationData] = useState<SimulationData | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [apiKeyAvailable, setApiKeyAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryEntry[]>(() => listLibrary());
  const [notice, setNotice] = useState<string | null>(null);
  // A simulation that arrived from outside (a link or a file) waits here until the user agrees to run it
  const [incoming, setIncoming] = useState<{ data: SimulationData; source: 'link' | 'file' } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // The "Change with AI" bar under the simulation: opened with the toolbar's AI edit button
  const [aiBarOpen, setAiBarOpen] = useState(false);
  // The worked solution beside a problem's simulation
  const [solutionOpen, setSolutionOpen] = useState(true);
  const [quality, setQuality] = useState(() => { try { return localStorage.getItem(QUALITY_KEY) === '1'; } catch { return false; } });
  const [rating, setRating] = useState<Rating | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  // Only the newest request may show its result (an older one finishing late is ignored)
  const requestRef = useRef(0);
  // True while a generation is taking its credit, before it shows as loading
  const startingRef = useRef(false);
  // Read once, before the share-link effect below clears the address bar
  const [arrivedByLink] = useState(() => !!readSharePayload());

  // Credits for generating scenes (server/credits.ts); the dialog is open while buying them
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null);
  const [creditsOpen, setCreditsOpen] = useState<CreditsRequest | null>(null);
  const applyBalance = (balance?: Balance) => {
    if (balance) setCreditStatus(prev => (prev ? { ...prev, ...balance } : prev));
  };

  useEffect(() => {
    // The keys stay on the server; it only says whether it has any
    loadKeyCount().then(count => setApiKeyAvailable(count > 0));
    loadCredits().then(setCreditStatus).catch(err => console.warn('[credits] Could not load the balance:', err));
  }, []);

  // The assistant's payment tools (lib/paymentAgent.ts): a new balance to show, or a PayPal order to approve
  useEffect(() => {
    const onBalance = (e: Event) => applyBalance((e as CustomEvent<Balance>).detail);
    const onCheckout = (e: Event) => {
      setMenuOpen(false);
      setCreditsOpen({ reason: 'browse', order: (e as CustomEvent<PreparedOrder>).detail });
    };
    window.addEventListener(BALANCE_EVENT, onBalance);
    window.addEventListener(CHECKOUT_EVENT, onCheckout);
    return () => {
      window.removeEventListener(BALANCE_EVENT, onBalance);
      window.removeEventListener(CHECKOUT_EVENT, onCheckout);
    };
  }, []);

  // Each scene shows the rating it was given before
  useEffect(() => { setRating(simulationData ? getRating(simulationData) : null); }, [simulationData]);

  // Short confirmations fade by themselves
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // The clip a simulation was generated from, for the side-by-side view. Replaced clips are released.
  const setSourceVideo = (url: string | null) => {
    if (videoUrlRef.current && videoUrlRef.current !== url) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = url;
    setVideoUrl(url);
  };
  useEffect(() => () => { if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current); }, []);

  // A share link carries the simulation after the '#'. It is decoded but not run until confirmed.
  useEffect(() => {
    const payload = readSharePayload();
    if (!payload) return;
    clearSharePayload();
    decodeShare(payload)
      .then(data => setIncoming({ data, source: 'link' }))
      .catch(err => setError(errorText(err)));
  }, []);

  // First visit: offer the tour (not when arriving through a share link)
  useEffect(() => {
    let done = true;
    try { done = localStorage.getItem(TOUR_KEY) === '1'; } catch {}
    if (!done && !arrivedByLink) {
      const timer = window.setTimeout(() => setShowTour(true), 600);
      return () => window.clearTimeout(timer);
    }
  }, [arrivedByLink]);

  const closeTour = useCallback(() => {
    setShowTour(false);
    try { localStorage.setItem(TOUR_KEY, '1'); } catch {}
  }, []);

  // '?' opens the shortcuts panel from anywhere outside a text box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      setShowHelp(open => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Runs one generation and reports its real progress.
  // Each generation first takes a credit (none left: the credits dialog opens instead), and gives it back if it fails.
  const runGeneration = async (kind: 'video' | 'text' | 'problem', video: string | null, generate: (onStage: (stage: GenerationStage, detail?: string) => void) => Promise<SimulationData>) => {
    // A second click while the credit is being taken (before the buttons are disabled) starts nothing
    if (startingRef.current || loading) {
      if (video) URL.revokeObjectURL(video);
      return;
    }
    startingRef.current = true;
    let pass: string;
    try {
      const spent = await spendCredit(kind);
      pass = spent.pass;
      applyBalance(spent);
    } catch (err) {
      startingRef.current = false;
      if (err instanceof CreditError && err.code === 'NO_CREDITS') {
        applyBalance(err.balance);
        setMenuOpen(false);
        setCreditsOpen({ reason: 'empty' });
      } else {
        setError(errorText(err));
      }
      if (video) URL.revokeObjectURL(video);
      return;
    }
    const finish = async (ok: boolean): Promise<boolean> => {
      try {
        const result = await finishGeneration(pass, ok);
        applyBalance(result);
        return result.refunded;
      } catch (err) {
        console.warn('[credits] Could not close the generation:', err);
        return false;
      }
    };

    startingRef.current = false;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setSimulationData(null);
    setActiveDemoId(null);
    setMenuOpen(false);
    setSourceVideo(video);
    const startedAt = Date.now();
    const first: GenerationStage = kind === 'text' ? 'analysing' : 'reading';
    setProgress({ kind, stage: first, history: [first], startedAt });

    try {
      const data = await generate((stage, detail) => {
        if (request !== requestRef.current) return;
        setProgress(prev => {
          const history = prev ? prev.history : [];
          return { kind, stage, detail, startedAt, history: history[history.length - 1] === stage ? history : [...history, stage] };
        });
      });
      finish(true);
      if (request !== requestRef.current) return;
      setSimulationData(data);
    } catch (err: any) {
      const refund = finish(false);
      if (request !== requestRef.current) return;
      console.error("Simulation generation failed:", err);
      setError(errorText(err));
      setSourceVideo(null);
      // Verified or free: a generation that did not produce a checked scene costs nothing
      refund.then(refunded => {
        if (refunded && request === requestRef.current) setError(text => (text ? `${text} Your credit was returned.` : text));
      });
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  };

  // A photo of a problem, at most 2048 px on its longer side (plenty to read print), as JPEG.
  // Formats the browser cannot draw (HEIC on some systems) are sent as they are.
  const photoForModel = async (file: File): Promise<{ base64Data: string; mimeType: string }> => {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return { base64Data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], mimeType: 'image/jpeg' };
    } catch {
      return { base64Data: await readAsBase64(file), mimeType: file.type || 'image/jpeg' };
    }
  };

  const readAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The video file could not be read.'));
    reader.onloadend = () => {
      const result = reader.result as string | null;
      if (!result) { reject(new Error('The video file could not be read.')); return; }
      // Handle both data URL formats just in case
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.readAsDataURL(file);
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Critical: Reset the input value so the onChange event fires even if the user selects the same file again.
    // This allows for "Re-simulation" by picking the same video.
    e.target.value = '';

    if (!file.type.startsWith('video/')) {
      setError('That file is not a video. Please choose a video clip (MP4, WebM or MOV).');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError(`That video is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please use a clip under 20 MB (a few seconds is enough).`);
      return;
    }

    await runGeneration('video', URL.createObjectURL(file), async (onStage) => {
      onStage('reading');
      const base64 = await readAsBase64(file);
      return generateSimulation(base64, file.type, { onStage, quality });
    });
  };

  const handleGenerateFromText = (prompt: string) => {
    runGeneration('text', null, (onStage) => generateSimulationFromText(prompt, { onStage, quality }));
  };

  const handleSolveProblem = (text: string, photo: File | null) => {
    if (photo && photo.size > MAX_PHOTO_BYTES) {
      setError(`That photo is ${(photo.size / 1024 / 1024).toFixed(1)} MB. Please use one under 15 MB.`);
      return;
    }
    setSolutionOpen(true);
    runGeneration('problem', null, async (onStage) => {
      onStage('reading');
      const image = photo ? await photoForModel(photo) : undefined;
      return solveAndSimulate({ text, image }, { onStage, quality });
    });
  };

  const changeQuality = (on: boolean) => {
    setQuality(on);
    try { localStorage.setItem(QUALITY_KEY, on ? '1' : '0'); } catch {}
  };

  // --- Rating: liked scenes become examples for similar requests, complaints guide later scenes ---
  const handleRate = (value: Rating | null, complaints: Complaint[] = []) => {
    if (!simulationData) return;
    if (value === 'up') {
      const kept = likeScene(simulationData);
      setNotice(kept ? 'Thanks! Similar requests will now use this scene as an example.' : 'Thanks! (This scene is too large to keep as an example.)');
    } else if (value === 'down') {
      dislikeScene(simulationData, complaints);
      setNotice('Thanks. Later scenes will take extra care with that.');
    } else {
      clearRating(simulationData);
    }
    setRating(value);
  };

  // Shows a simulation that needs no generating (a demo, a saved one, a shared one), straight away
  const openReady = (data: SimulationData, demoId: string | null) => {
    ++requestRef.current;   // Any generation still running no longer gets to show its result
    setLoading(false);
    setProgress(null);
    setError(null);
    setActiveDemoId(demoId);
    setMenuOpen(false);
    setSourceVideo(null);
    // Fresh object so picking the same one again rebuilds the scene
    setSimulationData({ ...data });
  };

  const loadDemo = (demo: DemoScenario = DEMOS[0]) => openReady({ ...demo.data, title: demo.title }, demo.id);

  const handleUpdateSimulation = (newData: SimulationData) => {
    // An edit made through the assistant keeps the name and the source clip of what it edited
    setSimulationData({ ...newData, title: newData.title || simulationData?.title, request: newData.request || simulationData?.request });
    setActiveDemoId(null);
  };

  // Editing the open scene by conversation: shared by the bar under the simulation and the conversation panel
  const editor = useSceneEditor(apiKeyAvailable, simulationData, handleUpdateSimulation);

  // --- Library, sharing, files ---
  const handleSave = (name: string) => {
    if (!simulationData) return;
    try {
      setLibrary(saveToLibrary(name, simulationData));
      setNotice(`Saved "${name.trim() || 'Untitled simulation'}" to your library`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleDeleteEntry = (id: string) => {
    try { setLibrary(removeFromLibrary(id)); } catch (err) { setError(errorText(err)); }
  };

  const handleShare = async () => {
    if (!simulationData) return;
    try {
      const url = shareUrl(await encodeShare(simulationData));
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch {}
      if (!copied) {
        // Clipboard access can be refused; the link is then shown so it can be copied by hand
        window.prompt('Copy this link to share the simulation:', url);
        return;
      }
      setNotice(url.length > 16000
        ? 'Link copied. This scene is large, so some apps may cut the link short; Export sends it as a file instead.'
        : 'Share link copied. Anyone who opens it gets this exact simulation.');
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleExport = () => {
    if (!simulationData) return;
    const name = safeFileName(suggestName(simulationData));
    downloadBlob(new Blob([exportFileContent(simulationData)], { type: 'application/json' }), `${name}.simulation.json`);
    setNotice('Simulation file saved to your downloads');
  };

  const handleImport = async (file: File) => {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('That file is too large to be a simulation file.');
      setIncoming({ data: parseImportedFile(await file.text()), source: 'file' });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const acceptIncoming = () => {
    if (!incoming) return;
    openReady(incoming.data, null);
    setIncoming(null);
  };

  const loadingLabel = progress
    ? progress.kind === 'demo' ? 'Preparing the scene…' : `${stageLabel(progress.kind, progress.stage)}…`
    : undefined;
  const problem = !loading ? simulationData?.problem : undefined;

  return (
    <div className="flex h-screen w-screen bg-science-950 text-slate-200 font-sans relative overflow-hidden">
      {/* Backdrop: faint, slowly breathing glows (see index.html) */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      {/* Main Layout */}
      <div className="z-10 flex w-full h-full p-2 sm:p-4 gap-4">

        {/* Left: Sidebar / Control Center. A slide-over drawer on small screens, a fixed column on large ones. */}
        {menuOpen && <div className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-xs lg:hidden" onClick={() => setMenuOpen(false)}></div>}
        <div className={`fixed inset-y-0 left-0 z-40 w-[min(88vw,340px)] p-3 bg-slate-950/95 border-r border-white/[0.06] transition-transform duration-500 ease-out lg:static lg:z-auto lg:w-[320px] lg:shrink-0 lg:p-0 lg:bg-transparent lg:border-0 lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar
            loading={loading}
            loadingLabel={loadingLabel}
            simulationData={simulationData}
            onUpload={handleFileUpload}
            onGenerateFromText={handleGenerateFromText}
            onSolveProblem={handleSolveProblem}
            onLoadDemo={loadDemo}
            demos={DEMOS}
            activeDemoId={activeDemoId}
            apiKeyAvailable={apiKeyAvailable}
            credits={creditStatus?.credits ?? null}
            onOpenCredits={() => { setMenuOpen(false); setCreditsOpen({ reason: 'browse' }); }}
            error={error}
            library={library}
            onSave={handleSave}
            onOpenEntry={(entry) => openReady({ ...entry.data, title: entry.name }, null)}
            onDeleteEntry={handleDeleteEntry}
            onShare={handleShare}
            onExport={handleExport}
            onImport={handleImport}
            quality={quality}
            onQualityChange={changeQuality}
            rating={rating}
            onRate={handleRate}
            onOpenHelp={() => { setMenuOpen(false); setShowHelp(true); }}
            onClose={menuOpen ? () => setMenuOpen(false) : undefined}
          />
        </div>

        {/* Right: Simulation Canvas */}
        <main className="flex-1 min-w-0 glass rounded-3xl relative overflow-hidden flex flex-col">

          {/* Small-screen header: opens the menu */}
          <div className="lg:hidden shrink-0 h-12 flex items-center gap-2 px-2 border-b border-white/[0.06] bg-slate-950/30">
            <button onClick={() => setMenuOpen(true)} className="p-2 rounded-lg text-slate-300 hover:bg-white/5" aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </button>
            <Wordmark />
            {simulationData?.title && <span className="ml-auto truncate text-xs text-slate-400">{simulationData.title}</span>}
          </div>

          {error && (
            <div className="absolute top-14 lg:top-4 left-4 right-4 z-50 bg-slate-900/90 border border-red-300/20 p-4 rounded-2xl flex items-center justify-between gap-3 text-slate-200 backdrop-blur-xl shadow-calm" role="alert">
              <div className="flex items-start gap-3 overflow-hidden">
                <AlertCircle className="w-5 h-5 mt-0.5 text-red-300 shrink-0" />
                <div className="flex flex-col gap-1 w-full">
                  <span className="font-medium text-sm text-red-200">That didn't go as planned</span>
                  <span className="text-[13px] leading-snug text-slate-300 break-words max-h-20 overflow-y-auto">{error}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col sm:flex-row gap-2">
                {!simulationData && (
                  <button
                    onClick={() => loadDemo()}
                    className="px-3.5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-xs font-medium whitespace-nowrap text-white"
                  >
                    Try a demo
                  </button>
                )}
                <button onClick={() => setError(null)} className="px-3.5 py-2 rounded-full border border-white/10 hover:bg-white/5 text-xs text-slate-200">
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Canvas Container */}
          <div className="flex-1 min-h-0 w-full relative" data-tour="stage">
            {!simulationData && !loading && (
              <div className="absolute inset-0 overflow-y-auto">
                <div className="min-h-full flex flex-col items-center justify-center text-center p-6 sm:p-10">
                  {/* Welcome */}
                  <div className="select-none mb-9">
                    <div className="hidden lg:flex justify-center mb-5"><LogoMark className="w-14 h-14" /></div>
                    <h1 className="font-display text-4xl sm:text-5xl text-slate-50 leading-tight">
                      {error ? 'Let’s try that again' : 'Physics, gently revealed'}
                    </h1>
                    <p className="mt-4 mx-auto text-slate-400 text-[15px] leading-relaxed max-w-xl">
                      {error
                        ? 'The note above explains what happened. You can try once more, or settle into one of the demos below.'
                        : 'Bring a textbook problem and get a step-by-step solution, checked against a 3D simulation of it. Or bring a short video or a sentence, and watch it become a living 3D world.'}
                    </p>
                  </div>

                  <button onClick={() => setMenuOpen(true)} className="lg:hidden -mt-3 mb-6 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium shadow-calm">
                    Create a simulation
                  </button>

                  <div className="flex items-center gap-4 text-[13px] text-slate-500">
                    <span className="w-12 h-px bg-gradient-to-r from-transparent to-slate-700"></span>
                    Or begin with a demo
                    <span className="w-12 h-px bg-gradient-to-l from-transparent to-slate-700"></span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5 w-full max-w-5xl">
                    {DEMOS.map(demo => {
                      const Icon = demo.icon;
                      return (
                        <button
                          key={demo.id}
                          onClick={() => loadDemo(demo)}
                          className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-slate-900/40 p-4 text-left transition-all duration-500 ease-out hover:-translate-y-0.5 hover:border-white/15 hover:bg-slate-900/60 hover:shadow-calm"
                          style={{ backgroundImage: `linear-gradient(165deg, ${demo.accent}1a 0%, transparent 55%)` }}
                        >
                          <div
                            className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-3xl opacity-20 transition-opacity duration-700 group-hover:opacity-40"
                            style={{ backgroundColor: demo.accent }}
                          ></div>
                          <div
                            className="relative w-10 h-10 rounded-xl flex items-center justify-center mb-3.5"
                            style={{ backgroundColor: `${demo.accent}1f`, color: demo.accent }}
                          >
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="relative text-[14px] font-medium text-slate-100">{demo.title}</div>
                          <div className="relative mt-1 text-[12px] leading-snug text-slate-400">{demo.tagline}</div>
                          <div className="relative mt-3.5 flex items-center gap-1.5 text-[12px] text-slate-500 transition-colors duration-300 group-hover:text-slate-200">
                            <Play className="w-3 h-3 fill-current" /> Open
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {simulationData && (
               <PhysicsRunner
                   simulationData={simulationData}
                   onError={setError}
                   sourceVideoUrl={videoUrl}
                   onOpenHelp={() => setShowHelp(true)}
                   onOpenChat={() => setAiBarOpen(open => !open)}
                   aiOpen={aiBarOpen || editor.busy}
                   aiBusy={editor.busy}
                   footer={(aiBarOpen || editor.busy) ? (
                       <AiCommandBar editor={editor} onOpenConversation={() => setChatOpen(true)} onClose={() => setAiBarOpen(false)} />
                   ) : undefined}
               />
            )}

            {loading && progress && (
               <div className="absolute inset-0 flex items-center justify-center bg-science-950/70 backdrop-blur-md z-50">
                  <GenerationProgress progress={progress} />
               </div>
            )}
          </div>

          {/* Reopens a problem's solution once it has been hidden */}
          {problem && !solutionOpen && (
            <button
              onClick={() => setSolutionOpen(true)}
              className="absolute top-14 lg:top-3 right-3 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 border border-white/10 text-[12px] font-medium text-slate-100 shadow-calm backdrop-blur-xl hover:bg-slate-800"
            >
              <Sigma className="w-3.5 h-3.5 text-blue-300" /> Show solution
            </button>
          )}
        </main>

        {/* Right: a problem's worked solution. A column on wide screens, a slide-over on smaller ones. */}
        {problem && solutionOpen && (
          <div className="fixed inset-y-0 right-0 z-40 w-[min(94vw,420px)] p-2 bg-slate-950/95 border-l border-white/[0.06] xl:static xl:z-auto xl:w-[400px] xl:shrink-0 xl:p-0 xl:bg-transparent xl:border-0">
            <SolutionPanel problem={problem} onClose={() => setSolutionOpen(false)} />
          </div>
        )}
      </div>

      {/* Short confirmations */}
      {notice && (
        <div className="fixed top-4 inset-x-0 z-[110] flex justify-center px-4 pointer-events-none" role="status" aria-live="polite">
          <div className="max-w-md px-4 py-3 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-white/[0.08] shadow-calm text-[13px] text-slate-100 flex items-start gap-2.5">
            <Check className="w-4 h-4 shrink-0 mt-px text-blue-300" /> {notice}
          </div>
        </div>
      )}

      {/* A simulation from a link or a file contains code, so it only runs once the user agrees */}
      {incoming && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Open shared simulation">
          <div className="w-full max-w-md p-6 bg-slate-900/95 border border-white/[0.08] rounded-3xl shadow-calm">
            <h2 className="flex items-center gap-2 font-display text-lg text-slate-50">
              <ShieldAlert className="w-4 h-4 text-amber-300" /> Open this {incoming.source === 'link' ? 'shared simulation' : 'simulation file'}?
            </h2>
            <p className="mt-1.5 text-sm text-slate-200 font-medium truncate">{incoming.data.title || 'Untitled simulation'}</p>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400">
              A simulation is a small program that runs in your browser on this page. Only open simulations from people you trust.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setIncoming(null)} className="px-4 py-2 rounded-full text-xs text-slate-300 hover:bg-white/5">Not now</button>
              <button onClick={acceptIncoming} className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium" autoFocus>Open it</button>
            </div>
          </div>
        </div>
      )}

      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} onStartTour={() => { setShowHelp(false); setShowTour(true); }} />}
      {showTour && <Tour onClose={closeTour} />}
      {creditsOpen && (
        <CreditsDialog
          status={creditStatus}
          request={creditsOpen}
          onBalance={applyBalance}
          onPaid={(balance, added, purpose) => {
            applyBalance(balance);
            if (added) setNotice(purpose === 'pool' ? `${added} credits given to the student pool. Thank you!` : `${added} credits added. Thank you!`);
          }}
          onClose={() => setCreditsOpen(null)}
        />
      )}

      {/* Floating Chat Assistant */}
      <ChatAssistant
        editor={editor}
        simulationData={simulationData}
        isOpen={chatOpen}
        onOpenChange={setChatOpen}
        showLauncher={!simulationData}
      />
    </div>
  );
}
