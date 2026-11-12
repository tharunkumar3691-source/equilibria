import React, { useEffect, useRef } from 'react';
import { ArrowRight, Check, Coins, HeartHandshake, MessageSquare, Play, ShieldCheck, Sigma, Sparkles, Video } from 'lucide-react';
import { LogoMark } from './Logo';

// The front door: what Equilibria is, shown once before the app opens. Its colours are fixed (a violet
// night), so it looks the same whichever colour theme the app itself is set to.

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Slowly twinkling stars behind the whole page
const Starfield: React.FC = () => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const stars = Array.from({ length: 260 }, () => ({ x: rand(), y: rand(), r: rand() < 0.08 ? 1.4 : 0.8, phase: rand() * Math.PI * 2, speed: 0.4 + rand() * 1.2 }));
    let frame = 0, raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = frame / 60;
      for (const s of stars) {
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = `rgba(235,230,255,${a})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const loop = () => { frame++; draw(); raf = requestAnimationFrame(loop); };
    if (reducedMotion()) draw(); else loop();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-hidden="true" />;
};

// A Newton's cradle that really swings: the end balls follow a pendulum's motion and pass the momentum along
const Cradle: React.FC = () => {
  const strings = useRef<(SVGLineElement | null)[]>([]);
  const balls = useRef<(SVGGElement | null)[]>([]);
  const COUNT = 5, R = 17, GAP = 2 * R, PIVOT_Y = 46, LENGTH = 150, AMPLITUDE = 0.5;
  const left = 200 - ((COUNT - 1) * GAP) / 2;
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const place = (time: number) => {
      const theta = AMPLITUDE * Math.sin(time * 2.6);
      for (let i = 0; i < COUNT; i++) {
        const angle = i === 0 ? Math.min(0, theta) : i === COUNT - 1 ? Math.max(0, theta) : 0;
        const px = left + i * GAP;
        const x = px + LENGTH * Math.sin(angle), y = PIVOT_Y + LENGTH * Math.cos(angle);
        const line = strings.current[i], ball = balls.current[i];
        if (line) { line.setAttribute('x2', String(x)); line.setAttribute('y2', String(y)); }
        if (ball) ball.setAttribute('transform', `translate(${x} ${y})`);
      }
    };
    const loop = (now: number) => { place((now - start) / 1000); raf = requestAnimationFrame(loop); };
    if (reducedMotion()) place(-0.6); else raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const colours = ['#7dd3fc', '#a5b4fc', '#c4b5fd', '#f0abfc', '#f9a8d4'];
  return (
    <svg viewBox="0 0 400 250" className="w-full h-auto" role="img" aria-label="A Newton's cradle swinging">
      <defs>
        {colours.map((c, i) => (
          <radialGradient key={i} id={`ball-${i}`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor={c} />
            <stop offset="100%" stopColor="#2a1b4f" />
          </radialGradient>
        ))}
        <linearGradient id="frame" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f3d79c" />
          <stop offset="100%" stopColor="#c99b57" />
        </linearGradient>
        <radialGradient id="floorGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(138,92,246,0.45)" />
          <stop offset="100%" stopColor="rgba(138,92,246,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="232" rx="170" ry="16" fill="url(#floorGlow)" />
      <path d={`M${left - 102} 236 V${PIVOT_Y - 8} H${400 - left + 102} V236`} fill="none" stroke="url(#frame)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {Array.from({ length: COUNT }, (_, i) => {
        const px = left + i * GAP;
        return (
          <g key={i}>
            <line ref={el => { strings.current[i] = el; }} x1={px} y1={PIVOT_Y - 8} x2={px} y2={PIVOT_Y + LENGTH} stroke="rgba(235,230,255,0.55)" strokeWidth="1" />
            <g ref={el => { balls.current[i] = el; }} transform={`translate(${px} ${PIVOT_Y + LENGTH})`}>
              <circle r={R} fill={`url(#ball-${i})`} />
            </g>
          </g>
        );
      })}
    </svg>
  );
};

// Sections rise into view as they are scrolled to
function useReveal(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const scroller = root.current;
    if (!scroller) return;
    const items: HTMLElement[] = Array.prototype.slice.call(scroller.querySelectorAll('.reveal'));
    if (reducedMotion() || !('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('is-visible')); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); observer.unobserve(e.target); }
    }), { root: scroller, threshold: 0.12 });
    items.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [root]);
}

