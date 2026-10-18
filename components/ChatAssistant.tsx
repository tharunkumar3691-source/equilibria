import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, User, Sparkles } from 'lucide-react';
import { GoogleGenAI, Chat, Type, FunctionDeclaration } from "@google/genai";
import { SimulationData } from '../types';
import { withModelFallback, normalizeSimulation, REQUEST_TIMEOUT_MS, SCENE_KIT_GUIDE } from '../lib/gemini';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface ChatAssistantProps {
  apiKeyAvailable: boolean;
  simulationData: SimulationData | null;
  onUpdateSimulation: (data: SimulationData) => void;
}

export const ChatAssistant: React.FC<ChatAssistantProps> = ({ apiKeyAvailable, simulationData, onUpdateSimulation }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: 'Hello! I am your simulation assistant. Ask me how to improve the physics or modify the scene.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    if (!apiKeyAvailable) {
      setMessages(prev => [...prev, { role: 'user', text: input }, { role: 'model', text: 'Demo Mode: Chat is disabled without a valid API Key.' }]);
      setInput('');
      return;
    }

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const updateSimulationTool: FunctionDeclaration = {
        name: "update_simulation",
        description: "Updates the 3D physics simulation code and slider configurations based on the user's request.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            thought_process: { type: Type.STRING, description: "A brief explanation of the code changes being made." },
            code: { type: Type.STRING, description: "The complete, updated executable JavaScript code for the simulation." },
            sliders: {
              type: Type.ARRAY,
              description: "The updated list of sliders for the simulation.",
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  targetLabel: { type: Type.STRING, description: "The label used in addSimulationObject, or 'world'." },
                  property: { type: Type.STRING, enum: ["scale", "mass", "friction", "restitution", "gravity", "damping"] },
                  min: { type: Type.NUMBER },
                  max: { type: Type.NUMBER },
                  value: { type: Type.NUMBER },
                  step: { type: Type.NUMBER }
                },
                required: ["label", "targetLabel", "property", "min", "max", "value"]
              }
            },
            startMode: { type: Type.STRING, enum: ["click", "auto"], description: "'click' holds the scene frozen until the user clicks the view (one-off triggered events); 'auto' runs immediately (continuous motion)." },
            startHint: { type: Type.STRING, description: "Short prompt such as 'Click anywhere to roll the ball'. Empty when startMode is 'auto'." }
          },
          required: ["code", "sliders"]
        }
      };

      const systemInstruction = `
      You are an expert WebGL Physics engineer using Three.js and Cannon-es.
      The code environment has 'THREE', 'CANNON', 'scene', 'world' available globally.

      AVAILABLE HELPERS:
      - addSimulationObject(label, mesh, body, { sound }): Registers an object with physics and visuals.
        'sound' is what the object is made of: 'metal', 'wood', 'stone', 'glass', 'rubber', 'plastic', 'soft' or 'generic'.
        The app synthesises impact, rolling and air sounds, camera shake and device vibration from the physics using it,
        so always pass it and keep it truthful. Never create audio, call navigator.vibrate or shake the camera yourself.
        Add 'main: true' for the one object the user launches or releases, e.g. { sound: 'rubber', main: true }.
        The app keeps that object on the floor (it cannot leave the floor's edges or sink through it), so keep the
        flag on that object when you rewrite the code and do not build invisible walls yourself.
      - setAmbience(kind): Background sound for the scene: 'space' (vacuum, no air noise), 'wind' (outdoors) or 'none'.
      - addFrameCallback(fn): Runs code every frame.
      - getSimulationObject(label): Returns { mesh, body } if you need to reference an existing object.
      - addRope([x, y, z], body): Hangs a body from a fixed anchor point at its current distance and draws the rope.
        Use this for every rope, chain or pendulum. Never use CANNON.PointToPointConstraint as a rope.
      - addClickCallback(fn): fn(label) runs when the user clicks an object; return true to keep the inspector closed.
      ${SCENE_KIT_GUIDE}
      REALISM (keep every scene looking and behaving like the real world):
      - Real units and values: metres, kilograms, seconds; gravity 9.81 m/s²; true sizes and masses; real friction and
        bounce per material pair (CANNON.ContactMaterial); linearDamping about 0.01. Never exaggerate masses or gravity.
      - When you add or change objects, build them from several parts like the real thing, give every mesh a
        realMaterial, and keep the scene's ground, people, camera framing and live readout (update the readout rows when
        the scene's subject changes).

      FORBIDDEN:
      - Do NOT use 'world.getBody()'. It does not exist. 
      - Do NOT use 'world.getMesh()'.
      
      INSTRUCTIONS:
      - When updating the simulation, you MUST provide the FULL executable code in the 'code' parameter of the tool call.
      - The code is executed to REBUILD the scene from scratch each time. 
      - Ensure you re-declare all necessary geometries, materials, and bodies in your code.
      - Do not add a "Time Scale" or speed slider: the app has its own built-in Speed control.

      START MODE:
      - 'startMode' decides when time begins. "click": the app builds the scene, shows a prompt and keeps everything
        frozen until the user clicks the view. "auto": physics runs as soon as the scene loads.
      - Use "click" for a one-off triggered event (a ball released, rolled, thrown or launched; something dropped or struck).
        Use "auto" for continuous motion (orbits, spinning parts, oscillation already under way).
      - Keep the current start mode unless the request changes what kind of simulation it is, or the user asks for it
        ("start automatically", "wait for my click"). Omit the field to keep it.
      - With "click", still give objects their starting pose AND initial velocities. Never write your own click handler,
        timer or delay to start the motion; the app does that.
      `;

      const createChat = (model: string, ai: GoogleGenAI): Chat => ai.chats.create({
        model,
        config: {
            systemInstruction: systemInstruction,
            tools: [{ functionDeclarations: [updateSimulationTool] }],
            httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        },
        history: messages.map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })),
      });

      // Construct message with context if simulation exists
      const fullMessage = simulationData ? 
        `[SYSTEM CONTEXT]
         Current Simulation Code:
         \`\`\`javascript
         ${simulationData.code}
         \`\`\`
         
         Current Sliders:
         ${JSON.stringify(simulationData.sliders)}

         Current Start Mode: ${simulationData.startMode || 'auto'}

         User Request: ${userMsg}` 
        : userMsg;

      // Falls through to the next model when one is overloaded or too slow, and to the next key when out of quota
      const result = await withModelFallback((model, ai) => createChat(model, ai).sendMessage({ message: fullMessage }));

      // Handle Function Calls
      if (result && result.functionCalls && result.functionCalls.length > 0) {
        const call = result.functionCalls[0];
        if (call.name === 'update_simulation') {
            const args = call.args as any;
            
            // Validate, then execute the update (start mode carries over unless the model changed it)
            onUpdateSimulation(normalizeSimulation(
                { ...args, thought_process: args.thought_process || "Updated via chat" },
                simulationData
            ));

            // Add model response
            const responseText = args.thought_process || "I've updated the simulation based on your request.";
            setMessages(prev => [...prev, { role: 'model', text: responseText }]);
        }
      } else if (result && result.text) {
        setMessages(prev => [...prev, { role: 'model', text: result.text }]);
      }

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: "Sorry, I encountered an error (e.g., system overload). Please try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        data-tour="chat"
        aria-label={isOpen ? "Close the assistant" : "Open the assistant"}
        className={`fixed bottom-8 right-8 z-50 p-4 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 ${isOpen ? 'bg-red-500 rotate-90' : 'bg-blue-600'}`}
      >
        {isOpen ? <X className="w-6 h-6 text-white" /> : <MessageSquare className="w-6 h-6 text-white" />}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 sm:right-8 z-50 w-[calc(100vw-2rem)] max-w-sm md:max-w-none md:w-96 h-[min(500px,calc(100vh-8rem))] bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 fade-in">
          
          {/* Header */}
          <div className="p-4 border-b border-white/5 bg-black/20 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-bold text-slate-200">Research Assistant</span>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-700' : 'bg-blue-600/20'}`}>
                  {msg.role === 'user' ? <User className="w-4 h-4 text-slate-300" /> : <Bot className="w-4 h-4 text-blue-400" />}
                </div>
                <div className={`p-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-slate-700 text-slate-100 rounded-tr-none' : 'bg-white/5 text-slate-300 rounded-tl-none'}`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                 <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-blue-400" />
                </div>
                <div className="bg-white/5 p-3 rounded-2xl rounded-tl-none">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></span>
                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-75"></span>
                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-150"></span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-white/5 bg-black/20">
            <div className="flex gap-2">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={simulationData ? "Modify simulation (e.g., lower gravity)..." : "Ask about simulations..."}
                className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              <button 
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="p-2 bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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