import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, User, Sparkles, Undo2, Redo2, Check, Wrench, RotateCcw } from 'lucide-react';
import { SimulationData } from '../types';
import { SceneEditor } from '../lib/useSceneEditor';
import { EditStage } from '../lib/sceneEdit';

interface ChatAssistantProps {
  editor: SceneEditor;              // Shared with the "Change with AI" bar under the simulation
  simulationData: SimulationData | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  // The round button in the corner. Hidden while a simulation is shown, so nothing covers the view;
  // the bar under the simulation and its toolbar open the conversation instead.
  showLauncher: boolean;
}

const STAGE_TEXT: Record<EditStage, string> = {
  thinking: 'Working out the change…',
  testing: 'Testing the new scene…',
  repairing: 'Fixing a problem the test found…'
};

// Ideas to start from; a click sends them straight away
const SUGGESTIONS = [
  'Add a second one beside the main object',
  'Make gravity like the Moon',
  'Make everything bouncier',
  'Change the floor to ice',
  'Why does it move like this?',
  'I need credits for my class'
];
// With no scene open, the assistant can still explain physics and handle credits (lib/paymentAgent.ts)
const START_SUGGESTIONS = [
  'How many credits do I have?',
  'Get credits for my class of 30',
  'Sponsor scenes for students who cannot pay'
];

export const ChatAssistant: React.FC<ChatAssistantProps> = ({ editor, simulationData, isOpen, onOpenChange, showLauncher }) => {
  const setIsOpen = onOpenChange;
  const { messages, stage, busy } = editor;
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, stage, isOpen]);

  useEffect(() => { if (isOpen && !busy) inputRef.current?.focus(); }, [isOpen, busy]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setInput('');
    editor.send(text);
  };

  const headerButton = "p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  return (
    <>
      {/* Toggle Button */}
      {showLauncher && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          data-tour="chat"
          aria-label={isOpen ? "Close the assistant" : "Open the assistant"}
          className={`fixed bottom-8 right-8 z-50 p-4 rounded-full shadow-calm transition-all duration-500 ease-out hover:scale-[1.03] ${isOpen ? 'bg-slate-700 rotate-90' : 'bg-blue-600 hover:bg-blue-500'}`}
        >
          {isOpen ? <X className="w-6 h-6 text-white" /> : <MessageSquare className="w-6 h-6 text-white" />}
        </button>
      )}

      {/* Conversation window */}
      {isOpen && (
        <div className={`fixed ${showLauncher ? 'bottom-24' : 'bottom-6'} right-4 sm:right-8 z-50 w-[calc(100vw-2rem)] max-w-sm md:max-w-none md:w-[420px] h-[min(600px,calc(100vh-8rem))] bg-slate-900/95 backdrop-blur-xl border border-white/[0.08] rounded-3xl shadow-calm flex flex-col overflow-hidden`}>

          {/* Header */}
          <div className="px-4 py-3.5 border-b border-white/[0.05] flex items-center gap-1">
            <Sparkles className="w-4 h-4 text-blue-300 ml-1" />
            <span className="ml-1.5 font-display text-[17px] text-slate-50">Change with AI</span>
            <span className="ml-auto flex items-center gap-0.5">
              <button onClick={editor.undo} disabled={!editor.canUndo} className={headerButton} title="Undo the last change" aria-label="Undo the last change">
                <Undo2 className="w-4 h-4" />
              </button>
              <button onClick={editor.redo} disabled={!editor.canRedo} className={headerButton} title="Redo the change you undid" aria-label="Redo">
                <Redo2 className="w-4 h-4" />
              </button>
              <button onClick={editor.newConversation} disabled={busy} className={headerButton} title="Start a new conversation (the scene stays as it is)" aria-label="New conversation">
                <RotateCcw className="w-4 h-4" />
              </button>
              <button onClick={() => setIsOpen(false)} className={headerButton} aria-label="Close the conversation">
                <X className="w-4 h-4" />
              </button>
            </span>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, idx) => msg.role === 'note' ? (
              <div key={idx} className="flex items-center gap-3 text-[11px] text-slate-500">
                <span className="flex-1 h-px bg-white/[0.06]"></span>
                <span className="text-center">{msg.text}</span>
                <span className="flex-1 h-px bg-white/[0.06]"></span>
              </div>
            ) : (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-700/80' : 'bg-blue-400/15'}`}>
                  {msg.role === 'user' ? <User className="w-4 h-4 text-slate-300" /> : <Bot className="w-4 h-4 text-blue-300" />}
                </div>
                {msg.change ? (
                  // A change to the scene: what changed, that it was tested, and a quick way back
                  <div className="min-w-0 px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-emerald-400/[0.07] border border-emerald-300/15 text-[13px] leading-relaxed text-slate-100">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-300 mb-1">
                      <Check className="w-3.5 h-3.5" /> Scene changed and tested
                    </div>
                    {msg.text}
                    {msg.change.repairs > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                        <Wrench className="w-3 h-3" /> Fixed {msg.change.repairs === 1 ? 'a problem' : `${msg.change.repairs} problems`} found while testing
                      </div>
                    )}
                    {msg.change.id === editor.undoTopId && editor.canUndo && (
                      <button onClick={editor.undo} className="mt-2 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-slate-300 bg-white/[0.06] hover:bg-white/10">
                        <Undo2 className="w-3 h-3" /> Undo this change
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={`min-w-0 px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-blue-600/25 text-slate-50 rounded-tr-md' : 'bg-white/[0.04] text-slate-200 rounded-tl-md'}`}>
                    {msg.text}
                  </div>
                )}
              </div>
            ))}
            {stage && (
              <div className="flex gap-3" role="status" aria-live="polite">
                <div className="w-8 h-8 rounded-full bg-blue-400/15 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-blue-300" />
                </div>
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-white/[0.04] text-[13px] text-slate-300">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400/25 border-t-blue-300 rounded-full animate-spin"></span>
                  {STAGE_TEXT[stage]}
                </div>
              </div>
            )}
          </div>

          {/* Ideas, then the input */}
          <div className="border-t border-white/[0.05]">
            {!busy && (
              <div className="flex gap-1.5 px-4 pt-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {(simulationData ? SUGGESTIONS : START_SUGGESTIONS).map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="shrink-0 px-2.5 py-1 rounded-full text-[11px] text-slate-400 bg-slate-800/50 border border-white/[0.05] hover:text-slate-100 hover:border-blue-300/30"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 p-4">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send(input)}
                placeholder={simulationData ? "Ask a question, or add, remove or change something…" : "Ask about physics, or about credits"}
                aria-label="Message the AI"
                className="flex-1 min-w-0 bg-slate-950/40 border border-slate-700/80 rounded-full px-4 py-2 text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-blue-400/50 transition-colors"
              />
              <button
                onClick={() => send(input)}
                disabled={busy || !input.trim()}
                aria-label="Send"
                className="p-2.5 bg-blue-600 hover:bg-blue-500 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