const FEATURES = [
  { icon: Sigma, title: 'Solve and simulate', text: 'Paste a textbook problem or a photo of one. Gemini solves it step by step, builds the scene without seeing the answer, then measures the answer in the simulation.' },
  { icon: Video, title: 'Video to simulation', text: 'Upload a few seconds of real motion. It is measured and rebuilt as a live 3D scene you can replay and change.' },
  { icon: Sparkles, title: 'Describe a scene', text: '"A heavy ball rolls down a ramp into a stack of crates" becomes a running simulation in moments.' },
  { icon: MessageSquare, title: 'Change it by talking', text: 'Ask for Moon gravity or a heavier ball. Every edit is tested before it is applied.' },
  { icon: ShieldCheck, title: 'Verified or free', text: 'Each scene passes an automatic physics test. If it never does, the credit comes back by itself.' },
  { icon: HeartHandshake, title: 'Pay it forward', text: 'Anyone can fund a shared pool, so a student who cannot pay still gets to learn.' }
];

const STEPS = [
  { n: '01', title: 'Ask', text: 'A problem, a sentence or a short video.' },
  { n: '02', title: 'Built and tested', text: 'Gemini designs the scene; a physics test checks it and repairs what fails.' },
  { n: '03', title: 'Explore', text: 'Pause, rewind, measure with the ruler and stopwatch, and change anything.' }
];

const DEMOS = ["Newton's cradle", 'Domino spiral', 'Solar system', 'Black hole', 'Pendulum wave', 'Loop-the-loop'];

