import React, { useEffect, useLayoutEffect, useState } from 'react';
import { X, Keyboard, ArrowRight, ArrowLeft, Sparkles } from 'lucide-react';

// --- Keyboard shortcuts ---

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Playback',
    items: [
      ['Space', 'Start, pause or resume'],
      ['←  →', 'Step one frame back or forward'],
      ['R', 'Reset the simulation'],
      ['E', 'Start or stop recording a video'],
      ['P', 'Save a screenshot']
    ]
  },
  {
    group: 'View',
    items: [
      ['+  −', 'Zoom in or out'],
      ['1', 'Scene view'],
      ['2  3  4', 'Top, front and side views'],
      ['0', 'Follow the selected or main object'],
      ['F', 'Full screen (realistic view)'],
    ]
  },
  {
    group: 'Tools',
    items: [
      ['V', 'Show velocity arrows'],
      ['M', 'Ruler: measure between two points'],
      ['Esc', 'Finish measuring, or deselect'],
      ['?', 'Open this panel']
    ]
  },
  {
    group: 'Mouse and touch',
    items: [
      ['Click an object', 'Inspect it: live data and editing'],
      ['Drag an object', 'Move it by hand'],
      ['Drag empty space', 'Orbit the camera'],
      ['Scroll or pinch', 'Zoom']
    ]
  }
];

interface ShortcutsDialogProps {
  onClose: () => void;
  onStartTour: () => void;
}

export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ onClose, onStartTour }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-white/10">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100"><Keyboard className="w-4 h-4 text-sky-400" /> Shortcuts and controls</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5 p-5">
          {SHORTCUTS.map(section => (
            <section key={section.group}>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">{section.group}</h3>
              <dl className="space-y-1.5">
                {section.items.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="text-slate-300">{what}</dt>
                    <dd className="shrink-0"><kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-white/10 font-mono text-[11px] text-sky-200 whitespace-nowrap">{keys}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10">
          <p className="text-[11px] text-slate-500">Shortcuts work whenever you are not typing in a text box.</p>
          <button onClick={onStartTour} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" /> Take the tour
          </button>
        </div>
      </div>
    </div>
  );
};

// --- First-visit tour ---

interface TourStep {
  target?: string;     // Value of a data-tour attribute; the step is centred when it is missing or hidden
  title: string;
  body: string;
}

const TOUR: TourStep[] = [
  {
    title: 'Welcome to Simul-AI-tor',
    body: 'Turn a video, or a sentence, into a live 3D physics simulation you can pause, rewind, measure and change. This short tour shows where things are.'
  },
  {
    target: 'create',
    title: 'Create a simulation',
    body: 'Upload a short clip of something moving, or switch to Describe and type what you want to see. The analysis usually takes 20 to 60 seconds.'
  },
  {
    target: 'demos',
    title: 'Or start from a demo',
    body: 'Ten ready-made scenes, from a wrecking ball to a Galton board. They load instantly and need no account or key.'
  },
  {
    target: 'library',
    title: 'Keep and share your work',
    body: 'Save simulations in this browser, copy a link that reopens the exact scene, or export a file to send to someone.'
  },
  {
    target: 'stage',
    title: 'The simulation view',
    body: 'Drag to look around, click an object to see its speed and energy or edit it, and drag objects to move them. The bar at the top has recording, a ruler, a stopwatch and velocity arrows; the bar at the bottom rewinds and replays.'
  },
  {
    target: 'chat',
    title: 'Ask for changes',
    body: 'The assistant can rewrite the scene for you: "make the ball heavier", "add a second ramp". Press ? at any time for the list of keyboard shortcuts.'
  }
];

interface TourProps {
  onClose: () => void;
}

export const Tour: React.FC<TourProps> = ({ onClose }) => {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = TOUR[index];

  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      const r = el ? el.getBoundingClientRect() : null;
      // Hidden or off-screen targets (a closed drawer on a phone) fall back to a centred card
      const usable = r && r.width > 8 && r.height > 8 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
      setRect(usable ? r : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIndex(i => (i < TOUR.length - 1 ? i + 1 : i));
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const last = index === TOUR.length - 1;
  const CARD_W = 320, GAP = 14, MARGIN = 12;
  const vw = window.innerWidth, vh = window.innerHeight;

  // Card position: beside the highlighted area when there is room, otherwise below, above, or centred
  let cardStyle: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const width = Math.min(CARD_W, vw - 2 * MARGIN);
    const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - width - MARGIN);
    const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - 230);
    if (rect.right + GAP + width <= vw - MARGIN) cardStyle = { left: rect.right + GAP, top: clampY(rect.top) };
    else if (rect.left - GAP - width >= MARGIN) cardStyle = { left: rect.left - GAP - width, top: clampY(rect.top) };
    else if (rect.bottom + GAP + 220 <= vh) cardStyle = { left: clampX(rect.left), top: rect.bottom + GAP };
    else if (rect.top - GAP - 220 >= 0) cardStyle = { left: clampX(rect.left), top: rect.top - GAP - 220 };
    else cardStyle = { left: clampX(vw / 2 - width / 2), top: clampY(vh / 2 - 110) };
  }

  return (
    <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label="Tour">
      {/* Dimmed backdrop with a clear window over the highlighted area */}
      {rect ? (
        <div
          className="absolute rounded-xl ring-2 ring-sky-400 pointer-events-none transition-all duration-300"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.78)' }}
        ></div>
      ) : (
        <div className="absolute inset-0 bg-slate-950/80"></div>
      )}
      <div className="absolute inset-0" onClick={onClose}></div>

      <div className="absolute w-[min(320px,calc(100vw-24px))] p-4 bg-slate-900 border border-sky-400/40 rounded-2xl shadow-2xl" style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-100">{step.title}</h2>
          <button onClick={onClose} className="-mt-1 -mr-1 p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10" aria-label="Close tour"><X className="w-4 h-4" /></button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1" aria-hidden="true">
            {TOUR.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-sky-400' : 'w-1.5 bg-slate-600'}`}></span>)}
          </div>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button onClick={() => setIndex(index - 1)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-white/10">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <button onClick={() => (last ? onClose() : setIndex(index + 1))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold" autoFocus>
              {last ? 'Done' : <>Next <ArrowRight className="w-3.5 h-3.5" /></>}
            </button>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-slate-500">{index + 1} of {TOUR.length}</div>
      </div>
    </div>
  );
};
