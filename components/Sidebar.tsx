import React, { useState, useEffect, useRef } from 'react';
import { Upload, Cpu, Activity, Video, AlertTriangle, Terminal, Sparkles, Beaker, HelpCircle, X, PenLine, Wand2, BookMarked, Save, Link2, Download, FolderOpen, Trash2, Play, ThumbsUp, ThumbsDown, Gem } from 'lucide-react';
import { LibraryEntry, SimulationData } from '../types';
import { DemoScenario } from '../lib/demos';
import { MAX_PROMPT_LENGTH } from '../lib/gemini';
import { suggestName } from '../lib/library';
import { COMPLAINTS, Complaint, Rating } from '../lib/feedback';

interface SidebarProps {
  loading: boolean;
  loadingLabel?: string;           // What the generator is doing right now, shown in the analysis panel
  simulationData: SimulationData | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onGenerateFromText: (prompt: string) => void;
  onLoadDemo: (demo?: DemoScenario) => void;
  demos: DemoScenario[];
  activeDemoId: string | null;
  apiKeyAvailable: boolean;
  error?: string | null;
  library: LibraryEntry[];
  onSave: (name: string) => void;
  onOpenEntry: (entry: LibraryEntry) => void;
  onDeleteEntry: (id: string) => void;
  onShare: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  quality: boolean;                // Best-quality mode: Pro models first, slower
  onQualityChange: (on: boolean) => void;
  rating: Rating | null;           // The user's rating of the current scene
  onRate: (value: Rating | null, complaints?: Complaint[]) => void;
  onOpenHelp: () => void;
  onClose?: () => void;            // Present when the sidebar is a slide-over drawer (small screens)
}

const EXAMPLES = [
  'A heavy ball rolls down a ramp into a stack of wooden crates',
  'Three balls of different sizes dropped onto a trampoline',
  'A row of five pendulums released one after another'
];

const smallButton = "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium border border-white/10 bg-slate-800/70 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

