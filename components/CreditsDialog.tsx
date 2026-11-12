import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Coins, X, Check, ShieldCheck, RotateCcw, Sparkles, AlertCircle, HeartHandshake, Gift, GraduationCap, Zap, Lock, ArrowRight } from 'lucide-react';
import {
  Balance, capturePayPalOrder, claimFromPool, createPayPalOrder, CreditError, CreditStatus, loadPayPalSdk, PreparedOrder, Purpose
} from '../lib/credits';

export interface CreditsRequest {
  reason: 'browse' | 'empty';      // Opened from the balance, or because a generation needed a credit
  purpose?: Purpose;               // Buying for yourself, or sponsoring the student pool
  pack?: string;
  order?: PreparedOrder;           // An order the assistant already created: the PayPal buttons pay exactly this one
}

interface CreditsDialogProps {
  status: CreditStatus | null;
  request: CreditsRequest;
  onBalance: (balance: Balance) => void;
  onPaid: (balance: Balance, added: number, purpose: Purpose) => void;
  onClose: () => void;
}

// How each pack looks: its own colours and icon, so the choice reads at a glance
const PACK_LOOK: Record<string, { icon: React.ElementType; from: string; to: string; ring: string; text: string }> = {
  starter: { icon: Zap, from: '#4f9c90', to: '#5f9fbc', ring: '#86cbbf', text: '#ade0d6' },
  class: { icon: GraduationCap, from: '#9083c6', to: '#c99b57', ring: '#c7bce8', text: '#ddd6f1' },
};
const SPONSOR_LOOK = { from: '#c4716b', to: '#6aa276', ring: '#e5aca6', text: '#f1cfcb' };
const lookOf = (id: string, sponsoring: boolean) => {
  const base = PACK_LOOK[id] ?? PACK_LOOK.starter;
  return sponsoring ? { ...base, ...SPONSOR_LOOK } : base;
};

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A number that counts up to its value once (skipped when the visitor asks for less motion)
const CountUp: React.FC<{ value: number }> = ({ value }) => {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  useEffect(() => {
    if (reducedMotion()) { setShown(value); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}</>;
};

// A short shower of confetti in the app's colours: CSS only, a few dozen pieces, gone in under three seconds
const CONFETTI_COLOURS = ['#86cbbf', '#e8cc96', '#c7bce8', '#e5aca6', '#a9d1b0', '#a3cde0'];
const Confetti: React.FC = () => {
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.35,
    duration: 1.6 + Math.random() * 1.1,
    drift: (Math.random() - 0.5) * 120,
    spin: (Math.random() - 0.5) * 720,
    size: 5 + Math.random() * 5,
    colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
    round: i % 3 === 0,
  })), []);
  if (reducedMotion()) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.colour,
            borderRadius: p.round ? '50%' : 2, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
            ['--drift' as string]: `${p.drift}px`, ['--spin' as string]: `${p.spin}deg`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
};

