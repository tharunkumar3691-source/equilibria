import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { PhysicsRunner } from './components/PhysicsRunner';
import { ChatAssistant } from './components/ChatAssistant';
import { ShortcutsDialog, Tour } from './components/HelpCenter';
import { generateSimulation, generateSimulationFromText, GenerationStage } from './lib/gemini';
import { DEMOS, DemoScenario } from './lib/demos';
import {
  listLibrary, saveToLibrary, removeFromLibrary, encodeShare, decodeShare, shareUrl, readSharePayload, clearSharePayload,
  exportFileContent, parseImportedFile, safeFileName, suggestName
} from './lib/library';
import { downloadBlob } from './lib/capture';
import { getRating, likeScene, dislikeScene, clearRating, Rating, Complaint } from './lib/feedback';
import { LibraryEntry, SimulationData } from './types';
import { Beaker, Upload, Play, AlertCircle, Menu, Check, ShieldAlert } from 'lucide-react';

const MAX_VIDEO_BYTES = 20 * 1024 * 1024;   // The analysis request carries the clip inline; larger ones are rejected
const TOUR_KEY = 'simulaitor.tourDone';

type GenerationKind = 'video' | 'text' | 'demo';

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
  building: 'Building the 3D scene'
};

// The steps every generation goes through; repairs and improvements are added as they happen
const PLANS: Record<'video' | 'text', GenerationStage[]> = {
  video: ['reading', 'measuring', 'analysing', 'checking', 'reviewing', 'building'],
  text: ['analysing', 'checking', 'reviewing', 'building']
};