export const Sidebar: React.FC<SidebarProps> = ({
  loading,
  loadingLabel,
  simulationData,
  onUpload,
  onGenerateFromText,
  onLoadDemo,
  demos,
  activeDemoId,
  apiKeyAvailable,
  error,
  library,
  onSave,
  onOpenEntry,
  onDeleteEntry,
  onShare,
  onExport,
  onImport,
  quality,
  onQualityChange,
  rating,
  onRate,
  onOpenHelp,
  onClose
}) => {
  const [typedText, setTypedText] = useState('');
  const [mode, setMode] = useState<'video' | 'text'>('video');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Thumbs down asks what was wrong before it is recorded
  const [complaining, setComplaining] = useState(false);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const importRef = useRef<HTMLInputElement>(null);

  // Typewriter effect
  useEffect(() => {
    if (!simulationData?.thought_process) {
        setTypedText('');
        return;
    }

    const text = simulationData.thought_process;
    setTypedText('');

    let i = 0;
    // Use slice to ensure atomic updates and prevent character duplication/corruption
    // caused by state update batches or re-renders.
    const interval = setInterval(() => {
        i++;
        setTypedText(text.slice(0, i));
        if (i >= text.length) clearInterval(interval);
    }, 10); // 10ms is a good balance for reading speed

    return () => clearInterval(interval);
  }, [simulationData]);

  // A different simulation closes the "save as" row and the rating questions
  useEffect(() => { setSaving(false); setComplaining(false); setComplaints([]); }, [simulationData]);

  const rateUp = () => { setComplaining(false); onRate(rating === 'up' ? null : 'up'); };
  const rateDown = () => {
      if (rating === 'down') { onRate(null); return; }
      setComplaints([]);
      setComplaining(open => !open);
  };
  const sendComplaints = () => { onRate('down', complaints); setComplaining(false); };
  const toggleComplaint = (c: Complaint) => setComplaints(list => list.includes(c) ? list.filter(x => x !== c) : [...list, c]);

  // Function to determine line style based on content
  const getLineClass = (line: string) => {
      const lower = line.toLowerCase();
      if (lower.includes('analysis') || lower.includes('scenario') || lower.includes('goal')) {
          return 'text-blue-400 font-bold mt-2 border-b border-blue-500/20 pb-1';
      }
      if (line.trim().startsWith('-') || line.trim().startsWith('•')) {
          return 'text-slate-300 pl-4 relative before:content-[""] before:absolute before:left-0 before:top-2 before:w-1 before:h-1 before:bg-slate-500 before:rounded-full';
      }
      if (line.includes(':')) {
          return 'text-emerald-300 font-semibold';
      }
      return 'text-slate-400';
  };

  const submitPrompt = () => {
      const text = prompt.trim();
      if (!text || loading) return;
      onGenerateFromText(text);
  };

  const startSaving = () => {
      if (!simulationData) return;
      setSaveName(suggestName(simulationData));
      setSaving(true);
  };

  const confirmSave = () => {
      onSave(saveName);
      setSaving(false);
  };

  const tab = (id: 'video' | 'text', icon: React.ReactNode, label: string) => (
      <button
          onClick={() => setMode(id)}
          aria-pressed={mode === id}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${mode === id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
      >
          {icon} {label}
      </button>
  );

  return (
    <aside className="w-full h-full flex flex-col gap-3 font-sans overflow-y-auto overscroll-contain pr-0.5">

      {/* Brand */}
      <div className="shrink-0 flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-white font-black tracking-tighter">
          <Beaker className="w-5 h-5 text-blue-500 fill-blue-500/20" />
          SIMUL-AI-TOR
          <span className="text-[9px] bg-blue-600/30 text-blue-200 px-1.5 py-0.5 rounded-full border border-blue-500/40 font-bold tracking-widest uppercase">Beta</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onOpenHelp} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" title="Shortcuts and help ( ? )" aria-label="Help">
            <HelpCircle className="w-4 h-4" />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" aria-label="Close menu">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Create Panel: from a video or from a description */}
      <div className="shrink-0 bg-slate-900/50 backdrop-blur border border-white/10 rounded-2xl p-4 shadow-lg" data-tour="create">
        <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2"><Wand2 className="w-3 h-3" /> Create</span>
        </div>
        <div className="flex gap-1 p-1 mb-3 rounded-xl bg-black/30">
            {tab('video', <Video className="w-3.5 h-3.5" />, 'From video')}
            {tab('text', <PenLine className="w-3.5 h-3.5" />, 'Describe')}
        </div>

        {mode === 'video' ? (
            <label className="relative group cursor-pointer block">
                <div className={`h-24 w-full border border-dashed rounded-xl bg-slate-900/50 flex flex-col items-center justify-center gap-1.5 transition-all ${error ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700 group-hover:border-blue-500/50 group-hover:bg-slate-800'} ${loading ? 'opacity-50' : ''}`}>
                    <Upload className={`w-5 h-5 transition-colors ${error ? 'text-red-400' : 'text-slate-500 group-hover:text-blue-400'}`} />
                    <span className={`text-xs font-medium ${error ? 'text-red-400' : 'text-slate-400 group-hover:text-slate-200'}`}>
                        {error ? 'Try another video' : 'Click to upload a video'}
                    </span>
                    <span className="text-[10px] text-slate-600">A short clip, up to 20 MB</span>
                </div>
                <input
                    type="file"
                    accept="video/*"
                    onChange={onUpload}
                    className="hidden"
                    disabled={loading}
                />
            </label>
        ) : (
            <div className="space-y-2">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitPrompt(); } }}
                    placeholder="Describe a physical scene, e.g. a ball rolling down a ramp into a stack of boxes"
                    aria-label="Describe the scene to simulate"
                    rows={3}
                    disabled={loading}
                    className="w-full resize-none rounded-xl bg-slate-950/60 border border-slate-700 focus:border-blue-500/60 focus:outline-none px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
                />
                <div className="flex flex-wrap gap-1">
                    {EXAMPLES.map(example => (
                        <button
                            key={example}
                            onClick={() => setPrompt(example)}
                            disabled={loading}
                            className="px-2 py-0.5 rounded-full text-[10px] text-slate-400 bg-slate-800/70 border border-white/5 hover:text-white hover:border-white/20 disabled:opacity-40 text-left"
                        >
                            {example.length > 34 ? example.slice(0, 32) + '…' : example}
                        </button>
                    ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-600">{prompt.length} / {MAX_PROMPT_LENGTH}</span>
                    <button
                        onClick={submitPrompt}
                        disabled={loading || !prompt.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Sparkles className="w-3.5 h-3.5" /> Generate
                    </button>
                </div>
            </div>
        )}

        {apiKeyAvailable && (
            <div className="mt-3 flex items-start gap-2.5 cursor-pointer select-none" title="Uses Google's Pro models first. Slower, and a free key may have little or no Pro quota (it then falls back to the usual models).">
                <button
                    type="button"
                    role="switch"
                    aria-checked={quality}
                    onClick={() => onQualityChange(!quality)}
                    disabled={loading}
                    className={`mt-0.5 relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${quality ? 'bg-violet-500' : 'bg-slate-700'}`}
                >
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${quality ? 'left-3.5' : 'left-0.5'}`}></span>
                </button>
                <span className="flex flex-col leading-tight" onClick={() => !loading && onQualityChange(!quality)}>
                    <span className={`flex items-center gap-1 text-[11px] font-semibold ${quality ? 'text-violet-300' : 'text-slate-300'}`}><Gem className="w-3 h-3" /> Best quality</span>
                    <span className="text-[10px] text-slate-500">Pro model, slower. Uses more of your quota.</span>
                </span>
            </div>
        )}

        {!apiKeyAvailable && (
             <div className="mt-3 text-[10px] text-amber-500/80 bg-amber-500/10 p-2 rounded border border-amber-500/20 flex items-start gap-2 leading-tight">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>Demo Mode: API Key missing. Using cached physics data.</span>
             </div>
        )}
      </div>

      {/* Demo Library */}
      <div className="shrink-0 bg-slate-900/50 backdrop-blur border border-white/10 rounded-2xl p-4 shadow-lg" data-tour="demos">
        <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2"><Sparkles className="w-3 h-3" /> Demos</span>
            <span className="text-[10px] font-mono text-slate-500 truncate ml-2">
                {demos.find(d => d.id === activeDemoId)?.title ?? `${demos.length} scenes`}
            </span>
        </div>
        <div className="grid grid-cols-5 gap-2">
            {demos.map(demo => {
                const Icon = demo.icon;
                const active = demo.id === activeDemoId;
                return (
                    <button
                        key={demo.id}
                        onClick={() => onLoadDemo(demo)}
                        disabled={loading}
                        title={`${demo.title} — ${demo.tagline}`}
                        aria-label={demo.title}
                        aria-pressed={active}
                        className={`h-10 rounded-xl border flex items-center justify-center transition-all disabled:opacity-50 ${active ? 'scale-105' : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:text-white hover:border-slate-500'}`}
                        style={active ? { backgroundColor: `${demo.accent}30`, borderColor: demo.accent, color: demo.accent, boxShadow: `0 0 16px ${demo.accent}55` } : undefined}
                    >
                        <Icon className="w-4 h-4" />
                    </button>
                );
            })}
        </div>
      </div>

      {/* My Library: save, share, export, import */}
      <div className="shrink-0 bg-slate-900/50 backdrop-blur border border-white/10 rounded-2xl p-4 shadow-lg" data-tour="library">
        <div className="flex items-center justify-between text-slate-400 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2"><BookMarked className="w-3 h-3" /> My Library</span>
            <span className="text-[10px] font-mono text-slate-500">{library.length} saved</span>
        </div>

        {saving ? (
            <div className="flex gap-1.5 mb-2">
                <input
                    autoFocus
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value.slice(0, 60))}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') setSaving(false); }}
                    aria-label="Name for the saved simulation"
                    className="flex-1 min-w-0 rounded-lg bg-slate-950/60 border border-slate-700 focus:border-blue-500/60 focus:outline-none px-2 py-1.5 text-xs text-slate-200"
                />
                <button onClick={confirmSave} className="px-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold">Save</button>
                <button onClick={() => setSaving(false)} className="px-1.5 rounded-lg text-slate-400 hover:bg-white/10" aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
            </div>
        ) : (
            <div className="flex gap-1.5 mb-2">
                <button onClick={startSaving} disabled={!simulationData || loading} className={smallButton} title="Save the current simulation in this browser">
                    <Save className="w-3 h-3" /> Save
                </button>
                <button onClick={onShare} disabled={!simulationData || loading} className={smallButton} title="Copy a link that reopens this exact simulation">
                    <Link2 className="w-3 h-3" /> Share
                </button>
                <button onClick={onExport} disabled={!simulationData || loading} className={smallButton} title="Download this simulation as a file">
                    <Download className="w-3 h-3" /> Export
                </button>
                <button onClick={() => importRef.current?.click()} disabled={loading} className={smallButton} title="Open a simulation file">
                    <FolderOpen className="w-3 h-3" /> Open
                </button>
                <input
                    ref={importRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) onImport(file);
                    }}
                />
            </div>
        )}

        {library.length === 0 ? (
            <p className="text-[11px] leading-snug text-slate-500">Nothing saved yet. Saved simulations stay in this browser on this device.</p>
        ) : (
            <ul className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar pr-0.5">
                {library.map(entry => (
                    <li key={entry.id} className="group flex items-center gap-1 rounded-lg bg-slate-950/40 border border-white/5 hover:border-white/15">
                        <button
                            onClick={() => onOpenEntry(entry)}
                            disabled={loading}
                            className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left disabled:opacity-50"
                            title={`Open "${entry.name}"`}
                        >
                            <Play className="w-3 h-3 shrink-0 text-slate-500 group-hover:text-blue-400 fill-current" />
                            <span className="min-w-0">
                                <span className="block truncate text-xs text-slate-200">{entry.name}</span>
                                <span className="block text-[10px] text-slate-600">{new Date(entry.savedAt).toLocaleDateString()}</span>
                            </span>
                        </button>
                        <button
                            onClick={() => { if (confirmDelete === entry.id) { onDeleteEntry(entry.id); setConfirmDelete(null); } else { setConfirmDelete(entry.id); } }}
                            onBlur={() => setConfirmDelete(null)}
                            className={`shrink-0 mr-1 px-1.5 py-1 rounded-md text-[10px] font-semibold ${confirmDelete === entry.id ? 'bg-red-600 text-white' : 'text-slate-500 hover:text-red-300 hover:bg-red-950/50'}`}
                            aria-label={confirmDelete === entry.id ? `Confirm deleting ${entry.name}` : `Delete ${entry.name}`}
                        >
                            {confirmDelete === entry.id ? 'Delete?' : <Trash2 className="w-3 h-3" />}
                        </button>
                    </li>
                ))}
            </ul>
        )}
      </div>

      {/* Rating: generated scenes only (the built-in demos are not rated) */}
      {simulationData && !simulationData.demoMode && !loading && (
         <div className="shrink-0 bg-slate-900/50 backdrop-blur border border-white/10 rounded-2xl px-4 py-2.5 shadow-lg">
             <div className="flex items-center justify-between gap-2">
                 <span className="text-[10px] text-slate-500">{rating === 'up' ? 'You liked this scene' : rating === 'down' ? 'You marked this scene down' : 'How good is this scene?'}</span>
                 <div className="flex gap-1">
                     <button
                         onClick={rateUp}
                         aria-pressed={rating === 'up'}
                         title={rating === 'up' ? 'Remove your like' : 'Good: use it as an example for similar requests'}
                         aria-label="Good scene"
                         className={`p-1.5 rounded-md transition-colors ${rating === 'up' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-emerald-300 hover:bg-white/5'}`}
                     >
                         <ThumbsUp className="w-3.5 h-3.5" />
                     </button>
                     <button
                         onClick={rateDown}
                         aria-pressed={rating === 'down'}
                         aria-expanded={complaining}
                         title={rating === 'down' ? 'Remove your rating' : 'Not good: say what was wrong'}
                         aria-label="Poor scene"
                         className={`p-1.5 rounded-md transition-colors ${rating === 'down' || complaining ? 'bg-red-500/20 text-red-300' : 'text-slate-500 hover:text-red-300 hover:bg-white/5'}`}
                     >
                         <ThumbsDown className="w-3.5 h-3.5" />
                     </button>
                 </div>
             </div>
             {complaining && (
                 <div className="mt-2 space-y-2">
                     <span className="block text-[10px] text-slate-400">What was wrong? Pick any that apply.</span>
                     <div className="flex flex-wrap gap-1">
                         {(Object.keys(COMPLAINTS) as Complaint[]).map(c => (
                             <button
                                 key={c}
                                 onClick={() => toggleComplaint(c)}
                                 aria-pressed={complaints.includes(c)}
                                 className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${complaints.includes(c) ? 'bg-red-500/20 border-red-400/40 text-red-200' : 'bg-slate-800/70 border-white/5 text-slate-400 hover:text-white'}`}
                             >
                                 {COMPLAINTS[c]}
                             </button>
                         ))}
                     </div>
                     <div className="flex justify-end gap-1.5">
                         <button onClick={() => setComplaining(false)} className="px-2 py-1 rounded-md text-[10px] text-slate-400 hover:bg-white/10">Cancel</button>
                         <button onClick={sendComplaints} className="px-2.5 py-1 rounded-md bg-red-600/80 hover:bg-red-500 text-white text-[10px] font-semibold">Send</button>
                     </div>
                 </div>
             )}
         </div>
      )}

      {/* Logic / Analysis Panel (Beautified) */}
      <div className="flex-1 min-h-[170px] bg-slate-950 border border-slate-800 rounded-2xl flex flex-col relative overflow-hidden shadow-2xl group">

         {/* Terminal Header */}
         <div className="h-9 shrink-0 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-4 select-none">
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/80 flex items-center gap-2">
                <Terminal className="w-3 h-3" /> System Analysis
            </span>
            <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-slate-700 group-hover:bg-red-500/50 transition-colors"></div>
                <div className="w-2 h-2 rounded-full bg-slate-700 group-hover:bg-amber-500/50 transition-colors"></div>
                <div className="w-2 h-2 rounded-full bg-slate-700 group-hover:bg-emerald-500/50 transition-colors"></div>
            </div>
         </div>

         {/* Terminal Body */}
         <div className="flex-1 overflow-y-auto p-4 custom-scrollbar font-mono text-xs leading-relaxed bg-slate-950 relative">

            {/* Ambient Background Glow */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.03),transparent_40%)] pointer-events-none"></div>

            {!simulationData && !loading && !error && (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 italic">
                    <Cpu className="w-8 h-8 mb-2 opacity-20" />
                    <span className="opacity-50">Waiting for data stream...</span>
                </div>
            )}

            {loading && (
                <div className="flex gap-2 items-center text-blue-400">
                    <span className="inline-block w-3 h-3 border-2 border-blue-500/30 border-t-blue-400 rounded-full animate-spin"></span>
                    <span>{loadingLabel || 'Working...'}</span>
                </div>
            )}

            {error && !loading && (
                <div className="text-red-400 bg-red-950/20 p-3 rounded border-l-2 border-red-500 break-words">
                    <span className="font-bold block mb-1">CRITICAL ERROR</span>
                    {error}
                </div>
            )}

            {simulationData && !loading && (
                <div className="relative z-10">
                    {typedText.split('\n').map((line, i) => {
                        if (!line.trim()) return <div key={i} className="h-2"></div>;
                        return (
                            <div key={i} className={`${getLineClass(line)} break-words`}>
                                {line}
                            </div>
                        );
                    })}
                    <span className="inline-block w-2 h-4 bg-blue-500/50 animate-pulse align-middle ml-1 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></span>
                </div>
            )}
         </div>
      </div>

      {/* Status Footer */}
      <div className="shrink-0 bg-slate-900/80 backdrop-blur border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
             <div className="relative">
                <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-500' : error ? 'bg-red-500' : simulationData ? 'bg-emerald-500' : 'bg-slate-600'} relative z-10`}></div>
                {loading && <div className="absolute inset-0 bg-amber-500 rounded-full animate-ping opacity-75"></div>}
                {simulationData && !loading && <div className="absolute inset-0 bg-emerald-500 rounded-full animate-ping opacity-20"></div>}
             </div>
             <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Engine Status</span>
                <span className={`text-xs font-bold ${loading ? 'text-amber-400' : error ? 'text-red-400' : simulationData ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {loading ? 'ANALYZING' : error ? 'HALTED' : simulationData ? 'OPERATIONAL' : 'STANDBY'}
                </span>
             </div>
        </div>
        <Activity className={`w-4 h-4 ${simulationData ? 'text-emerald-500/50' : 'text-slate-600'}`} />
      </div>

    </aside>
  );
};
