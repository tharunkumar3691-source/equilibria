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
      ['F', 'Full screen'],
    ]
  },
  {
    group: 'Tools',
    items: [
      ['A', 'Arrange: freeze time and place objects by hand'],
      ['V', 'Show velocity arrows'],
      ['M', 'Ruler: measure between two points'],
      ['Esc', 'Finish arranging or measuring, or deselect'],
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md" onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-slate-900/95 border border-white/[0.08] rounded-3xl shadow-calm" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 bg-slate-900/95 backdrop-blur-sm border-b border-white/[0.06]">
          <h2 className="flex items-center gap-2 font-display text-lg text-slate-50"><Keyboard className="w-4 h-4 text-blue-300" /> Shortcuts and controls</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5 p-5">
          {SHORTCUTS.map(section => (
            <section key={section.group}>
              <h3 className="mb-2 text-[12px] font-medium text-slate-400">{section.group}</h3>
              <dl className="space-y-1.5">
                {section.items.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="text-slate-300">{what}</dt>
                    <dd className="shrink-0"><kbd className="px-1.5 py-0.5 rounded-sm bg-slate-800 border border-white/10 font-mono text-[11px] text-sky-200 whitespace-nowrap">{keys}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10">
          <p className="text-[11px] text-slate-500">Shortcuts work whenever you are not typing in a text box.</p>
          <button onClick={onStartTour} className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">
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
    title: 'Welcome to Equilibria',
    body: 'A quiet place to watch physics unfold. Turn a video, or a sentence, into a living 3D simulation you can pause, rewind, measure and change. This short tour shows you around.'
  },
  {
    target: 'create',
    title: 'Create a simulation',
    body: 'Upload a short clip of something moving, or switch to Describe and type what you want to see. The analysis usually takes 20 to 60 seconds.'
  },
  {
    target: 'demos',
    title: 'Or start from a demo',
    body: 'Eleven ready-made scenes, from Newton\'s cradle and trigonometry to a black hole and time dilation. They load instantly and need no account or key.'
  },
  {
    target: 'library',
    title: 'Keep and share your work',
    body: 'Save simulations in this browser, copy a link that reopens the exact scene, or export a file to send to someone.'
  },
  {
    target: 'stage',
    title: 'The simulation view',
    body: 'Drag to look around, click an object to see its speed and energy or edit it, and drag objects to move them. Nothing is drawn over the view: the toolbar above it has playback, recording, a ruler, a stopwatch, zoom and camera views, and the side panel beside it holds the live readout and settings (hide it for the full width).'
  },
  {
    target: 'chat',
    title: 'Change any scene with AI',
    body: 'Click "AI edit" in the toolbar above any simulation to open the "Change this scene with AI" bar, then type "add a second ball", "remove the ramp" or "make gravity like the Moon". Each change is tested before you see it, and Undo takes it back. Press ? at any time for the keyboard shortcuts.'
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
          className="absolute rounded-2xl ring-1 ring-blue-300/60 pointer-events-none transition-all duration-500 ease-out"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 0 9999px rgba(9, 6, 20, 0.72), 0 0 24px rgba(185, 160, 255, 0.3)' }}
        ></div>
      ) : (
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs"></div>
      )}
      <div className="absolute inset-0" onClick={onClose}></div>

      <div className="absolute w-[min(330px,calc(100vw-24px))] p-5 bg-slate-900/95 backdrop-blur-xl border border-white/[0.08] rounded-3xl shadow-calm" style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg leading-snug text-slate-50">{step.title}</h2>
          <button onClick={onClose} className="-mt-1 -mr-1 p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/5" aria-label="Close tour"><X className="w-4 h-4" /></button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{step.body}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1" aria-hidden="true">
            {TOUR.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === index ? 'w-5 bg-blue-300' : 'w-1.5 bg-slate-600'}`}></span>)}
          </div>
          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button onClick={() => setIndex(index - 1)} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs text-slate-300 hover:bg-white/5">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <button onClick={() => (last ? onClose() : setIndex(index + 1))} className="flex items-center gap-1 px-4 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium" autoFocus>
              {last ? 'Done' : <>Next <ArrowRight className="w-3.5 h-3.5" /></>}
            </button>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-500">{index + 1} of {TOUR.length}</div>
      </div>
    </div>
  );
};
