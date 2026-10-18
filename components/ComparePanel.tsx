import React, { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2, Film } from 'lucide-react';
import { SimApi } from '../lib/simApi';

interface ComparePanelProps {
  url: string;
  api: SimApi;
  onClose: () => void;
  className?: string;
}

// The uploaded clip beside the simulation, kept in step with the simulation's own clock:
// it plays while the simulation runs, slows down with it, and follows the timeline when scrubbed.
export const ComparePanel: React.FC<ComparePanelProps> = ({ url, api, onClose, className = '' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [large, setLarge] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);

  useEffect(() => { setFailed(false); setEnded(false); }, [url]);

  useEffect(() => {
    const sync = () => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const clock = api.clock();
      const time = Math.max(0, clock.time);
      const last = Math.max(video.duration - 0.05, 0);
      const target = Math.min(time, last);
      setEnded(time > video.duration);

      if (clock.running && time < last) {
        // The browser only supports a limited range of playback speeds
        const rate = Math.min(Math.max(clock.rate, 0.1), 4);
        if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
        if (Math.abs(video.currentTime - target) > 0.35) video.currentTime = target;
        if (video.paused) video.play().catch(() => {});
      } else {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - target) > 0.04) video.currentTime = target;
      }
    };
    const timer = window.setInterval(sync, 100);
    return () => window.clearInterval(timer);
  }, [api, url]);

  return (
    <div
      className={`absolute z-20 flex flex-col overflow-hidden bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl ${className}`}
      style={{ width: large ? 'min(46%, 520px)' : 'min(40%, 230px)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="h-7 shrink-0 bg-white/5 border-b border-white/5 flex items-center justify-between px-2 select-none">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
          <Film className="w-3 h-3 text-sky-400" /> Your video
        </span>
        <span className="flex items-center gap-0.5">
          <button onClick={() => setLarge(!large)} className="p-1 hover:bg-white/10 rounded text-slate-400" title={large ? 'Smaller' : 'Larger'} aria-label={large ? 'Smaller' : 'Larger'}>
            {large ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded text-slate-400" aria-label="Close video comparison">
            <X className="w-3 h-3" />
          </button>
        </span>
      </div>
      {failed ? (
        <p className="p-3 text-[11px] text-slate-400">This browser cannot play the uploaded video format.</p>
      ) : (
        <div className="relative bg-black">
          <video ref={videoRef} src={url} muted playsInline preload="auto" className="block w-full max-h-[46vh] object-contain" onError={() => setFailed(true)} />
          {ended && (
            <span className="absolute bottom-1 right-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-slate-300">
              clip ended
            </span>
          )}
        </div>
      )}
    </div>
  );
};