export const Landing: React.FC<{ onEnter: () => void; leaving: boolean }> = ({ onEnter, leaving }) => {
  const scroller = useRef<HTMLDivElement>(null);
  useReveal(scroller);
  const enterButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { enterButton.current?.focus({ preventScroll: true }); }, []);

  const Cta: React.FC<{ big?: boolean; label?: string; innerRef?: React.Ref<HTMLButtonElement> }> = ({ big, label = 'Start simulating', innerRef }) => (
    <button
      ref={innerRef}
      onClick={onEnter}
      className={`landing-cta group inline-flex items-center gap-2 rounded-full font-semibold text-[#120c24] ${big ? 'px-7 py-3.5 text-[15px]' : 'px-5 py-2.5 text-sm'}`}
    >
      {label}
      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  );

  return (
    <div
      ref={scroller}
      className={`landing fixed inset-0 z-[100] overflow-y-auto overflow-x-hidden bg-[#07050f] text-[#e9e4f7] font-sans transition-opacity duration-500 ${leaving ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      {/* Sky: stars and slow nebula glows, fixed while the page scrolls */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute inset-0 landing-nebula" />
        <Starfield />
      </div>

      <div className="relative">
        {/* Top bar */}
        <header className="sticky top-0 z-10 backdrop-blur-md bg-[#07050f]/55 border-b border-[#ffffff]/[0.06]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2.5">
              <LogoMark className="w-7 h-7" />
              <span className="font-display text-[19px] font-medium text-[#ffffff]">Equilibria</span>
            </span>
            <nav className="hidden md:flex items-center gap-7 text-[13.5px] text-[#b9afd2]">
              <a href="#features" className="hover:text-[#ffffff] transition-colors">Features</a>
              <a href="#how" className="hover:text-[#ffffff] transition-colors">How it works</a>
              <a href="#credits" className="hover:text-[#ffffff] transition-colors">Credits</a>
            </nav>
            <Cta label="Open the app" />
          </div>
        </header>

        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-16 sm:pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-10 items-center">
          <div className="reveal">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#8a5cf6]/40 bg-[#8a5cf6]/10 px-3 py-1 text-[12px] text-[#d4c4ff]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#86efac] landing-pulse" />
              Built for the PayPal AI Hackathon
            </div>
            <h1 className="font-display mt-6 text-[44px] leading-[1.04] sm:text-6xl lg:text-[68px] font-medium text-[#ffffff] tracking-tight">
              Physics,<br /><span className="landing-gradient-text">gently revealed.</span>
            </h1>
            <p className="mt-6 text-[17px] leading-relaxed text-[#b9afd2] max-w-xl">
              Turn a textbook problem, a short video or a single sentence into an interactive 3D simulation that is
              <span className="text-[#ffffff]"> checked before you see it</span>. Pause it, rewind it, measure it, and change it by talking to it.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Cta big innerRef={enterButton} />
              <button onClick={onEnter} className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-medium text-[#e9e4f7] border border-[#ffffff]/15 hover:border-[#ffffff]/35 hover:bg-[#ffffff]/[0.04] transition-colors">
                <Play className="w-4 h-4" /> Try a free demo
              </button>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[#9a8fb8]">
              {['12 free demo scenes', 'No sign-up', 'Every scene physics-tested'].map(item => (
                <span key={item} className="inline-flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#86efac]" />{item}</span>
              ))}
            </div>
          </div>

          {/* The app, in miniature */}
          <div className="reveal relative" style={{ transitionDelay: '120ms' }}>
            <div className="absolute -inset-8 rounded-[40px] bg-[radial-gradient(closest-side,rgba(138,92,246,0.35),transparent)] blur-2xl" aria-hidden="true" />
            <div className="relative rounded-2xl border border-[#ffffff]/10 bg-[#0d0a18]/80 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 h-10 border-b border-[#ffffff]/[0.07] bg-[#ffffff]/[0.02]">
                <span className="w-2.5 h-2.5 rounded-full bg-[#c4716b]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#dcb676]/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#86bb90]/80" />
                <span className="ml-3 text-[12px] text-[#9a8fb8]">Newton's Cradle</span>
                <span className="ml-auto text-[11px] font-mono text-[#86efac]">● live</span>
              </div>
              <div className="relative px-6 pt-6 pb-4 landing-scene">
                <Cradle />
              </div>
              <div className="grid grid-cols-3 border-t border-[#ffffff]/[0.07] text-center">
                {[['Physics test', 'Passed'], ['Speed', '1×'], ['Cost', 'Free demo']].map(([k, v]) => (
                  <div key={k} className="py-3 border-r last:border-r-0 border-[#ffffff]/[0.07]">
                    <div className="text-[10.5px] uppercase tracking-wider text-[#7b7099]">{k}</div>
                    <div className="mt-0.5 font-mono text-[13px] text-[#e9e4f7]">{v}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Floating notes */}
            <div className="landing-float hidden sm:block absolute -left-3 sm:-left-8 top-16 rounded-xl border border-[#ffffff]/10 bg-[#151027]/90 backdrop-blur px-3.5 py-2.5 shadow-xl">
              <div className="flex items-center gap-2 text-[12.5px] text-[#ffffff]"><ShieldCheck className="w-4 h-4 text-[#86efac]" /> Physics test passed</div>
              <div className="text-[11px] text-[#9a8fb8] mt-0.5">checked before you see it</div>
            </div>
            <div className="landing-float hidden sm:block absolute -right-2 sm:-right-6 bottom-20 rounded-xl border border-[#ffffff]/10 bg-[#151027]/90 backdrop-blur px-3.5 py-2.5 shadow-xl" style={{ animationDelay: '-3s' }}>
              <div className="flex items-center gap-2 text-[12.5px] text-[#ffffff]"><Coins className="w-4 h-4 text-[#e8cc96]" /> 1 credit, paid with PayPal</div>
              <div className="text-[11px] text-[#9a8fb8] mt-0.5">returned if the physics fails</div>
            </div>
          </div>
        </section>

        {/* Powered by */}
        <section className="border-y border-[#ffffff]/[0.06] bg-[#ffffff]/[0.015]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[13px] text-[#7b7099]">
            <span className="uppercase tracking-[0.18em] text-[11px]">Powered by</span>
            {['PayPal Orders v2 & Webhooks', 'Google Gemini', 'Three.js', 'cannon-es physics'].map(name => (
              <span key={name} className="text-[#b9afd2] font-medium">{name}</span>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 scroll-mt-16">
          <div className="reveal max-w-2xl">
            <div className="text-[12px] uppercase tracking-[0.18em] text-[#b9a0ff]">What it does</div>
            <h2 className="font-display mt-3 text-3xl sm:text-[42px] leading-tight font-medium text-[#ffffff]">A physics lab that builds itself, then proves it works.</h2>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, text }, i) => (
              <div key={title} className="reveal landing-card rounded-2xl p-6" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
                <div className="w-10 h-10 rounded-xl grid place-items-center bg-[#8a5cf6]/15 border border-[#8a5cf6]/30">
                  <Icon className="w-5 h-5 text-[#c4b5fd]" />
                </div>
                <h3 className="mt-5 text-[16.5px] font-semibold text-[#ffffff]">{title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#9a8fb8]">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="relative py-20 sm:py-28 scroll-mt-16">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(138,92,246,0.06),transparent)]" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
            <div className="reveal text-center max-w-2xl mx-auto">
              <div className="text-[12px] uppercase tracking-[0.18em] text-[#b9a0ff]">How it works</div>
              <h2 className="font-display mt-3 text-3xl sm:text-[42px] leading-tight font-medium text-[#ffffff]">From a question to a world you can touch.</h2>
            </div>
            <div className="mt-14 grid md:grid-cols-3 gap-6 md:gap-4 relative">
              <div className="hidden md:block absolute top-7 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-[#8a5cf6]/50 to-transparent" aria-hidden="true" />
              {STEPS.map((s, i) => (
                <div key={s.n} className="reveal relative text-center px-4" style={{ transitionDelay: `${i * 120}ms` }}>
                  <div className="mx-auto w-14 h-14 rounded-full grid place-items-center bg-[#0d0a18] border border-[#8a5cf6]/50 font-mono text-[14px] text-[#d4c4ff] shadow-[0_0_30px_-6px_rgba(138,92,246,0.7)]">{s.n}</div>
                  <h3 className="mt-5 text-[17px] font-semibold text-[#ffffff]">{s.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#9a8fb8] max-w-xs mx-auto">{s.text}</p>
                </div>
              ))}
            </div>
            <div className="reveal mt-14 flex flex-wrap justify-center gap-2">
              {DEMOS.map(name => (
                <span key={name} className="rounded-full border border-[#ffffff]/10 bg-[#ffffff]/[0.03] px-3.5 py-1.5 text-[12.5px] text-[#b9afd2]">{name}</span>
              ))}
              <span className="rounded-full px-3.5 py-1.5 text-[12.5px] text-[#7b7099]">and more, free</span>
            </div>
          </div>
        </section>

        {/* Credits and PayPal */}
        <section id="credits" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 scroll-mt-16">
          <div className="reveal landing-card rounded-3xl p-8 sm:p-12 grid lg:grid-cols-2 gap-10 items-center overflow-hidden relative">
            <div className="absolute -right-24 -top-24 w-80 h-80 rounded-full bg-[radial-gradient(closest-side,rgba(232,204,150,0.18),transparent)]" aria-hidden="true" />
            <div className="relative">
              <div className="text-[12px] uppercase tracking-[0.18em] text-[#e8cc96]">Fair credits</div>
              <h2 className="font-display mt-3 text-3xl sm:text-[40px] leading-tight font-medium text-[#ffffff]">Pay only for physics that checks out.</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-[#b9afd2]">
                Each new scene costs one credit, bought securely through PayPal. Demos, your library and chat edits are free.
                The AI assistant can even pick the right pack for your class and open checkout for you to approve.
              </p>
            </div>
            <ol className="relative space-y-3">
              {[
                ['Buy credits with PayPal', 'Checkout in PayPal’s own window; nothing is charged until you approve.'],
                ['Create a scene', 'One credit is held while Gemini builds and tests it.'],
                ['Passes the test?', 'You keep exploring. If it never passes, the credit is returned automatically.']
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-4 rounded-2xl border border-[#ffffff]/[0.08] bg-[#07050f]/50 p-4">
                  <span className="shrink-0 w-8 h-8 rounded-full grid place-items-center bg-[#e8cc96]/15 text-[#e8cc96] font-mono text-[13px]">{i + 1}</span>
                  <span>
                    <span className="block text-[14.5px] font-semibold text-[#ffffff]">{title}</span>
                    <span className="block mt-1 text-[13.5px] leading-relaxed text-[#9a8fb8]">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing call */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24 text-center">
          <div className="reveal">
            <LogoMark className="w-14 h-14 mx-auto" />
            <h2 className="font-display mt-6 text-3xl sm:text-5xl leading-tight font-medium text-[#ffffff]">See the physics, not just the formula.</h2>
            <p className="mt-4 text-[15.5px] text-[#9a8fb8]">Open a demo in one click. No account needed.</p>
            <div className="mt-8"><Cta big /></div>
          </div>
        </section>

        <footer className="border-t border-[#ffffff]/[0.06]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12.5px] text-[#7b7099]">
            <span className="inline-flex items-center gap-2"><LogoMark className="w-5 h-5" /> Equilibria · Physics, gently revealed</span>
            <span>PayPal payments run in sandbox mode: no real money moves.</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
