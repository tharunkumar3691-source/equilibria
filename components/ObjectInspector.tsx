import React, { useEffect, useRef, useState } from 'react';
import { Box, X, Activity, SlidersHorizontal, Copy, Trash2 } from 'lucide-react';
import { SimApi } from '../lib/simApi';
import { BodyStats } from '../lib/objects';
import { SOUND_MATERIALS, SoundMaterial } from '../lib/audio';

// What the editor shows for the selected object
export interface ObjectEditInfo {
  movable: boolean;       // Dynamic body with mass (fixed scenery cannot be given a mass or bounce)
  canResize: boolean;
  canDuplicate: boolean;
  mass: number;
  scale: number;
  color: string;
  sound: SoundMaterial;
  bounce: number;
  rotation: { x: number; y: number; z: number };
}

interface ObjectInspectorProps {
  label: string;
  api: SimApi;
  info: ObjectEditInfo;
  style: React.CSSProperties;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onHeaderMouseDown: (e: React.MouseEvent) => void;
  onClose: () => void;
  onMass: (value: number) => void;
  onScale: (value: number) => void;
  onRotate: (axis: 'x' | 'y' | 'z', degrees: number) => void;
  onColor: (hex: string) => void;
  onSound: (sound: SoundMaterial) => void;
  onBounce: (value: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const HISTORY = 120;   // Samples kept for the graph (12 seconds at 10 per second)

const fmt = (n: number, digits = 2) => {
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 100000) return n.toExponential(1);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 100) return n.toFixed(1);
  return n.toFixed(digits);
};

const range = "w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-sky-400 [&::-webkit-slider-thumb]:rounded-full";