// Buying credits with PayPal (sandbox), for yourself or for students who cannot pay. Orders are created and
// captured by the server; the page only shows PayPal's own buttons and window, so no payment details ever
// pass through Equilibria.
export const CreditsDialog: React.FC<CreditsDialogProps> = ({ status, request, onBalance, onPaid, onClose }) => {
  const [purpose, setPurpose] = useState<Purpose>(request.order?.purpose ?? request.purpose ?? 'self');
  const [packId, setPackId] = useState(request.order?.pack ?? request.pack ?? status?.packs[0]?.id ?? 'starter');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'paying' | 'done' | 'unavailable'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; purpose: Purpose } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  // The assistant's order is used once, and only while the same pack and purpose are chosen
  const prepared = useRef<PreparedOrder | null>(request.order ?? null);
  // PayPal's buttons are drawn once; they read the current choice when clicked, so changing the pack or
  // who it is for is instant instead of reloading PayPal
  const choice = useRef({ packId, purpose });
  choice.current = { packId, purpose };

  // Escape closes, as with the other dialogs (not in the middle of confirming a payment)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'paying') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  // PayPal's buttons, drawn once for the whole dialog
  useEffect(() => {
    if (!status?.paypal) {
      if (!status) setMessage('Could not reach the Equilibria server. Check your connection and reload the page.');
      setPhase('unavailable');
      return;
    }
    if (phase === 'done') return;
    let buttons: any = null;
    let gone = false;
    setPhase('loading');
    loadPayPalSdk(status.paypal.clientId).then(paypal => {
      if (gone || !holder.current) return;
      holder.current.innerHTML = '';
      buttons = paypal.Buttons({
        style: { layout: 'vertical', shape: 'pill', color: 'gold', label: 'pay', height: 44, tagline: false },
        createOrder: async () => {
          setMessage(null);
          const { packId: chosenPack, purpose: chosenPurpose } = choice.current;
          const ready = prepared.current;
          prepared.current = null;
          if (ready && ready.pack === chosenPack && ready.purpose === chosenPurpose) return ready.id;
          try { return (await createPayPalOrder(chosenPack, chosenPurpose)).id; }
          catch (error: any) { setMessage(error.message); throw error; }
        },
        onApprove: async (data: { orderID: string }, actions: any) => {
          setPhase('paying');
          try {
            const paid = await capturePayPalOrder(data.orderID);
            setResult({ added: paid.added || 0, purpose: paid.purpose });
            setPhase('done');
            onPaid(paid, paid.added || 0, paid.purpose);
          } catch (error: any) {
            // A declined card or balance: PayPal lets the buyer pick another way to pay in the same window
            if (error instanceof CreditError && error.code === 'INSTRUMENT_DECLINED') return actions.restart();
            if (error instanceof CreditError && error.balance) onBalance(error.balance);
            setMessage(error.message);
            setPhase('ready');
          }
        },
        onCancel: () => setMessage('Payment cancelled. Nothing was charged.'),
        onError: (error: any) => {
          console.error('[PayPal]', error);
          // PayPal's own words help a tester see what went wrong (a sandbox login, a blocked window...)
          const detail = String(error?.message || error || '').split('\n')[0].slice(0, 160);
          setMessage(prev => prev || `PayPal could not finish the payment${detail ? ` (${detail})` : ''}. Please try again.`);
          setPhase('ready');
        },
      });
      if (buttons.isEligible && !buttons.isEligible()) {
        setMessage('PayPal checkout is not available in this browser. Try another browser, or turn off content blockers for this page.');
        setPhase('unavailable');
        return;
      }
      buttons.render(holder.current)
        .then(() => { if (!gone) setPhase('ready'); })
        .catch((error: any) => {
          if (gone) return;
          console.error('[PayPal] Could not show the buttons', error);
          setMessage('PayPal could not be shown. Reload the page and try again.');
          setPhase('unavailable');
        });
    }).catch((error: Error) => { if (!gone) { setMessage(error.message); setPhase('unavailable'); } });
    return () => { gone = true; try { buttons?.close?.(); } catch {} };
  }, [status?.paypal?.clientId]);

  const claim = async () => {
    setClaiming(true);
    setMessage(null);
    try {
      const claimed = await claimFromPool();
      onBalance(claimed);
      setResult({ added: claimed.claimed, purpose: 'self' });
      setPhase('done');
    } catch (error: any) {
      if (error instanceof CreditError && error.balance) onBalance(error.balance);
      setMessage(error.message);
    } finally {
      setClaiming(false);
    }
  };

  const credits = status?.credits ?? 0;
  const pool = status?.pool;
  const canClaim = !!pool && credits === 0 && pool.credits > 0 && pool.claimable > 0;
  const packs = status?.packs ?? [];
  const pack = packs.find(p => p.id === packId);
  const sponsoring = purpose === 'pool';
  const look = lookOf(packId, sponsoring);
  // The best price per credit, to mark the pack that saves the most
  const perCredit = (p: { price: string; credits: number }) => Number(p.price) / p.credits;
  const dearest = packs.length ? Math.max(...packs.map(perCredit)) : 0;
  const busy = phase === 'paying';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md" onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label="Credits">
      <div
        className="relative w-full max-w-[460px] max-h-[94vh] overflow-y-auto overflow-x-hidden rounded-[28px] border border-white/[0.09] bg-slate-900 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] credits-rise"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero: the balance as a glowing orb, tinted by what is being chosen */}
        <div
          className="relative px-6 pt-5 pb-5 overflow-hidden transition-[background] duration-500"
          style={{ background: `radial-gradient(90% 150% at 0% 0%, ${look.from}75 0%, transparent 60%), radial-gradient(80% 140% at 100% 0%, ${look.to}66 0%, transparent 62%), radial-gradient(60% 90% at 55% 120%, #dcb67633 0%, transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.04), transparent)` }}
        >
          <button onClick={onClose} disabled={busy} className="absolute top-4 right-4 z-10 p-2 rounded-full text-slate-300 bg-black/20 hover:text-white hover:bg-black/35 disabled:opacity-40" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0 w-[72px] h-[72px]" aria-label={`Your balance: ${credits} ${credits === 1 ? 'credit' : 'credits'}`}>
              <div className="absolute inset-0 rounded-full credits-orb" style={{ background: `conic-gradient(from 0deg, ${look.from}, ${look.to}, #e8cc96, ${look.ring}, ${look.from})`, boxShadow: `0 0 28px -4px ${look.from}` }}></div>
              <div className="absolute inset-[4px] rounded-full bg-slate-900/95 flex flex-col items-center justify-center">
                <span className="font-display text-2xl leading-none text-slate-50 tabular-nums">{credits}</span>
                <span className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400">{credits === 1 ? 'credit' : 'credits'}</span>
              </div>
            </div>
            <div className="min-w-0 pr-8">
              <h2 className="font-display text-[22px] leading-tight text-slate-50">
                {phase === 'done' ? 'All set' : sponsoring ? 'Sponsor a student' : request.reason === 'empty' ? 'Top up to keep creating' : 'Power up your physics'}
              </h2>
              <p className="mt-1 text-[13px] leading-snug text-slate-300/90">
                {phase === 'done'
                  ? (sponsoring ? 'Thank you for helping students keep learning.' : 'Thank you. Your payment went through with PayPal.')
                  : sponsoring
                  ? 'Your credits go to the student pool, for learners who cannot pay.'
                  : 'Each credit lights up one new simulation or solved problem. Demos and edits are free.'}
              </p>
            </div>
          </div>
        </div>

        {phase === 'done' && result ? (
          /* Success: a moment of celebration, then straight back to work */
          <div className="relative px-6 pt-4 pb-7 text-center" role="status">
            <Confetti />
            <div
              className="relative mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full credits-pop"
              style={{ background: `radial-gradient(circle at 30% 30%, ${look.ring}, ${look.from})`, boxShadow: `0 0 40px -6px ${look.from}` }}
            >
              {result.purpose === 'pool' ? <HeartHandshake className="w-9 h-9 text-white" /> : <Check className="w-10 h-10 text-white" strokeWidth={2.5} />}
            </div>
            <p className="font-display text-4xl text-slate-50 tabular-nums">+<CountUp value={result.added} /></p>
            <p className="mt-1 text-[15px] text-slate-200">
              {result.purpose === 'pool' ? 'credits given to students' : result.added === 1 ? 'credit added' : 'credits added'}
            </p>
            <p className="mt-3 text-[13px] text-slate-400">
              {result.purpose === 'pool'
                ? <>The student pool now holds <span className="text-slate-100 font-medium tabular-nums">{pool?.credits ?? result.added}</span> credits. Thank you for paying it forward.</>
                : <>Your balance is now <span className="text-slate-100 font-medium tabular-nums">{credits}</span> credits.</>}
            </p>
            <button
              onClick={onClose}
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full text-white text-sm font-semibold shadow-calm hover:brightness-110"
              style={{ background: `linear-gradient(135deg, ${look.from}, ${look.to})` }}
              autoFocus
            >
              {result.purpose === 'pool' ? 'Back to the app' : 'Start creating'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="px-5 sm:px-6 pt-4 pb-5 space-y-4">
            {/* A student with none left: today's free share of the pool comes first */}
            {pool && canClaim && (
              <div className="flex items-center gap-3 rounded-2xl p-3.5 border border-emerald-300/25" style={{ background: 'linear-gradient(135deg, rgba(106,162,118,0.18), rgba(79,156,144,0.08))' }}>
                <span className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/20"><Gift className="w-4.5 h-4.5 text-emerald-200" /></span>
                <p className="min-w-0 flex-1 text-[13px] leading-snug text-slate-100">Sponsors left <span className="font-semibold tabular-nums">{pool.credits}</span> free credits for students. Take today’s share.</p>
                <button onClick={claim} disabled={claiming} className="shrink-0 px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white text-[12px] font-semibold disabled:opacity-50">
                  {claiming ? 'Taking…' : `Take ${Math.min(pool.claimable, pool.credits)}`}
                </button>
              </div>
            )}

            {/* Who it is for: a segmented switch whose highlight takes the colour of the choice */}
            <div className="relative grid grid-cols-2 p-1 rounded-2xl bg-black/25 border border-white/[0.05]" role="tablist" aria-label="Who the credits are for">
              <span
                className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-xl transition-all duration-300 ease-out"
                style={{ left: sponsoring ? 'calc(50% + 0px)' : '4px', background: sponsoring ? 'linear-gradient(135deg, rgba(196,113,107,0.45), rgba(106,162,118,0.35))' : 'linear-gradient(135deg, rgba(79,156,144,0.45), rgba(95,159,188,0.35))' }}
                aria-hidden="true"
              ></span>
              {([['self', 'For me', Coins], ['pool', 'Sponsor students', HeartHandshake]] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={purpose === id}
                  onClick={() => setPurpose(id)}
                  disabled={busy}
                  className={`relative z-10 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${purpose === id ? 'text-white' : 'text-slate-400 hover:text-slate-100'}`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            {/* The packs: colourful cards, the best value marked */}
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Credit pack">
              {packs.map(p => {
                const selected = p.id === packId;
                const pl = lookOf(p.id, sponsoring);
                const Icon = sponsoring ? HeartHandshake : (PACK_LOOK[p.id] ?? PACK_LOOK.starter).icon;
                const saving = dearest ? Math.round((1 - perCredit(p) / dearest) * 100) : 0;
                return (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPackId(p.id)}
                    disabled={busy}
                    className={`group relative text-left rounded-2xl p-3.5 pt-4 border transition-all duration-300 ${selected ? 'scale-[1.02]' : 'hover:-translate-y-0.5 opacity-90 hover:opacity-100'}`}
                    style={{
                      background: `linear-gradient(160deg, ${pl.from}${selected ? '55' : '2b'} 0%, ${pl.to}${selected ? '33' : '17'} 100%)`,
                      borderColor: selected ? pl.ring : 'rgba(255,255,255,0.07)',
                      boxShadow: selected ? `0 12px 30px -14px ${pl.from}, inset 0 0 0 1px ${pl.ring}55` : undefined,
                    }}
                  >
                    {saving > 0 && (
                      <span className="absolute -top-2.5 right-2.5 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-slate-900 shadow-sm" style={{ background: 'linear-gradient(135deg, #f1dfb9, #dcb676)' }} title={`Best value: ${saving}% less per credit`}>
                        Best value · −{saving}%
                      </span>
                    )}
                    <span className="flex items-center justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${pl.from}40`, color: pl.text }}><Icon className="w-4 h-4" /></span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${selected ? 'border-transparent' : 'border-white/20'}`} style={selected ? { background: pl.ring } : undefined}>
                        {selected && <Check className="w-3 h-3 text-slate-900" strokeWidth={3} />}
                      </span>
                    </span>
                    <span className="mt-2.5 block text-[12px] font-medium" style={{ color: pl.text }}>{p.label}</span>
                    <span className="block font-display text-[26px] leading-tight text-slate-50 tabular-nums">{p.credits}<span className="ml-1 text-[14px] text-slate-300">credits</span></span>
                    <span className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[17px] font-semibold text-white tabular-nums">${p.price}</span>
                      <span className="text-[11px] text-slate-400 tabular-nums">${perCredit(p).toFixed(2)} each</span>
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-snug text-slate-400">
                      {sponsoring ? `${p.credits} scenes for students who cannot pay` : p.note}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* What happens when you pay */}
            {pack && (
              <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 bg-slate-950/50 border border-white/[0.06]">
                <span className="text-[13px] text-slate-300">
                  {sponsoring ? <>Student pool <span className="tabular-nums text-slate-400">{pool?.credits ?? 0}</span></> : <>Your balance <span className="tabular-nums text-slate-400">{credits}</span></>}
                  <ArrowRight className="inline w-3.5 h-3.5 mx-1.5 -mt-0.5 text-slate-500" />
                  <span className="font-semibold tabular-nums" style={{ color: look.text }}>{(sponsoring ? pool?.credits ?? 0 : credits) + pack.credits}</span>
                </span>
                <span className="text-[13px] font-semibold text-white tabular-nums">${pack.price}</span>
              </div>
            )}

            {message && (
              <div className="flex items-start gap-2 text-[12px] text-red-200 bg-red-400/[0.08] border border-red-300/20 rounded-xl p-3" role="alert">
                <AlertCircle className="w-4 h-4 mt-px shrink-0" /> <span>{message}</span>
              </div>
            )}

            {phase === 'unavailable' ? (
              <p className="text-[12px] text-amber-200/90 bg-amber-400/[0.07] p-3 rounded-xl border border-amber-300/15">
                {status?.paypal || !status ? 'PayPal checkout is not available right now.' : 'PayPal is not set up on this server yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) and restart it.'}
              </p>
            ) : (
              <div className="relative min-h-[118px]">
                {(phase === 'loading' || busy) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-900/85 text-[13px] text-slate-200">
                    <span className="h-6 w-6 rounded-full border-2 border-white/15 animate-spin" style={{ borderTopColor: look.ring }}></span>
                    {busy ? 'Confirming your payment with PayPal…' : 'Loading secure checkout…'}
                  </div>
                )}
                {/* PayPal follows the app's dark colour scheme (its card form has dark fields), so its
                    buttons sit on a dark panel that matches them */}
                <div ref={holder} className="rounded-2xl bg-[#121718] border border-white/[0.08] p-3 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]" aria-label={pack ? `Pay $${pack.price} with PayPal` : 'Pay with PayPal'}></div>
              </div>
            )}

            {/* Reassurance, in three short badges */}
            <div className="flex flex-wrap justify-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-emerald-200 bg-emerald-400/[0.09] border border-emerald-300/15" title="If a generated scene never passes its physics check, its credit comes back by itself">
                <RotateCcw className="w-3 h-3" /> Verified or free
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-sky-200 bg-sky-400/[0.09] border border-sky-300/15" title="Payment details stay with PayPal; Equilibria only sees that the order was paid">
                <Lock className="w-3 h-3" /> Secured by PayPal
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-amber-200 bg-amber-400/[0.09] border border-amber-300/15" title="This demo uses PayPal's sandbox: test accounts and test cards, no real money">
                <ShieldCheck className="w-3 h-3" /> Sandbox: no real money
              </span>
            </div>

            {pool && !canClaim && pool.donated > 0 && !sponsoring && (
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <Sparkles className="w-3 h-3 text-rose-300/80" />
                {pool.sponsors} {pool.sponsors === 1 ? 'sponsor has' : 'sponsors have'} given {pool.donated} credits to students so far
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