// The steps done so far, then the planned steps still to come
const stagesFor = (progress: Progress): GenerationStage[] => {
  const plan = PLANS[progress.kind === 'video' ? 'video' : 'text'];
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
        <div className="w-14 h-14 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4"></div>
        <span className="font-mono text-sm text-blue-400">Loading the scene...</span>
      </div>
    );
  }

  const stages = stagesFor(progress);
  const activeIndex = progress.history.length - 1;

  return (
    <div className="w-[min(360px,calc(100vw-3rem))] p-5 rounded-2xl bg-slate-900/90 border border-white/10 shadow-2xl" role="status" aria-live="polite">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-bold text-slate-100">Generating your simulation</span>
        <span className="text-xs font-mono tabular-nums text-slate-400">{elapsed}s</span>
      </div>
      <ol className="space-y-2.5">
        {stages.map((stage, i) => {
          const done = i < activeIndex, active = i === activeIndex;
          return (
            <li key={`${stage}-${i}`} className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300' : active ? 'border-blue-400/60' : 'border-slate-700'}`}>
                {done ? <Check className="w-3 h-3" /> : active ? <span className="h-3 w-3 rounded-full border-2 border-blue-500/30 border-t-blue-400 animate-spin"></span> : null}
              </span>
              <span className="flex flex-col leading-tight">
                <span className={`text-xs ${done ? 'text-slate-400' : active ? 'text-slate-100 font-semibold' : 'text-slate-600'}`}>{STAGE_LABELS[stage]}</span>
                {active && progress.detail && <span className="text-[10px] font-mono text-slate-500">{progress.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-[11px] leading-snug text-slate-500">
        Usually 1 to 3 minutes: the scene is tested, fixed if needed, and checked from pictures. If one model is busy, the next one is tried automatically.
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
  const [quality, setQuality] = useState(() => { try { return localStorage.getItem(QUALITY_KEY) === '1'; } catch { return false; } });
  const [rating, setRating] = useState<Rating | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  // Only the newest request may show its result (an older one finishing late is ignored)
  const requestRef = useRef(0);

  useEffect(() => {
    // Check if API key is in environment (simulated check)
    if (process.env.API_KEY) {
      setApiKeyAvailable(true);
    }
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
    if (!done && !readSharePayload()) {
      const timer = window.setTimeout(() => setShowTour(true), 600);
      return () => window.clearTimeout(timer);
    }
  }, []);

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

  // Runs one generation and reports its real progress
  const runGeneration = async (kind: 'video' | 'text', video: string | null, generate: (onStage: (stage: GenerationStage, detail?: string) => void) => Promise<SimulationData>) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setSimulationData(null);
    setActiveDemoId(null);
    setMenuOpen(false);
    setSourceVideo(video);
    const startedAt = Date.now();
    const first: GenerationStage = kind === 'video' ? 'reading' : 'analysing';
    setProgress({ kind, stage: first, history: [first], startedAt });

    try {
      const data = await generate((stage, detail) => {
        if (request !== requestRef.current) return;
        setProgress(prev => {
          const history = prev ? prev.history : [];
          return { kind, stage, detail, startedAt, history: history[history.length - 1] === stage ? history : [...history, stage] };
        });
      });
      if (request !== requestRef.current) return;
      setSimulationData(data);
    } catch (err: any) {
      if (request !== requestRef.current) return;
      console.error("Simulation generation failed:", err);
      setError(errorText(err));
      setSourceVideo(null);
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setProgress(null);
      }
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

  // Shows a simulation that needs no generating (a demo, a saved one, a shared one)
  const openReady = (data: SimulationData, demoId: string | null) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setActiveDemoId(demoId);
    setMenuOpen(false);
    setSourceVideo(null);
    setProgress({ kind: 'demo', stage: 'building', history: ['building'], startedAt: Date.now() });
    setTimeout(() => {
      if (request !== requestRef.current) return;
      // Fresh object so picking the same one again rebuilds the scene
      setSimulationData({ ...data });
      setLoading(false);
      setProgress(null);
    }, 500);
  };

  const loadDemo = (demo: DemoScenario = DEMOS[0]) => openReady({ ...demo.data, title: demo.title }, demo.id);

  const handleUpdateSimulation = (newData: SimulationData) => {
    // An edit made through the assistant keeps the name and the source clip of what it edited
    setSimulationData({ ...newData, title: newData.title || simulationData?.title, request: newData.request || simulationData?.request });
    setActiveDemoId(null);
  };

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
    ? progress.kind === 'demo' ? 'Loading the scene...' : `${STAGE_LABELS[progress.stage]}...`
    : undefined;

  return (
    <div className="flex h-screen w-screen bg-science-950 text-slate-200 font-sans relative overflow-hidden">
      {/* Background Grid */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none z-0"></div>

      {/* Main Layout */}
      <div className="z-10 flex w-full h-full p-2 sm:p-4 gap-4">

        {/* Left: Sidebar / Control Center. A slide-over drawer on small screens, a fixed column on large ones. */}
        {menuOpen && <div className="fixed inset-0 z-30 bg-slate-950/70 lg:hidden" onClick={() => setMenuOpen(false)}></div>}
        <div className={`fixed inset-y-0 left-0 z-40 w-[min(88vw,340px)] p-3 bg-slate-950/95 border-r border-white/10 transition-transform duration-300 lg:static lg:z-auto lg:w-[320px] lg:shrink-0 lg:p-0 lg:bg-transparent lg:border-0 lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar
            loading={loading}
            loadingLabel={loadingLabel}
            simulationData={simulationData}
            onUpload={handleFileUpload}
            onGenerateFromText={handleGenerateFromText}
            onLoadDemo={loadDemo}
            demos={DEMOS}
            activeDemoId={activeDemoId}
            apiKeyAvailable={apiKeyAvailable}
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
        <main className="flex-1 min-w-0 glass rounded-2xl relative overflow-hidden flex flex-col">

          {/* Small-screen header: opens the menu */}
          <div className="lg:hidden shrink-0 h-11 flex items-center gap-2 px-2 border-b border-white/10 bg-slate-950/40">
            <button onClick={() => setMenuOpen(true)} className="p-2 rounded-lg text-slate-300 hover:bg-white/10" aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </button>
            <span className="flex items-center gap-1.5 text-sm font-black tracking-tighter text-white">
              <Beaker className="w-4 h-4 text-blue-500" /> SIMUL-AI-TOR
            </span>
            {simulationData?.title && <span className="ml-auto truncate text-xs text-slate-400">{simulationData.title}</span>}
          </div>

          {error && (
            <div className="absolute top-14 lg:top-4 left-4 right-4 z-50 bg-red-950/90 border border-red-500/50 p-4 rounded-lg flex items-center justify-between gap-3 text-red-200 backdrop-blur-md shadow-lg animate-in fade-in slide-in-from-top-2" role="alert">
              <div className="flex items-start gap-3 overflow-hidden">
                <AlertCircle className="w-5 h-5 mt-0.5 text-red-400 shrink-0" />
                <div className="flex flex-col gap-1 w-full">
                  <span className="font-bold text-sm">Something went wrong</span>
                  <span className="text-xs font-mono break-words opacity-90 max-h-20 overflow-y-auto custom-scrollbar">{error}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col sm:flex-row gap-2">
                {!simulationData && (
                  <button
                    onClick={() => loadDemo()}
                    className="px-3 py-2 bg-red-900/50 hover:bg-red-800/50 border border-red-400/30 rounded text-xs font-mono whitespace-nowrap transition-colors text-white"
                  >
                    TRY A DEMO
                  </button>
                )}
                <button onClick={() => setError(null)} className="px-3 py-2 border border-red-400/30 hover:bg-red-800/40 rounded text-xs font-mono text-white">
                  DISMISS
                </button>
              </div>
            </div>
          )}

          {/* Canvas Container */}
          <div className="flex-1 min-h-0 w-full relative" data-tour="stage">
            {!simulationData && !loading && (
              <div className="absolute inset-0 overflow-y-auto">
                <div className="min-h-full flex flex-col items-center justify-center text-center p-6 sm:p-8">
                  {/* Title (large screens; small screens have the header bar above) */}
                  <div className="hidden lg:block mb-8 select-none">
                    <h1 className="text-3xl font-black tracking-tighter text-white flex items-center justify-center gap-3 drop-shadow-lg">
                      <Beaker className="w-8 h-8 text-blue-500 fill-blue-500/20" />
                      SIMUL-AI-TOR
                    </h1>
                    <p className="mt-2 text-blue-100/70 text-sm font-light max-w-lg">
                      Turn a video or a sentence into a live, interactive physics simulation. Analyse the motion, measure it, and experiment in 3D.
                    </p>
                  </div>

                  <div className={`w-16 h-16 shrink-0 rounded-full border flex items-center justify-center mb-4 transition-colors ${error ? 'bg-red-500/10 border-red-500/50' : 'bg-slate-800/50 border-slate-700'}`}>
                    {error ? <AlertCircle className="w-8 h-8 text-red-500" /> : <Upload className="w-8 h-8 text-slate-500" />}
                  </div>
                  <h2 className="text-xl text-slate-300 font-medium mb-2">{error ? 'That did not work' : 'Ready to simulate'}</h2>
                  <p className="text-slate-500 max-w-md text-sm">
                    {error
                      ? "The message above says what went wrong. You can try again, or start from a demo."
                      : "Upload a short video of something moving, or describe a scene in words, and get an interactive 3D model of it."}
                  </p>
                  <button onClick={() => setMenuOpen(true)} className="lg:hidden mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
                    Create a simulation
                  </button>

                  <div className="mt-7 flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span className="w-10 h-px bg-slate-700"></span>
                    Or explore a 3D demo
                    <span className="w-10 h-px bg-slate-700"></span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 w-full max-w-5xl">
                    {DEMOS.map(demo => {
                      const Icon = demo.icon;
                      return (
                        <button
                          key={demo.id}
                          onClick={() => loadDemo(demo)}
                          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:shadow-2xl"
                          style={{ backgroundImage: `linear-gradient(160deg, ${demo.accent}33 0%, transparent 60%)` }}
                        >
                          <div
                            className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-40 transition-opacity group-hover:opacity-80"
                            style={{ backgroundColor: demo.accent }}
                          ></div>
                          <div
                            className="relative w-10 h-10 rounded-xl flex items-center justify-center border border-white/10 mb-3"
                            style={{ backgroundColor: `${demo.accent}30`, color: demo.accent }}
                          >
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="relative text-sm font-bold text-slate-100">{demo.title}</div>
                          <div className="relative mt-1 text-[11px] leading-snug text-slate-400">{demo.tagline}</div>
                          <div className="relative mt-3 flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 transition-colors group-hover:text-white">
                            <Play className="w-3 h-3 fill-current" /> Run
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {simulationData && (
               <PhysicsRunner simulationData={simulationData} onError={setError} sourceVideoUrl={videoUrl} onOpenHelp={() => setShowHelp(true)} />
            )}

            {loading && progress && (
               <div className="absolute inset-0 flex items-center justify-center bg-science-950/80 backdrop-blur-sm z-50">
                  <GenerationProgress progress={progress} />
               </div>
            )}
          </div>
        </main>
      </div>

      {/* Short confirmations */}
      {notice && (
        <div className="fixed top-4 inset-x-0 z-[110] flex justify-center px-4 pointer-events-none" role="status" aria-live="polite">
          <div className="max-w-md px-4 py-2.5 rounded-xl bg-slate-800/95 border border-emerald-400/30 shadow-2xl text-xs text-slate-100 flex items-start gap-2">
            <Check className="w-4 h-4 shrink-0 text-emerald-400" /> {notice}
          </div>
        </div>
      )}

      {/* A simulation from a link or a file contains code, so it only runs once the user agrees */}
      {incoming && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Open shared simulation">
          <div className="w-full max-w-md p-5 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
              <ShieldAlert className="w-4 h-4 text-amber-400" /> Open this {incoming.source === 'link' ? 'shared simulation' : 'simulation file'}?
            </h2>
            <p className="mt-1 text-sm text-slate-200 font-semibold truncate">{incoming.data.title || 'Untitled simulation'}</p>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              A simulation is a small program that runs in your browser on this page. Only open simulations from people you trust.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setIncoming(null)} className="px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/10">Cancel</button>
              <button onClick={acceptIncoming} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold" autoFocus>Open it</button>
            </div>
          </div>
        </div>
      )}

      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} onStartTour={() => { setShowHelp(false); setShowTour(true); }} />}
      {showTour && <Tour onClose={closeTour} />}

      {/* Floating Chat Assistant */}
      <ChatAssistant
        apiKeyAvailable={apiKeyAvailable}
        simulationData={simulationData}
        onUpdateSimulation={handleUpdateSimulation}
      />
    </div>
  );
}
