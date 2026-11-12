// The state of editing a scene by conversation, shared by the big "Change with AI" bar under the simulation
// and the conversation panel: the messages, the progress of the change in hand, and undo / redo.
import { useEffect, useRef, useState } from 'react';
import { SimulationData } from '../types';
import { chatTurn, ChatTurn, EditStage } from './sceneEdit';
import { ServerLimitError } from './gemini';

// A line in the conversation. 'note' lines are for the user only (scene switched, undone...) and are never sent.
export interface ChatMessage {
  role: 'user' | 'model' | 'note';
  text: string;
  change?: { repairs: number; id: number };   // This model message changed the scene
}

// What the last request ended with, for the bar under the simulation
export interface LastResult {
  kind: 'edit' | 'reply' | 'failed';
  text: string;
  id?: number;   // The change, when it changed the scene
}

export const GREETING = 'Hello. Ask me anything about the scene, or tell me how to change it: add something, remove something, or change how it behaves. Every change is tested before you see it, and you can undo it.';

// A step of the edit history: the scene on the other side of change 'id'
interface Version { data: SimulationData; summary: string; id: number }
let nextChangeId = 1;

export interface SceneEditor {
  messages: ChatMessage[];
  stage: EditStage | null;
  busy: boolean;
  last: LastResult | null;
  send: (text: string) => Promise<LastResult | null>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoTopId: number | null;   // The change the next undo would take back
  newConversation: () => void;
  dismissLast: () => void;
}

export function useSceneEditor(apiKeyAvailable: boolean, simulationData: SimulationData | null, onUpdateSimulation: (data: SimulationData) => void): SceneEditor {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'model', text: GREETING }]);
  const [stage, setStage] = useState<EditStage | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const busyRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const undoRef = useRef<Version[]>([]);
  const redoRef = useRef<Version[]>([]);
  const [, setTick] = useState(0);
  const bump = () => setTick(n => n + 1);
  // The code this editor last put on screen: any other code means the user opened a different scene
  const appliedCodeRef = useRef<string | null>(null);
  const sceneRef = useRef<SimulationData | null>(simulationData);
  sceneRef.current = simulationData;

  // A scene opened elsewhere (a demo, the library, a new generation) starts a fresh edit history
  useEffect(() => {
    if (!simulationData) return;
    if (simulationData.code === appliedCodeRef.current) return;
    const hadScene = appliedCodeRef.current !== null;
    appliedCodeRef.current = simulationData.code;
    undoRef.current = [];
    redoRef.current = [];
    setLast(null);
    bump();
    if (hadScene) setMessages(prev => [...prev, { role: 'note', text: `Now editing: ${simulationData.title || 'a new scene'}` }]);
  }, [simulationData]);

  // Edits, undos and redos keep the camera where the user had it
  const apply = (data: SimulationData) => {
    appliedCodeRef.current = data.code;
    onUpdateSimulation({ ...data, keepView: true });
  };

  const undo = () => {
    const current = sceneRef.current;
    const previous = undoRef.current[undoRef.current.length - 1];
    if (!previous || !current || busyRef.current) return;
    undoRef.current.pop();
    redoRef.current.push({ data: current, summary: previous.summary, id: previous.id });
    apply(previous.data);
    setMessages(prev => [...prev, { role: 'note', text: `Undone: ${previous.summary}` }]);
    setLast(null);
    bump();
  };

  const redo = () => {
    const current = sceneRef.current;
    const next = redoRef.current[redoRef.current.length - 1];
    if (!next || !current || busyRef.current) return;
    redoRef.current.pop();
    undoRef.current.push({ data: current, summary: next.summary, id: next.id });
    apply(next.data);
    setMessages(prev => [...prev, { role: 'note', text: `Redone: ${next.summary}` }]);
    setLast({ kind: 'edit', text: next.summary, id: next.id });
    bump();
  };

  const send = async (text: string): Promise<LastResult | null> => {
    const userMsg = text.trim();
    if (!userMsg || busyRef.current) return null;   // One request at a time
    if (!apiKeyAvailable) {
      const reply = 'I need a Gemini key in .env.local before I can change scenes or answer questions. The demos all work without one.';
      setMessages(prev => [...prev, { role: 'user', text: userMsg }, { role: 'model', text: reply }]);
      const result: LastResult = { kind: 'failed', text: reply };
      setLast(result);
      return result;
    }

    const scene = sceneRef.current;
    // The conversation so far, as the model should see it: the greeting and notes stay on screen only
    const history: ChatTurn[] = messagesRef.current.slice(1).filter(m => m.role !== 'note').map(m => ({ role: m.role as 'user' | 'model', text: m.text }));
    busyRef.current = true;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLast(null);
    setStage('thinking');

    let result: LastResult;
    try {
      const outcome = await chatTurn(scene, history, userMsg, setStage);
      if (outcome.kind === 'edit') {
        // Only applied if the user has not opened another scene in the meantime
        if (scene && sceneRef.current && sceneRef.current.code === scene.code) {
          const id = nextChangeId++;
          undoRef.current.push({ data: scene, summary: outcome.summary, id });
          redoRef.current = [];
          apply(outcome.data);
          setMessages(prev => [...prev, { role: 'model', text: outcome.summary, change: { repairs: outcome.repairs, id } }]);
          result = { kind: 'edit', text: outcome.summary, id };
        } else {
          const reply = 'The scene changed while I was working, so I left it alone. Ask again and I will apply it to this one.';
          setMessages(prev => [...prev, { role: 'model', text: reply }]);
          result = { kind: 'failed', text: reply };
        }
      } else {
        setMessages(prev => [...prev, { role: 'model', text: outcome.text }]);
        result = { kind: outcome.kind, text: outcome.text };
      }
    } catch (error: any) {
      console.error('[Edit] Request failed:', error);
      const detail = String(error && error.message || error);
      const reply = error instanceof ServerLimitError
        ? `${detail} Your scene is unchanged.`
        : /quota|exhausted|429/i.test(detail)
        ? 'Your Gemini key is out of quota for now, so I could not make that change. Your scene is unchanged; try again a little later.'
        : /key|refused|401|403/i.test(detail)
        ? 'Gemini refused the API key, so I could not make that change. Please check GEMINI_API_KEY in .env.local. Your scene is unchanged.'
        : "That didn't come through, probably because the service is busy. Your scene is unchanged; please try again in a moment.";
      setMessages(prev => [...prev, { role: 'model', text: reply }]);
      result = { kind: 'failed', text: reply };
    } finally {
      busyRef.current = false;
      setStage(null);
      bump();
    }
    setLast(result);
    return result;
  };

  return {
    messages, stage, busy: stage !== null, last, send, undo, redo,
    canUndo: undoRef.current.length > 0 && stage === null,
    canRedo: redoRef.current.length > 0 && stage === null,
    undoTopId: undoRef.current.length ? undoRef.current[undoRef.current.length - 1].id : null,
    newConversation: () => { if (!busyRef.current) setMessages([{ role: 'model', text: GREETING }]); },
    dismissLast: () => setLast(null)
  };
}
