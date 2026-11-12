import React, { useState, useEffect, useRef } from 'react';
import { Upload, Video, Info, Sparkles, HelpCircle, X, PenLine, Wand2, BookMarked, Save, Link2, Download, FolderOpen, Trash2, Play, ThumbsUp, ThumbsDown, Gem, BookOpen, Compass, NotebookPen, ImagePlus, Sigma, Coins } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Palette, Check } from 'lucide-react';
import { LogoMark } from './Logo';
import { THEMES, ThemeId, applyTheme, savedTheme } from '../lib/theme';
import { LibraryEntry, SimulationData } from '../types';
import { DemoScenario } from '../lib/demos';
import { MAX_PROMPT_LENGTH } from '../lib/gemini';
import { MAX_PROBLEM_LENGTH } from '../lib/problems';
import { suggestName } from '../lib/library';
import { COMPLAINTS, Complaint, Rating } from '../lib/feedback';

interface SidebarProps {
  loading: boolean;
  loadingLabel?: string;           // What the generator is doing right now, shown in the analysis panel
  simulationData: SimulationData | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onGenerateFromText: (prompt: string) => void;
  onSolveProblem: (text: string, photo: File | null) => void;
  onLoadDemo: (demo?: DemoScenario) => void;
  demos: DemoScenario[];
  activeDemoId: string | null;
  apiKeyAvailable: boolean;
  credits: number | null;          // Scene credits left (null until the server answers)
  onOpenCredits: () => void;
  onWarmCredits?: () => void;      // The pointer is near the credits button: start loading PayPal
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

// Problems a student might bring, one per kind of check the simulation does well
const PROBLEM_EXAMPLES = [
  { label: 'Block on a rough incline', text: 'A 2.0 kg block is released from rest at the top of a 30° incline that is 5.0 m long. The coefficient of kinetic friction between the block and the incline is 0.20. How long does the block take to reach the bottom, and how fast is it moving there? (Take g = 9.8 m/s².)' },
  { label: 'Projectile from a cliff', text: 'A stone is thrown from the edge of a cliff 20 m high with a speed of 15 m/s at 30° above the horizontal. How long is it in the air, and how far from the foot of the cliff does it land? (Take g = 9.8 m/s² and ignore air resistance.)' },
  { label: 'Elastic collision', text: 'A 0.50 kg ball moving at 4.0 m/s on a smooth horizontal surface collides head-on, elastically, with a 1.5 kg ball at rest. Find the velocity of each ball after the collision.' }
];

const smallButton ="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium border border-white/[0.06] bg-slate-800/50 text-slate-200 hover:bg-slate-700/70 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
// The one main action of each form: large enough to find at a glance and easy to hit
const primaryButton = "flex items-center gap-1.5 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-medium shadow-calm disabled:opacity-40 disabled:cursor-not-allowed";
const chip = "px-2.5 py-1 rounded-full text-[12px] text-slate-300 bg-slate-800/40 border border-white/[0.06] hover:text-white hover:border-blue-300/40 hover:bg-slate-800/70 disabled:opacity-40 text-left";
// Every section is the same soft, frosted card with a clear title
const panel = "shrink-0 bg-slate-900/40 backdrop-blur-sm border border-white/[0.06] rounded-2xl p-4 shadow-calm";
const panelTitle = "text-[14px] font-medium text-slate-200 flex items-center gap-2";

// The menu bar's sections; one is shown beside the bar at a time
type Section = 'create' | 'demos' | 'library';
const SECTION_KEY = 'equilibria.sidebar.section';
const savedSection = (): Section => {
  try {
    const s = localStorage.getItem(SECTION_KEY);
    if (s === 'create' || s === 'demos' || s === 'library') return s;
  } catch { /* Storage blocked: start at Create */ }
  return 'create';
};

// One entry of the menu bar: a section to show, or an action (credits, help)
interface MenuItem {
  id: string;
  label: string;
  hint: string;                 // Tooltip, and the line under the section's title
  icon: React.ElementType;
  accent: string;               // The item's colour when chosen
  badge?: number | string;      // A count shown on the icon
  dot?: 'busy' | 'new' | 'alert';
  tour?: string;                // Target of the guided tour
  onSelect: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  onPointerEnter?: () => void;
}

const DOT_STYLE: Record<NonNullable<MenuItem['dot']>, string> = {
  busy: 'bg-amber-300 animate-pulse',
  new: 'bg-emerald-300',
  alert: 'bg-red-300',
};

const MenuButton: React.FC<{ item: MenuItem }> = ({ item }) => {
  const Icon = item.icon;
  return (
    <button
      onClick={item.onSelect}
      onPointerEnter={item.onPointerEnter}
      onFocus={item.onPointerEnter}
      aria-current={item.active ? 'page' : undefined}
      title={item.hint}
      data-tour={item.tour}
      className={`group relative w-full flex flex-col items-center gap-1 px-1 py-2 rounded-xl text-[11px] font-medium leading-none transition-colors ${item.active ? 'text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'}`}
    >
      {item.active && <span className="absolute -left-1.5 top-2.5 bottom-2.5 w-[3px] rounded-r-full" style={{ background: item.accent }} aria-hidden="true"></span>}
      <span
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${item.active ? 'shadow-calm' : 'group-hover:scale-105'}`}
        style={item.active ? { background: `linear-gradient(140deg, ${item.accent}55, ${item.accent}22)`, color: 'var(--color-slate-50)', boxShadow: `0 6px 18px -8px ${item.accent}` } : { color: item.accent }}
      >
        <Icon className="w-[19px] h-[19px]" />
        {item.badge !== undefined && (
          <span className="absolute -top-1.5 -right-2 min-w-[19px] h-[19px] px-1 rounded-full border-2 border-slate-950 text-[10px] font-bold leading-[15px] text-center tabular-nums text-slate-950" style={{ background: item.accent }}>
            {item.badge}
          </span>
        )}
        {item.dot && <span className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950 ${DOT_STYLE[item.dot]}`} aria-hidden="true"></span>}
      </span>
      <span className="max-w-full truncate">{item.label}</span>
    </button>
  );
};