export const ObjectInspector: React.FC<ObjectInspectorProps> = (props) => {
  const { label, api, info, style, panelRef, onHeaderMouseDown, onClose } = props;
  const [tab, setTab] = useState<'data' | 'edit'>('data');
  const [stats, setStats] = useState<BodyStats | null>(() => api.stats());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<{ speed: number[]; energy: number[]; lastTime: number }>({ speed: [], energy: [], lastTime: -Infinity });

  // A different object starts a fresh graph
  useEffect(() => {
    history.current = { speed: [], energy: [], lastTime: -Infinity };
    setConfirmDelete(false);
    setStats(api.stats());
  }, [label, api]);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) { ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); }
      ctx.stroke();

      const plot = (values: number[], color: string) => {
        if (values.length < 2) return;
        const max = Math.max(...values, 1e-6);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        values.forEach((v, i) => {
          const x = (i / (HISTORY - 1)) * w;
          const y = h - 3 - (Math.max(v, 0) / max) * (h - 6);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      };
      plot(history.current.energy, 'rgba(251,191,36,0.9)');
      plot(history.current.speed, 'rgba(56,189,248,1)');
    };

    const timer = window.setInterval(() => {
      const next = api.stats();
      setStats(next);
      const clock = api.clock();
      const hist = history.current;
      // Rewinding the timeline restarts the graph; a paused simulation adds nothing to it
      if (clock.time < hist.lastTime - 0.05) { hist.speed = []; hist.energy = []; }
      if (next && Math.abs(clock.time - hist.lastTime) > 0.02) {
        hist.speed.push(next.speed);
        hist.energy.push(next.kinetic);
        if (hist.speed.length > HISTORY) { hist.speed.shift(); hist.energy.shift(); }
        hist.lastTime = clock.time;
      }
      draw();
    }, 100);
    draw();
    return () => window.clearInterval(timer);
  }, [api, label, tab]);

  const row = (name: string, value: string, unit: string, accent = 'text-slate-100') => (
    <div className="flex items-baseline justify-between gap-2 text-[11px] leading-tight">
      <span className="text-slate-400">{name}</span>
      <span className={`font-mono tabular-nums ${accent}`}>{value} <span className="text-slate-500">{unit}</span></span>
    </div>
  );

  return (
    <div
      ref={panelRef}
      className="absolute bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden z-20"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="h-8 shrink-0 bg-white/5 border-b border-white/5 flex items-center justify-between px-2.5 cursor-move select-none" onMouseDown={onHeaderMouseDown}>
        <div className="flex items-center gap-1.5 text-slate-200 text-[11px] font-bold tracking-wide overflow-hidden">
          <Box className="w-3.5 h-3.5 shrink-0 text-sky-400" />
          <span className="truncate">{label}</span>
        </div>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="p-1 hover:bg-white/10 rounded text-slate-400" aria-label="Close inspector">
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="flex shrink-0 p-1.5 gap-1 bg-black/20">
        <button onClick={() => setTab('data')} className={`flex-1 py-1 rounded-md text-[10px] font-medium flex items-center justify-center gap-1 ${tab === 'data' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          <Activity className="w-3 h-3" /> Live data
        </button>
        <button onClick={() => setTab('edit')} className={`flex-1 py-1 rounded-md text-[10px] font-medium flex items-center justify-center gap-1 ${tab === 'edit' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          <SlidersHorizontal className="w-3 h-3" /> Edit
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
        {tab === 'data' ? (
          stats ? (
            <>
              {row('Speed', fmt(stats.speed), 'm/s', 'text-sky-300')}
              {row('Velocity x, y, z', `${fmt(stats.vx, 1)}, ${fmt(stats.vy, 1)}, ${fmt(stats.vz, 1)}`, 'm/s')}
              {row('Spin', fmt(stats.spin), 'rad/s')}
              {row('Height', fmt(stats.height), 'm')}
              {info.movable && (
                <>
                  <div className="border-t border-white/5"></div>
                  {row('Mass', fmt(stats.mass), 'kg')}
                  {row('Momentum', fmt(stats.momentum), 'kg·m/s')}
                  {row('Kinetic energy', fmt(stats.kinetic), 'J', 'text-amber-300')}
                  {row('Potential energy', fmt(stats.potential), 'J')}
                  {row('Total energy', fmt(stats.energy), 'J')}
                </>
              )}
              <div className="pt-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                  <span><span className="text-sky-400">━</span> speed <span className="text-amber-400 ml-1.5">━</span> kinetic energy</span>
                  <span>last 12 s</span>
                </div>
                <canvas ref={canvasRef} width={220} height={64} className="w-full h-16 rounded bg-black/30 border border-white/5" />
              </div>
              <p className="text-[10px] leading-snug text-slate-500">
                {stats.asleep ? 'At rest. ' : ''}{info.movable ? '' : 'Fixed in place. '}Figures treat one scene unit as 1 m and one mass unit as 1 kg.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-slate-500">This object is no longer in the scene.</p>
          )
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300"><span>Mass</span><span className="font-mono text-slate-400">{fmt(info.mass)} kg</span></div>
              <input
                type="range" aria-label="Object mass" className={range} disabled={!info.movable}
                min={-2} max={3.5} step={0.01}
                value={Math.log10(Math.max(info.mass, 0.01))}
                onChange={(e) => props.onMass(Math.pow(10, parseFloat(e.target.value)))}
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300"><span>Size</span><span className="font-mono text-slate-400">{info.scale.toFixed(2)}×</span></div>
              <input
                type="range" aria-label="Object size" className={range} disabled={!info.canResize}
                min={0.25} max={3} step={0.05}
                value={info.scale}
                onChange={(e) => props.onScale(parseFloat(e.target.value))}
              />
              {!info.canResize && <p className="text-[10px] text-slate-500">Objects on a rope or hinge, or with a custom shape, keep their size.</p>}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-300"><span>Bounciness</span><span className="font-mono text-slate-400">{info.bounce.toFixed(2)}</span></div>
              <input
                type="range" aria-label="Object bounciness" className={range} disabled={!info.movable}
                min={0} max={1} step={0.05}
                value={Math.min(info.bounce, 1)}
                onChange={(e) => props.onBounce(parseFloat(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex-1 space-y-1">
                <span className="block text-[11px] text-slate-300">Material (sound)</span>
                <select aria-label="Object material"
                  value={info.sound}
                  onChange={(e) => props.onSound(e.target.value as SoundMaterial)}
                  className="w-full bg-slate-800 border border-white/10 rounded px-1.5 py-1 text-[11px] text-slate-200"
                >
                  {SOUND_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-slate-300">Colour</span>
                <input type="color" aria-label="Object colour" value={info.color} onChange={(e) => props.onColor(e.target.value)} className="w-12 h-7 rounded cursor-pointer bg-transparent" />
              </label>
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-slate-300">Rotation</div>
              {(['x', 'y', 'z'] as const).map(axis => (
                <div key={axis} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono w-3 text-slate-500 uppercase">{axis}</span>
                  <input
                    type="range" aria-label={`Rotation ${axis}`} className={range} min={0} max={360}
                    value={info.rotation[axis]}
                    onChange={(e) => props.onRotate(axis, parseFloat(e.target.value))}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 pt-1">
              <button
                onClick={props.onDuplicate}
                disabled={!info.canDuplicate}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-200 border border-white/10 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Copy className="w-3 h-3" /> Duplicate
              </button>
              <button
                onClick={() => { if (confirmDelete) { props.onDelete(); } else { setConfirmDelete(true); } }}
                onBlur={() => setConfirmDelete(false)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-medium border ${confirmDelete ? 'bg-red-600 text-white border-red-400' : 'bg-slate-800 text-red-300 border-white/10 hover:bg-red-950/60'}`}
              >
                <Trash2 className="w-3 h-3" /> {confirmDelete ? 'Click again' : 'Delete'}
              </button>
            </div>
            <p className="text-[10px] leading-snug text-slate-500">Edits last until the scene is reset. Changing size, or adding or removing objects, restarts the replay recording.</p>
          </>
        )}
      </div>
    </div>
  );
};
