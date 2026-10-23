import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Wand2, Undo2, X, MessageCircle, Check, AlertCircle } from 'lucide-react';
import { SceneEditor } from '../lib/useSceneEditor';
import { EditStage } from '../lib/sceneEdit';

// The big "change this scene with AI" bar under the simulation. Type what you want (add, remove, change) and the
// scene is rewritten, tested and shown, with an undo right there. Questions are answered in the conversation panel.

const STAGES: { key: EditStage; label: string }[] = [
  { key: 'thinking', label: 'Working out the change' },
  { key: 'testing', label: 'Testing the new scene' },
  { key: 'repairing', label: 'Fixing what the test found' }
];

const IDEAS = [
  'Add a second ball beside the first',
  'Make gravity like the Moon',
  'Make everything bouncier',
  'Remove one object',
  'Change the floor to ice',
  'Make it twice as heavy'
];

interface AiCommandBarProps {
  editor: SceneEditor;
  onOpenConversation: () => void;
  onClose: () => void;   // Hides the bar (the toolbar's AI edit button opens it again)
}

export const AiCommandBar: React.FC<AiCommandBarProps> = ({ editor, onOpenConversation, onClose }) => {
  const [text, setText] = useState('');
  const { busy, stage, last } = editor;
  const inputRef = useRef<HTMLInputElement>(null);

  // Opened, or done working: ready to type straight away
  useEffect(() => { if (!busy) inputRef.current?.focus(); }, [busy]);

  const submit = async (value: string) => {
    const request = value.trim();
    if (!request || busy) return;
    setText('');
    const result = await editor.send(request);
    // Words, not a change: the answer is in the conversation
    if (result && result.kind !== 'edit') onOpenConversation();
  };

  const stageIndex = stage ? STAGES.findIndex(s => s.key === stage) : -1;

  return (
    <div className="shrink-0 px-3 pt-2.5 pb-3 border-t border-white/[0.06] bg-slate-950/40" onMouseDown={(e) => e.stopPropagation()} data-tour="ai-bar">
      {/* The request box: large, with a soft gradient edge so it is the obvious place to talk to the AI */}
      <div className={`rounded-2xl p-[1.5px] bg-gradient-to-r ${busy ? 'from-amber-300/50 via-blue-300/50 to-violet-300/50' : 'from-blue-300/45 via-sky-300/30 to-violet-300/45'}`}>
        <div className="flex items-center gap-2 rounded-[14px] bg-slate-900/95 pl-3.5 pr-1.5 py-1.5">
          <Sparkles className="w-5 h-5 shrink-0 text-blue-300" />
          {busy ? (
            <div className="flex-1 min-w-0 flex items-center gap-3 h-10" role="status" aria-live="polite">
              <span className="inline-block w-4 h-4 shrink-0 border-2 border-blue-400/25 border-t-blue-300 rounded-full animate-spin"></span>
              <span className="truncate text-[14px] text-slate-100">{STAGES[Math.max(0, stageIndex)].label}…</span>
              <span className="hidden sm:flex items-center gap-1.5 ml-auto pr-2">
                {STAGES.slice(0, stage === 'repairing' ? 3 : 2).map((s, i) => (
                  <span key={s.key} className={`h-1.5 rounded-full transition-all duration-500 ${i < stageIndex ? 'w-5 bg-emerald-300/70' : i === stageIndex ? 'w-8 bg-blue-300 animate-pulse' : 'w-5 bg-slate-600'}`}></span>
                ))}
              </span>
            </div>
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(text); if (e.key === 'Escape') onClose(); }}
              placeholder="Change this scene with AI: “add a second ball”, “remove the ramp”, “make gravity like the Moon”…"
              aria-label="Tell the AI how to change this scene"
              className="flex-1 min-w-0 h-10 bg-transparent text-[14px] text-slate-50 placeholder:text-slate-500 focus:outline-hidden"
            />
          )}
          {!busy && (
            <button
              onClick={() => submit(text)}
              disabled={!text.trim()}
              className="shrink-0 flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Wand2 className="w-4 h-4" /> <span className="hidden sm:inline">Change it</span>
            </button>
          )}
          <button
            onClick={onOpenConversation}
            className="shrink-0 h-10 w-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]"
            title="Open the conversation (questions, history, undo and redo)"
            aria-label="Open the conversation"
          >
            <MessageCircle className="w-[18px] h-[18px]" />
          </button>
          {!busy && (
            <button
              onClick={onClose}
              className="shrink-0 h-10 w-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]"
              title="Close (Esc)"
              aria-label="Close the AI edit bar"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          )}
        </div>
      </div>

      {/* Under the box: the result of the last request, or ideas that run with one click */}
      <div className="mt-2 min-h-[28px] flex items-center gap-1.5">
        {!busy && last && last.kind === 'edit' ? (
          <div className="min-w-0 flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-full bg-emerald-400/[0.08] border border-emerald-300/20 text-[12px]">
            <Check className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
            <span className="truncate text-slate-100">{last.text}</span>
            {editor.canUndo && last.id === editor.undoTopId && (
              <button onClick={editor.undo} className="shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/[0.08] hover:bg-white/15 text-slate-200">
                <Undo2 className="w-3 h-3" /> Undo
              </button>
            )}
            <button onClick={editor.dismissLast} className="shrink-0 p-1 rounded-full text-slate-400 hover:text-slate-100" aria-label="Dismiss">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : !busy && last && last.kind === 'failed' ? (
          <div className="min-w-0 flex items-center gap-2 pl-2.5 pr-1 py-1 rounded-full bg-red-400/[0.08] border border-red-300/20 text-[12px]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-300" />
            <span className="truncate text-slate-200">{last.text}</span>
            <button onClick={editor.dismissLast} className="shrink-0 p-1 rounded-full text-slate-400 hover:text-slate-100" aria-label="Dismiss">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="min-w-0 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="shrink-0 self-center text-[11px] text-slate-500 mr-0.5">Try:</span>
            {IDEAS.map(idea => (
              <button
                key={idea}
                onClick={() => submit(idea)}
                disabled={busy}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] text-slate-400 bg-slate-800/50 border border-white/[0.05] hover:text-slate-100 hover:border-blue-300/30 disabled:opacity-40"
              >
                {idea}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
