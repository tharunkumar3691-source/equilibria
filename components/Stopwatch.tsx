import React, { useEffect, useRef, useState } from 'react';
import { Timer, X, Play, Square, Flag, RotateCcw } from 'lucide-react';
import { SimApi } from '../lib/simApi';

interface StopwatchProps {
  api: SimApi;
  onClose: () => void;
  className?: string;
}

const format = (seconds: number) => {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  return `${minutes}:${(s - minutes * 60).toFixed(2).padStart(5, '0')}`;
};

// Times events on the simulation's own clock, so a reading is the true physical duration even when
// the simulation is slowed down, paused or stepped frame by frame.
export const Stopwatch: React.FC<StopwatchProps> = ({ api, onClose, className = '' }) => {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  // 'banked' is time from earlier runs; 'since' is the simulation time at which this run started
  const state = useRef({ banked: 0, since: 0 });

  const read = () => {
    const s = state.current;
    return running ? Math.max(0, s.banked + (api.clock().time - s.since)) : s.banked;
  };

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed(read()), 50);
    return () => window.clearInterval(timer);
  }, [running, api]);

  const toggle = () => {
    if (running) {
      state.current.banked = read();
      setElapsed(state.current.banked);
      setRunning(false);
    } else {
      state.current.since = api.clock().time;
      setRunning(true);
    }
  };

  const reset = () => {
    state.current = { banked: 0, since: api.clock().time };
    setElapsed(0);
    setLaps([]);
  };

  const small = "p-1.5 rounded-md text-slate-300 bg-slate-800 border border-white/10 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div
      className={`absolute z-20 w-[190px] bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="h-7 bg-white/5 border-b border-white/5 flex items-center justify-between px-2 select-none">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          <Timer className="w-3 h-3 text-emerald-400" /> Stopwatch
        </span>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-slate-400" aria-label="Close stopwatch">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="p-2.5 space-y-2">
        <div className="text-center text-2xl font-mono tabular-nums text-emerald-300" role="timer" aria-live="off">{format(elapsed)}</div>
        <div className="flex gap-1.5">
          <button onClick={toggle} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-semibold border ${running ? 'bg-amber-500/20 text-amber-200 border-amber-400/40' : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40'}`}>
            {running ? <><Square className="w-3 h-3 fill-current" /> Stop</> : <><Play className="w-3 h-3 fill-current" /> Start</>}
          </button>
          <button onClick={() => setLaps(l => [...l, read()].slice(-6))} disabled={!running} className={small} title="Lap" aria-label="Lap">
            <Flag className="w-3 h-3" />
          </button>
          <button onClick={reset} className={small} title="Reset" aria-label="Reset stopwatch">
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
        {laps.length > 0 && (
          <ol className="space-y-0.5 text-[11px] font-mono tabular-nums text-slate-300">
            {laps.map((lap, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-slate-500">Lap {i + 1}</span>
                <span>{format(lap)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[10px] leading-snug text-slate-500">Measures simulated time, so slow motion does not change the reading.</p>
      </div>
    </div>
  );
};