// The colour themes, in a small panel beside the menu bar's Theme button
const ThemePicker: React.FC<{ anchor: DOMRect; value: ThemeId; onPick: (id: ThemeId) => void; onClose: () => void }> = ({ anchor, value, onPick, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const width = 300, margin = 8;
  const left = anchor.right + 10 + width <= window.innerWidth - margin ? anchor.right + 10 : Math.max(margin, window.innerWidth - width - margin);
  const bottom = Math.max(margin, window.innerHeight - anchor.bottom);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[140]" onClick={onClose} aria-hidden="true"></div>
      <div
        className="fixed z-[141] rounded-2xl border border-white/10 bg-slate-900 p-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] credits-rise"
        style={{ left, bottom, width }}
        role="dialog"
        aria-label="Colour theme"
      >
        <p className="px-1 pb-2 text-[13px] font-semibold text-slate-100">Theme</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Colour theme">
          {THEMES.map(t => {
            const chosen = t.id === value;
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={chosen}
                onClick={() => onPick(t.id)}
                className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${chosen ? 'border-blue-400/70 bg-blue-500/15 text-slate-50' : 'border-white/[0.08] text-slate-300 hover:text-slate-50 hover:bg-white/[0.05]'}`}
              >
                <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-black/20 shadow-sm" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} aria-hidden="true">
                  {chosen && <Check className="absolute inset-0 m-auto h-4 w-4" style={{ color: t.light ? '#12151a' : '#ffffff' }} strokeWidth={3} />}
                </span>
                <span className="min-w-0 truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
};

// Lines of a scene's description that only announced the machine at work; the story reads better without them
const NOISE = /^(analysis complete\.?|initiali[sz]ing simulation\.*|waiting for .*\.\.\.)$/i;

export const Sidebar: React.FC<SidebarProps> = ({
  loading,
  loadingLabel,
  simulationData,
  onUpload,
  onGenerateFromText,
  onSolveProblem,
  onLoadDemo,
  demos,
  activeDemoId,
  apiKeyAvailable,
  credits,
  onOpenCredits,
  onWarmCredits,
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
  const [mode, setMode] = useState<'problem' | 'video' | 'text'>('problem');
  const [problemText, setProblemText] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Thumbs down asks what was wrong before it is recorded
  const [complaining, setComplaining] = useState(false);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<Section>(savedSection); // The section open last time
  const [unseen, setUnseen] = useState(false); // A new scene arrived while another section was shown
  const content = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeId>(savedTheme);
  const [themeAnchor, setThemeAnchor] = useState<DOMRect | null>(null); // Where the theme picker opens from
  const pickTheme = (id: ThemeId) => { applyTheme(id); setTheme(id); };

  const show = (next: Section) => {
    setSection(next);
    try { localStorage.setItem(SECTION_KEY, next); } catch { /* Not remembered: fine */ }
  };

  // The open scene's description leads Create. Opening a demo (from Demos or the welcome screen) or a saved
  // simulation goes there at once, scrolled to the top; any other new scene (an AI edit) that arrives while
  // another section is open gets a dot on Create until it is looked at
  useEffect(() => {
    if (!simulationData) return;
    if (section === 'create' || activeDemoId) {
      show('create');
      content.current?.scrollTo({ top: 0 });
    } else setUnseen(true);
  }, [simulationData]);
  useEffect(() => { if (section === 'create') setUnseen(false); }, [section]);
  const openSaved = (entry: LibraryEntry) => { onOpenEntry(entry); show('create'); content.current?.scrollTo({ top: 0 }); };

  // The menu bar, built from what the app can do right now
  const sections: MenuItem[] = [
    { id: 'create', label: 'Create', icon: Wand2, accent: '#9f7bff', tour: 'create',
      dot: loading ? 'busy' : error ? 'alert' : unseen ? 'new' : undefined,
      hint: loading ? (loadingLabel || 'Working on it…')
        : simulationData ? `About "${simulationData.title || 'this scene'}", and making new scenes`
        : 'Solve a textbook problem, or turn a video or a sentence into a 3D scene',
      onSelect: () => show('create') },
    { id: 'demos', label: 'Demos', icon: Compass, accent: '#d084e6', tour: 'demos', badge: demos.length,
      hint: 'Ready-made scenes that load instantly, free', onSelect: () => show('demos') },
    { id: 'library', label: 'Library', icon: BookMarked, accent: '#8f99ee', tour: 'library', badge: library.length || undefined,
      hint: 'Save, share, export and open your simulations', onSelect: () => show('library') },
  ].map(item => ({ ...item, active: item.id === section }) as MenuItem);

  const actions: MenuItem[] = [];
  if (apiKeyAvailable && credits !== null) {
    actions.push({ id: 'credits', label: 'Credits', icon: Coins, accent: '#dcb676', tour: 'credits', badge: credits,
      dot: credits === 0 ? 'alert' : undefined,
      hint: credits > 0 ? `${credits} ${credits === 1 ? 'credit' : 'credits'} left. Buy more, or gift some to students, with PayPal.` : 'No credits left: get more with PayPal',
      onSelect: onOpenCredits, onPointerEnter: onWarmCredits });
  }
  const themeNow = THEMES.find(t => t.id === theme) ?? THEMES[1];
  actions.push({ id: 'theme', label: 'Theme', icon: Palette, accent: themeNow.swatch[1], active: !!themeAnchor,
    hint: `Colour theme: ${themeNow.label}`,
    onSelect: (e) => { const r = e.currentTarget.getBoundingClientRect(); setThemeAnchor(a => (a ? null : r)); } });
  actions.push({ id: 'help', label: 'Help', icon: HelpCircle, accent: '#b3bbf6',
    hint: 'Shortcuts, tour and help ( ? )', onSelect: onOpenHelp });
  const current = sections.find(s => s.active) ?? sections[0];

  // Typewriter effect
  useEffect(() => {
    if (!simulationData?.thought_process) {
        setTypedText('');
        return;
    }

    const text = simulationData.thought_process;
    setTypedText('');

    let i = 0;
    // Several characters per tick, so any text is typed out in about 150 updates (one re-render of the
    // whole sidebar each) instead of one per character. slice keeps every update whole.
    const perTick = Math.max(1, Math.ceil(text.length / 150));
    const interval = setInterval(() => {
        i = Math.min(text.length, i + perTick);
        setTypedText(text.slice(0, i));
        if (i >= text.length) clearInterval(interval);
    }, 10);

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

  // How each line of a scene's description reads: section headings, points, and plain sentences
  const getLineClass = (line: string) => {
      const trimmed = line.trim();
      if (trimmed.endsWith(':')) return 'text-blue-300 font-medium mt-3 mb-0.5';
      if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
          return 'text-slate-300 pl-4 relative before:content-[""] before:absolute before:left-1 before:top-[0.6em] before:w-1 before:h-1 before:bg-blue-400/60 before:rounded-full';
      }
      if (/^[A-Z][\w ]{1,24}:\s/.test(trimmed)) return 'text-slate-200';
      return 'text-slate-400';
  };
  const lineText = (line: string) => line.trim().replace(/^[-•]\s*/, '');

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

  // A photo of the problem: chosen, or pasted into the text box
  const choosePhoto = (file: File | undefined | null) => {
      if (!file || !file.type.startsWith('image/')) return;
      setPhoto({ file, url: URL.createObjectURL(file) });
  };
  const removePhoto = () => setPhoto(null);
  // A replaced or removed photo's preview is released
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const submitProblem = () => {
      if (loading || (!problemText.trim() && !photo)) return;
      onSolveProblem(problemText.trim(), photo ? photo.file : null);
  };

  const tab = (id: 'problem' | 'video' | 'text', icon: React.ReactNode, label: string) => (
      <button
          onClick={() => setMode(id)}
          aria-pressed={mode === id}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${mode === id ? 'bg-slate-700/80 text-slate-50 shadow-xs' : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'}`}
      >
          {icon} {label}
      </button>
  );

  return (
    <aside className="w-full h-full flex gap-2.5 font-sans">

      {/* The menu bar: every part of the app, one click away */}
      <nav className="shrink-0 w-[68px] h-full flex flex-col items-center gap-1 py-3 px-1.5 rounded-2xl bg-slate-900/50 backdrop-blur-sm border border-white/[0.06] shadow-calm overflow-y-auto overflow-x-hidden" aria-label="Main menu">
        <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04]" title="Equilibria"><LogoMark className="w-7 h-7" /></span>
        {sections.map(item => <MenuButton key={item.id} item={item} />)}
        <span className="flex-1 min-h-3" aria-hidden="true"></span>
        <span className="w-8 h-px bg-white/10 mb-1" aria-hidden="true"></span>
        {actions.map(item => <MenuButton key={item.id} item={item} />)}
      </nav>
      {themeAnchor && <ThemePicker anchor={themeAnchor} value={theme} onPick={pickTheme} onClose={() => setThemeAnchor(null)} />}

      {/* The chosen section */}
      <div ref={content} className="flex-1 min-w-0 h-full flex flex-col gap-3 overflow-y-auto overscroll-contain pr-0.5">
      <div className="shrink-0 flex items-start justify-between gap-2 px-1 pt-1">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Equilibria</p>
          <h2 className="font-display text-[22px] leading-tight text-slate-50">{current.label}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-slate-400">{current.hint}</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="shrink-0 p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* About this scene: what is happening and why, in plain words. It leads Create while a scene is open */}
      {section === 'create' && (simulationData || loading || error) && (
      <div className="shrink-0 min-h-[120px] max-h-[48vh] bg-slate-900/40 backdrop-blur-sm border border-white/[0.06] rounded-2xl flex flex-col overflow-hidden shadow-calm">
         <div className="shrink-0 flex items-center px-4 pt-3.5 pb-2 select-none">
            <span className={`${panelTitle} min-w-0`}><BookOpen className="w-3.5 h-3.5 shrink-0 text-blue-300" /> <span className="truncate">{simulationData && !loading ? (simulationData.title || 'What happens, and why') : 'What happens, and why'}</span></span>
         </div>

         <div className="flex-1 overflow-y-auto px-4 pb-4 text-[13px] leading-relaxed">
            {!simulationData && !loading && !error && (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-2">
                    <span className="w-9 h-9 rounded-full bg-blue-400/10 flex items-center justify-center"><Sparkles className="w-4 h-4 text-blue-300/80" /></span>
                    <span className="text-slate-400">Choose a demo or describe a scene. What happens in it, and why, will appear here.</span>
                </div>
            )}

            {loading && (
                <div className="flex gap-2.5 items-center text-blue-200">
                    <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400/25 border-t-blue-300 rounded-full animate-spin"></span>
                    <span>{loadingLabel || 'Working on it…'}</span>
                </div>
            )}

            {error && !loading && (
                <div className="text-red-200 bg-red-400/[0.07] p-3 rounded-xl border border-red-300/15 break-words">
                    <span className="font-medium block mb-1 text-red-300">Something needs attention</span>
                    {error}
                </div>
            )}

            {simulationData && !loading && (
                <div>
                    {typedText.split('\n').map((line, i) => {
                        if (!line.trim()) return <div key={i} className="h-2"></div>;
                        if (NOISE.test(line.trim())) return null;
                        return (
                            <div key={i} className={`${getLineClass(line)} break-words`}>
                                {lineText(line)}
                            </div>
                        );
                    })}
                </div>
            )}
         </div>
      </div>
      )}

      {/* Rating: generated scenes only (the built-in demos are not rated) */}
      {section === 'create' && simulationData && !simulationData.demoMode && !loading && (
         <div className="shrink-0 bg-slate-900/40 backdrop-blur-sm border border-white/[0.06] rounded-2xl px-4 py-2.5 shadow-calm">
             <div className="flex items-center justify-between gap-2">
                 <span className="text-[13px] text-slate-300">{rating === 'up' ? 'Glad you liked it' : rating === 'down' ? 'Thanks, noted for next time' : 'How did this scene turn out?'}</span>
                 <div className="flex gap-1">
                     <button
                         onClick={rateUp}
                         aria-pressed={rating === 'up'}
                         title={rating === 'up' ? 'Remove your like' : 'Good: use it as an example for similar requests'}
                         aria-label="Good scene"
                         className={`p-2 rounded-md transition-colors ${rating === 'up' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-emerald-300 hover:bg-white/5'}`}
                     >
                         <ThumbsUp className="w-4 h-4" />
                     </button>
                     <button
                         onClick={rateDown}
                         aria-pressed={rating === 'down'}
                         aria-expanded={complaining}
                         title={rating === 'down' ? 'Remove your rating' : 'Not good: say what was wrong'}
                         aria-label="Poor scene"
                         className={`p-2 rounded-md transition-colors ${rating === 'down' || complaining ? 'bg-red-500/20 text-red-300' : 'text-slate-400 hover:text-red-300 hover:bg-white/5'}`}
                     >
                         <ThumbsDown className="w-4 h-4" />
                     </button>
                 </div>
             </div>
             {complaining && (
                 <div className="mt-2 space-y-2">
                     <span className="block text-[12px] text-slate-400">What was wrong? Pick any that apply.</span>
                     <div className="flex flex-wrap gap-1">
                         {(Object.keys(COMPLAINTS) as Complaint[]).map(c => (
                             <button
                                 key={c}
                                 onClick={() => toggleComplaint(c)}
                                 aria-pressed={complaints.includes(c)}
                                 className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${complaints.includes(c) ? 'bg-red-500/20 border-red-400/40 text-red-200' : 'bg-slate-800/70 border-white/5 text-slate-400 hover:text-white'}`}
                             >
                                 {COMPLAINTS[c]}
                             </button>
                         ))}
                     </div>
                     <div className="flex justify-end gap-1.5">
                         <button onClick={() => setComplaining(false)} className="px-3 py-1.5 rounded-md text-[12px] text-slate-300 hover:bg-white/10">Cancel</button>
                         <button onClick={sendComplaints} className="px-3 py-1.5 rounded-md bg-red-600/80 hover:bg-red-500 text-white text-[12px] font-semibold">Send</button>
                     </div>
                 </div>
             )}
         </div>
      )}

      {/* Create Panel: from a video or from a description */}
      {section === 'create' && (
      <div className={panel}>
        <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-medium text-slate-300">Start from</span>
            {apiKeyAvailable && credits !== null && (
                <button
                    onClick={onOpenCredits}
                    onPointerEnter={onWarmCredits}
                    onFocus={onWarmCredits}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${credits > 0 ? 'text-amber-200 border-amber-300/25 bg-amber-400/[0.08] hover:bg-amber-400/[0.15]' : 'text-amber-100 border-amber-300/50 bg-amber-400/20 hover:bg-amber-400/30'}`}
                    title="Each new scene or solved problem uses 1 credit. Buy more with PayPal."
                >
                    <Coins className="w-3.5 h-3.5" />
                    <span className="tabular-nums">{credits}</span> {credits === 1 ? 'credit' : 'credits'}
                    <span className="text-amber-300/70">·</span> {credits > 0 ? 'Get more' : 'Buy'}
                </button>
            )}
        </div>
        <div className="flex gap-1 p-1 mb-3 rounded-xl bg-black/20">
            {tab('problem', <NotebookPen className="w-3.5 h-3.5" />, 'Problem')}
            {tab('video', <Video className="w-3.5 h-3.5" />, 'Video')}
            {tab('text', <PenLine className="w-3.5 h-3.5" />, 'Describe')}
        </div>

        {mode === 'problem' ? (
            <div className="space-y-2">
                <textarea
                    value={problemText}
                    onChange={(e) => setProblemText(e.target.value.slice(0, MAX_PROBLEM_LENGTH))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitProblem(); } }}
                    onPaste={(e) => {
                        const image = Array.from(e.clipboardData.files as FileList).find((f: File) => f.type.startsWith('image/'));
                        if (image) { e.preventDefault(); choosePhoto(image); }
                    }}
                    placeholder={photo ? 'Optional: which problem on the page, or anything to add' : 'Paste a textbook problem, or add a photo of it'}
                    aria-label="The physics problem to solve"
                    rows={5}
                    disabled={loading}
                    className="w-full resize-none rounded-xl bg-slate-950/40 border border-slate-700/80 focus:border-blue-400/60 focus:outline-hidden px-3 py-2.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
                />
                {photo ? (
                    <div className="flex items-center gap-2.5 p-1.5 rounded-xl bg-slate-950/40 border border-white/[0.06]">
                        <img src={photo.url} alt="The problem's photo" className="w-12 h-12 rounded-lg object-cover" />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300">{photo.file.name || 'Pasted image'}</span>
                        <button onClick={removePhoto} disabled={loading} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5" aria-label="Remove the photo">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {PROBLEM_EXAMPLES.map(example => (
                            <button
                                key={example.label}
                                onClick={() => setProblemText(example.text)}
                                disabled={loading}
                                title={`Try it: ${example.text}`}
                                className={chip}
                            >
                                {example.label}
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex items-center justify-between gap-2">
                    <button
                        onClick={() => photoRef.current?.click()}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] text-slate-200 border border-white/[0.1] hover:bg-white/5 hover:text-white disabled:opacity-40"
                        title="Add a photo of the problem (you can also paste one into the box)"
                    >
                        <ImagePlus className="w-3.5 h-3.5" /> {photo ? 'Change photo' : 'Photo'}
                    </button>
                    <input
                        ref={photoRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { choosePhoto(e.target.files?.[0]); e.target.value = ''; }}
                    />
                    <button
                        onClick={submitProblem}
                        disabled={loading || (!problemText.trim() && !photo)}
                        className={primaryButton}
                        title="Solve it step by step and check the answer in a 3D simulation ( Ctrl + Enter )"
                    >
                        <Sigma className="w-3.5 h-3.5" /> Solve and simulate
                    </button>
                </div>
            </div>
        ) : mode === 'video' ? (
            <label className="relative group cursor-pointer block">
                <div className={`h-24 w-full border border-dashed rounded-xl bg-slate-950/30 flex flex-col items-center justify-center gap-1.5 transition-all duration-300 ${error ? 'border-red-400/30 bg-red-400/5' : 'border-slate-700/80 group-hover:border-blue-400/50 group-hover:bg-blue-400/[0.04]'} ${loading ? 'opacity-50' : ''}`}>
                    <Upload className={`w-5 h-5 transition-colors ${error ? 'text-red-300' : 'text-slate-500 group-hover:text-blue-300'}`} />
                    <span className={`text-[13px] font-medium ${error ? 'text-red-300' : 'text-slate-200 group-hover:text-white'}`}>
                        {error ? 'Try another video' : 'Choose a video'}
                    </span>
                    <span className="text-[12px] text-slate-500">A few seconds is plenty · up to 20 MB</span>
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
                    className="w-full resize-none rounded-xl bg-slate-950/40 border border-slate-700/80 focus:border-blue-400/60 focus:outline-hidden px-3 py-2.5 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
                />
                <div className="flex flex-wrap gap-1">
                    {EXAMPLES.map(example => (
                        <button
                            key={example}
                            onClick={() => setPrompt(example)}
                            disabled={loading}
                            title={`Try it: ${example}`}
                            className={chip}
                        >
                            {example.length > 34 ? example.slice(0, 32) + '…' : example}
                        </button>
                    ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-slate-500 tabular-nums">{prompt.length} / {MAX_PROMPT_LENGTH}</span>
                    <button
                        onClick={submitPrompt}
                        disabled={loading || !prompt.trim()}
                        className={primaryButton}
                        title="Build this scene as a live 3D simulation ( Ctrl + Enter )"
                    >
                        <Sparkles className="w-3.5 h-3.5" /> Create scene
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
                    <span className={`flex items-center gap-1 text-[13px] font-medium ${quality ? 'text-violet-300' : 'text-slate-200'}`}><Gem className="w-3.5 h-3.5" /> Best quality</span>
                    <span className="text-[12px] text-slate-500">Takes a little longer and uses more of your quota.</span>
                </span>
            </div>
        )}

        {!apiKeyAvailable && (
             <div className="mt-3 text-[12px] text-amber-200/90 bg-amber-400/[0.07] p-2.5 rounded-xl border border-amber-300/15 flex items-start gap-2 leading-snug">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px text-amber-300" />
                <span>The demos are ready to explore. Creating new scenes needs a Gemini key in .env.local.</span>
             </div>
        )}
      </div>
      )}

      {/* Demo Library */}
      {section === 'demos' && (
      <div className={panel}>
        <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-medium text-slate-300">Pick one to open it</span>
            <span className="text-[12px] text-slate-500 ml-2">{demos.length} free scenes</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
            {demos.map(demo => {
                const Icon = demo.icon;
                const active = demo.id === activeDemoId;
                return (
                    <button
                        key={demo.id}
                        onClick={() => onLoadDemo(demo)}
                        disabled={loading}
                        title={demo.tagline}
                        aria-pressed={active}
                        className={`min-w-0 min-h-10 px-2.5 py-1.5 rounded-xl border flex items-center gap-2 text-left transition-colors duration-300 disabled:opacity-50 ${active ? 'text-slate-50' : 'border-white/[0.06] bg-slate-950/30 text-slate-300 hover:text-white hover:border-white/15 hover:bg-slate-800/40'}`}
                        style={active ? { backgroundColor: `${demo.accent}1f`, borderColor: `${demo.accent}80` } : undefined}
                    >
                        <Icon className="w-4 h-4 shrink-0" style={{ color: demo.accent }} />
                        <span className="min-w-0 text-[12px] leading-tight font-medium">{demo.title}</span>
                    </button>
                );
            })}
        </div>
      </div>
      )}

      {/* My Library: save, share, export, import */}
      {section === 'library' && (
      <div className={panel}>
        <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-medium text-slate-300">Saved in this browser</span>
            <span className="text-[12px] text-slate-500">{library.length} saved</span>
        </div>

        {saving ? (
            <div className="flex gap-1.5 mb-2">
                <input
                    autoFocus
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value.slice(0, 60))}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') setSaving(false); }}
                    aria-label="Name for the saved simulation"
                    className="flex-1 min-w-0 rounded-lg bg-slate-950/60 border border-slate-700 focus:border-blue-500/60 focus:outline-hidden px-2.5 py-2 text-[13px] text-slate-100"
                />
                <button onClick={confirmSave} className="px-3.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[12px] font-medium">Save</button>
                <button onClick={() => setSaving(false)} className="px-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" aria-label="Cancel saving" title="Cancel"><X className="w-4 h-4" /></button>
            </div>
        ) : (
            <div className="flex gap-1.5 mb-2">
                <button onClick={startSaving} disabled={!simulationData || loading} className={smallButton} title="Save the current simulation in this browser">
                    <Save className="w-3.5 h-3.5" /> Save
                </button>
                <button onClick={onShare} disabled={!simulationData || loading} className={smallButton} title="Copy a link that reopens this exact simulation">
                    <Link2 className="w-3.5 h-3.5" /> Share
                </button>
                <button onClick={onExport} disabled={!simulationData || loading} className={smallButton} title="Download this simulation as a file">
                    <Download className="w-3.5 h-3.5" /> Export
                </button>
                <button onClick={() => importRef.current?.click()} disabled={loading} className={smallButton} title="Open a simulation file">
                    <FolderOpen className="w-3.5 h-3.5" /> Open
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
            <p className="text-[12px] leading-snug text-slate-500">{simulationData ? 'Press Save to keep this scene here, in this browser.' : 'Nothing saved yet. Scenes you save stay here, in this browser.'}</p>
        ) : (
            <ul className="space-y-1 max-h-[55vh] overflow-y-auto custom-scrollbar pr-0.5">
                {library.map(entry => (
                    <li key={entry.id} className="group flex items-center gap-1 rounded-lg bg-slate-950/40 border border-white/5 hover:border-white/15">
                        <button
                            onClick={() => openSaved(entry)}
                            disabled={loading}
                            className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left disabled:opacity-50"
                            title={`Open "${entry.name}"`}
                        >
                            <Play className="w-3.5 h-3.5 shrink-0 text-slate-500 group-hover:text-blue-400 fill-current" />
                            <span className="min-w-0">
                                <span className="block truncate text-[13px] text-slate-200">{entry.name}</span>
                                <span className="block text-[11px] text-slate-500">{new Date(entry.savedAt).toLocaleDateString()}</span>
                            </span>
                        </button>
                        <button
                            onClick={() => { if (confirmDelete === entry.id) { onDeleteEntry(entry.id); setConfirmDelete(null); } else { setConfirmDelete(entry.id); } }}
                            onBlur={() => setConfirmDelete(null)}
                            className={`shrink-0 mr-1 px-2 py-1.5 rounded-md text-[11px] font-semibold ${confirmDelete === entry.id ? 'bg-red-600 text-white' : 'text-slate-500 hover:text-red-300 hover:bg-red-950/50'}`}
                            aria-label={confirmDelete === entry.id ? `Confirm deleting ${entry.name}` : `Delete ${entry.name}`}
                            title={confirmDelete === entry.id ? 'Click again to delete it' : 'Delete'}
                        >
                            {confirmDelete === entry.id ? 'Delete?' : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                    </li>
                ))}
            </ul>
        )}
      </div>
      )}

      {/* A quiet status line */}
      <div className="shrink-0 flex items-center gap-2.5 px-2 pb-1 text-[12px] text-slate-400" role="status" aria-live="polite">
        <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-300 animate-pulse' : error ? 'bg-red-300' : simulationData ? 'bg-blue-300' : 'bg-slate-500'}`}></span>
        {loading ? 'Thinking it through…' : error ? 'Paused: see the note above' : simulationData ? 'Simulation running' : 'Ready when you are'}
      </div>
      </div>

    </aside>
  );
};
