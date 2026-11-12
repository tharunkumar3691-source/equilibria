import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Coins, X, Check, ShieldCheck, RotateCcw, Sparkles, AlertCircle, HeartHandshake, Gift, GraduationCap, Zap, Lock, ArrowRight, Users, CreditCard, Copy, Receipt as ReceiptIcon, ChevronDown
} from 'lucide-react';
import { CardWindow } from './CardWindow';
import {
  Balance, capturePayPalOrder, claimFromPool, createPayPalOrder, CreditError, CreditStatus, loadPayPalSdk, PreparedOrder, Purchase, Purpose
} from '../lib/credits';

const paidOn = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// A PayPal id that can be copied with one click (a tester can look it up in the PayPal sandbox dashboard)
const PayPalId: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-t border-white/[0.06] first:border-t-0">
      <span className="text-[12.5px] text-slate-400 shrink-0">{label}</span>
      <button onClick={copy} className="min-w-0 inline-flex items-center gap-1.5 font-mono text-[12.5px] text-slate-100 hover:text-white" title={`Copy ${label.toLowerCase()}`}>
        <span className="truncate">{value}</span>
        {copied ? <Check className="w-3.5 h-3.5 shrink-0 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 shrink-0 text-slate-500" />}
      </button>
    </div>
  );
};

// The receipt shown once a payment is captured
const Receipt: React.FC<{ purchase: Purchase }> = ({ purchase }) => (
  <div className="mt-6 mx-auto max-w-[420px] text-left rounded-2xl border border-white/[0.09] bg-slate-950/50 overflow-hidden">
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/[0.03] border-b border-white/[0.07]">
      <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-100"><ReceiptIcon className="w-4 h-4 text-amber-200" /> PayPal receipt</span>
      <span className="text-[11.5px] px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-200 border border-emerald-300/20">Completed</span>
    </div>
    <div className="px-4 py-2">
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-[13.5px] text-slate-200">{purchase.purpose === 'pool' ? `Gift to students · ${purchase.credits} credits` : `${purchase.pack} · ${purchase.credits} credits`}</span>
        <span className="text-[15px] font-semibold text-white tabular-nums">${purchase.amount} {purchase.currency}</span>
      </div>
      <PayPalId label="Transaction ID" value={purchase.captureId} />
      <PayPalId label="Order ID" value={purchase.orderId} />
      <div className="flex items-center justify-between gap-3 py-2 border-t border-white/[0.06]">
        <span className="text-[12.5px] text-slate-400">Paid</span>
        <span className="text-[12.5px] text-slate-200">{paidOn(purchase.paidAt)} · PayPal sandbox</span>
      </div>
    </div>
  </div>
);

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
  starter: { icon: Zap, from: '#8a5cf6', to: '#b964d3', ring: '#b9a0ff', text: '#d4c4ff' },
  class: { icon: GraduationCap, from: '#ae6ae3', to: '#c99b57', ring: '#dcb4f7', text: '#ecd5fb' },
};
const SPONSOR_LOOK = { from: '#c4716b', to: '#6aa276', ring: '#e5aca6', text: '#f1cfcb' };
const lookOf = (id: string, sponsoring: boolean) => {
  const base = PACK_LOOK[id] ?? PACK_LOOK.starter;
  return sponsoring ? { ...base, ...SPONSOR_LOOK } : base;
};

// A pack's tint as text: blended toward the theme's strongest text colour, so it reads on dark and light themes
const tinted = (hex: string) => `color-mix(in oklab, ${hex} 55%, var(--color-slate-50))`;

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
const CONFETTI_COLOURS = ['#b9a0ff', '#e8cc96', '#dcb4f7', '#e5aca6', '#a9d1b0', '#b3bbf6'];
const Confetti: React.FC = () => {
  const pieces = useMemo(() => Array.from({ length: 40 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.35,
    duration: 1.6 + Math.random() * 1.1,
    drift: (Math.random() - 0.5) * 140,
    spin: (Math.random() - 0.5) * 720,
    size: 6 + Math.random() * 5,
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

const DECLINED = 'This card was declined. Try another card.';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Buying credits with PayPal (sandbox), for yourself or as a gift to students who cannot pay. Orders are
// created and captured by the server; the page only shows PayPal's own buttons and window, so no payment
// details ever pass through Equilibria.
export const CreditsDialog: React.FC<CreditsDialogProps> = ({ status, request, onBalance, onPaid, onClose }) => {
  const [purpose, setPurpose] = useState<Purpose>(request.order?.purpose ?? request.purpose ?? 'self');
  const [packId, setPackId] = useState(request.order?.pack ?? request.pack ?? status?.packs[0]?.id ?? 'starter');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'paying' | 'done' | 'unavailable'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; purpose: Purpose; receipt?: Purchase } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  // The assistant's order is used once, and only while the same pack and purpose are chosen
  const prepared = useRef<PreparedOrder | null>(request.order ?? null);
  // PayPal's buttons are drawn once; they read the current choice when clicked, so changing the pack or
  // who it is for is instant instead of reloading PayPal
  const choice = useRef({ packId, purpose });
  choice.current = { packId, purpose };
  const [sdk, setSdk] = useState<any>(null);          // PayPal's SDK, once loaded
  const [cardOpen, setCardOpen] = useState(false);    // The "Pay by card" window

  // The order for the current choice: the assistant's prepared one when it matches, else a new one
  const createOrderId = async () => {
    setMessage(null);
    const { packId: chosenPack, purpose: chosenPurpose } = choice.current;
    const ready = prepared.current;
    prepared.current = null;
    if (ready && ready.pack === chosenPack && ready.purpose === chosenPurpose) return ready.id;
    try { return (await createPayPalOrder(chosenPack, chosenPurpose)).id; }
    catch (error: any) { setMessage(error.message); throw error; }
  };

  // Captures an approved order and shows the result; returns a message when it did not go through
  const approve = async (orderId: string): Promise<string | null> => {
    setPhase('paying');
    try {
      const paid = await capturePayPalOrder(orderId);
      // The receipt: the server's record of this order, else what the capture just said
      const receipt = paid.purchases?.find(p => p.orderId === orderId) ?? (paid.captureId ? {
        orderId, captureId: paid.captureId, pack: pack?.label ?? '', credits: paid.added || 0, amount: pack?.price ?? '',
        currency: 'USD', purpose: paid.purpose, paidAt: Date.now(),
      } : undefined);
      setResult({ added: paid.added || 0, purpose: paid.purpose, receipt });
      setCardOpen(false);
      setPhase('done');
      onPaid(paid, paid.added || 0, paid.purpose);
      return null;
    } catch (error: any) {
      if (error instanceof CreditError && error.balance) onBalance(error.balance);
      setPhase('ready');
      return error instanceof CreditError && error.code === 'INSTRUMENT_DECLINED'
        ? DECLINED
        : error.message || 'The payment could not be confirmed. Please try again.';
    }
  };
  const handlers = useRef({ createOrderId, approve });
  handlers.current = { createOrderId, approve };

  // Escape closes the card window first, then this one (not in the middle of confirming a payment)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || phase === 'paying') return;
      if (cardOpen) setCardOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase, cardOpen]);

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
      setSdk(paypal);
      // Only the PayPal button here: cards are paid in their own window (the button under this one)
      buttons = paypal.Buttons({
        fundingSource: paypal.FUNDING.PAYPAL,
        style: { layout: 'vertical', shape: 'pill', color: 'gold', label: 'pay', height: 50, tagline: false },
        createOrder: () => handlers.current.createOrderId(),
        onApprove: async (data: { orderID: string }, actions: any) => {
          const problem = await handlers.current.approve(data.orderID);
          if (!problem) return;
          // A declined balance or card: PayPal lets the buyer pick another way to pay in the same window
          if (problem === DECLINED) return actions.restart();
          setMessage(problem);
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
  const poolCredits = pool?.credits ?? 0;
  const perDay = Math.max(1, pool?.perDay ?? 2);
  // How many students a number of credits gives a free day of study (their daily share each)
  const studentDays = (n: number) => Math.max(1, Math.floor(n / perDay));
  const canClaim = !!pool && credits === 0 && pool.credits > 0 && pool.claimable > 0;
  const packs = status?.packs ?? [];
  const purchases = status?.purchases ?? [];
  const pack = packs.find(p => p.id === packId);
  const sponsoring = purpose === 'pool';
  const look = lookOf(packId, sponsoring);
  // The best price per credit, to mark the pack that saves the most
  const perCredit = (p: { price: string; credits: number }) => Number(p.price) / p.credits;
  const dearest = packs.length ? Math.max(...packs.map(perCredit)) : 0;
  const busy = phase === 'paying';
  const done = phase === 'done' && !!result;
  const gaveToPool = done && result?.purpose === 'pool';
  // The ring shows what this choice changes: your balance, or the students' pool
  const orbShowsPool = done ? gaveToPool : sponsoring;
  const orbValue = orbShowsPool ? poolCredits : credits;

  const title = done
    ? (gaveToPool ? 'Thank you, sponsor' : 'All set')
    : sponsoring ? 'Gift credits to students' : request.reason === 'empty' ? 'Top up to keep creating' : 'Power up your physics';
  const subtitle = done
    ? (gaveToPool ? 'Your gift is in the student pool, ready for the next student who runs out.' : 'Your payment went through with PayPal.')
    : sponsoring
      ? 'Pay for credits that students who cannot pay will use for free.'
      : 'One credit makes one new simulation or solves one problem. Demos and edits are free.';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-5 bg-slate-950/75 backdrop-blur-md" onClick={() => !busy && onClose()} role="dialog" aria-modal="true" aria-label={sponsoring ? 'Gift credits to students' : 'Credits'}>
      <div
        className="relative w-full max-w-[580px] max-h-[96vh] overflow-y-auto overflow-x-hidden rounded-[30px] border border-white/[0.09] bg-slate-900 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] credits-rise"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero: the balance (or the students' pool) as a glowing ring, tinted by what is being chosen */}
        <div
          className="relative px-5 sm:px-8 pt-6 sm:pt-7 pb-6 overflow-hidden transition-[background] duration-500"
          style={{ background: `radial-gradient(90% 150% at 0% 0%, ${look.from}75 0%, transparent 60%), radial-gradient(80% 140% at 100% 0%, ${look.to}66 0%, transparent 62%), radial-gradient(60% 90% at 55% 120%, #dcb67633 0%, transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.04), transparent)` }}
        >
          <button onClick={onClose} disabled={busy} className="absolute top-4 right-4 z-10 p-2.5 rounded-full text-slate-200 bg-black/25 hover:text-white hover:bg-black/40 disabled:opacity-40" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4 sm:gap-5">
            <div
              className="relative shrink-0 w-[84px] h-[84px] sm:w-[100px] sm:h-[100px]"
              aria-label={orbShowsPool ? `Student pool: ${plural(orbValue, 'credit', 'credits')}` : `Your balance: ${plural(orbValue, 'credit', 'credits')}`}
            >
              <div className="absolute inset-0 rounded-full credits-orb" style={{ background: `conic-gradient(from 0deg, ${look.from}, ${look.to}, #e8cc96, ${look.ring}, ${look.from})`, boxShadow: `0 0 32px -4px ${look.from}` }}></div>
              <div className="absolute inset-[5px] rounded-full bg-slate-900/95 flex flex-col items-center justify-center">
                <span className="font-display text-[30px] sm:text-[36px] leading-none text-slate-50 tabular-nums">{orbValue}</span>
                <span className="mt-1 text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-slate-300">
                  {orbShowsPool ? 'in pool' : orbValue === 1 ? 'credit' : 'credits'}
                </span>
              </div>
            </div>
            <div className="min-w-0 pr-9">
              <h2 className="font-display text-[24px] sm:text-[30px] leading-[1.15] text-slate-50">{title}</h2>
              <p className="mt-1.5 text-[14px] sm:text-[15px] leading-snug text-slate-200/90">{subtitle}</p>
            </div>
          </div>
        </div>

        {done && result ? (
          /* Success: a moment of celebration, then straight back to work */
          <div className="relative px-6 sm:px-8 pt-5 pb-8 text-center" role="status">
            <Confetti />
            <div
              className="relative mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full credits-pop"
              style={{ background: `radial-gradient(circle at 30% 30%, ${look.ring}, ${look.from})`, boxShadow: `0 0 44px -6px ${look.from}` }}
            >
              {gaveToPool ? <HeartHandshake className="w-11 h-11 text-white" /> : <Check className="w-12 h-12 text-white" strokeWidth={2.5} />}
            </div>
            <p className="font-display text-5xl text-slate-50 tabular-nums">+<CountUp value={result.added} /></p>
            <p className="mt-1.5 text-[17px] text-slate-100">
              {gaveToPool ? 'credits gifted to students' : result.added === 1 ? 'credit added' : 'credits added'}
            </p>
            <p className="mt-3 mx-auto max-w-[400px] text-[15px] leading-relaxed text-slate-300">
              {gaveToPool
                ? <>The student pool now holds <b className="text-slate-50 tabular-nums">{plural(poolCredits, 'credit', 'credits')}</b>: a free day of physics for about <b className="text-slate-50 tabular-nums">{plural(studentDays(poolCredits), 'student', 'students')}</b>.</>
                : <>Your balance is now <b className="text-slate-50 tabular-nums">{plural(credits, 'credit', 'credits')}</b>.</>}
            </p>
            {result.receipt && <Receipt purchase={result.receipt} />}
            <button
              onClick={onClose}
              className="mt-7 inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-white text-[16px] font-semibold shadow-calm hover:brightness-110"
              style={{ background: `linear-gradient(135deg, ${look.from}, ${look.to})` }}
              autoFocus
            >
              {gaveToPool ? 'Back to the app' : 'Start creating'} <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="px-4 sm:px-8 pt-5 pb-6 space-y-5">
            {/* A student with none left: today's free share of the pool comes first */}
            {pool && canClaim && (
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 rounded-2xl p-4 border border-emerald-300/30" style={{ background: 'linear-gradient(135deg, rgba(106,162,118,0.22), rgba(138,92,246,0.1))' }}>
                <span className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-400/20"><Gift className="w-5 h-5 text-emerald-200" /></span>
                <p className="min-w-0 flex-1 text-[15px] leading-snug text-slate-100">
                  <b className="font-semibold">Free for students.</b> Sponsors have left {plural(pool.credits, 'credit', 'credits')}; you can take {Math.min(pool.claimable, pool.credits)} today.
                </p>
                <button onClick={claim} disabled={claiming} className="shrink-0 w-full sm:w-auto px-5 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white text-[15px] font-semibold disabled:opacity-50">
                  {claiming ? 'Taking…' : `Take ${Math.min(pool.claimable, pool.credits)} free`}
                </button>
              </div>
            )}

            {/* Who it is for: a segmented switch whose highlight takes the colour of the choice */}
            <div className="relative grid grid-cols-2 p-1.5 rounded-2xl bg-black/25 border border-white/[0.06]" role="tablist" aria-label="Who the credits are for">
              <span
                className="absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] rounded-xl transition-all duration-300 ease-out"
                style={{ left: sponsoring ? '50%' : '6px', background: sponsoring ? 'linear-gradient(135deg, rgba(196,113,107,0.5), rgba(106,162,118,0.4))' : 'linear-gradient(135deg, rgba(138,92,246,0.5), rgba(185,100,211,0.4))' }}
                aria-hidden="true"
              ></span>
              {([['self', 'For me', Coins], ['pool', 'Gift to students', HeartHandshake]] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={purpose === id}
                  onClick={() => setPurpose(id)}
                  disabled={busy}
                  className={`relative z-10 flex items-center justify-center gap-2 py-3 rounded-xl text-[15px] font-semibold transition-colors ${purpose === id ? 'text-white' : 'text-slate-300 hover:text-white'}`}
                >
                  <Icon className="w-[18px] h-[18px]" /> {label}
                </button>
              ))}
            </div>

            {/* Gifting, explained: where the money goes and who it helps */}
            {sponsoring && (
              <div className="rounded-2xl border border-rose-200/15 p-4 sm:p-5" style={{ background: 'linear-gradient(150deg, rgba(196,113,107,0.14), rgba(106,162,118,0.1))' }}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-rose-200/90">How gifting works</p>
                <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                  {([
                    [Coins, 'You pay', 'Choose a pack and pay with PayPal, as you would for yourself.'],
                    [Users, 'It joins the pool', 'The credits go into one shared student pool, not to your balance.'],
                    [GraduationCap, 'Students use it', `A student who runs out takes up to ${plural(perDay, 'free credit', 'free credits')} a day.`],
                  ] as const).map(([Icon, head, body], i) => (
                    <li key={head} className="flex sm:flex-col gap-3 sm:gap-2">
                      <span className="relative shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-rose-100">
                        <Icon className="w-5 h-5" />
                        <span className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-300 text-[11px] font-bold text-slate-900">{i + 1}</span>
                      </span>
                      <span>
                        <span className="block text-[15px] font-semibold text-slate-50">{head}</span>
                        <span className="block text-[13px] leading-snug text-slate-300">{body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                {pool && (
                  <div className="mt-4 grid grid-cols-3 divide-x divide-white/10 rounded-xl bg-black/20 py-2.5 text-center">
                    {([
                      [pool.credits, 'credits waiting'],
                      [pool.used ?? 0, 'used by students'],
                      [pool.sponsors, pool.sponsors === 1 ? 'sponsor so far' : 'sponsors so far'],
                    ] as const).map(([value, label]) => (
                      <div key={label} className="px-1">
                        <div className="font-display text-[22px] leading-none text-slate-50 tabular-nums">{value}</div>
                        <div className="mt-1 text-[11px] sm:text-[12px] text-slate-400">{label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* The packs: colourful cards, the best value marked */}
            <div className="grid grid-cols-2 gap-3 sm:gap-4" role="radiogroup" aria-label={sponsoring ? 'Gift size' : 'Credit pack'}>
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
                    className={`group relative text-left rounded-2xl p-4 sm:p-5 pt-5 border transition-all duration-300 ${selected ? 'scale-[1.02]' : 'hover:-translate-y-0.5 opacity-90 hover:opacity-100'}`}
                    style={{
                      background: `linear-gradient(160deg, ${pl.from}${selected ? '55' : '2b'} 0%, ${pl.to}${selected ? '33' : '17'} 100%)`,
                      borderColor: selected ? pl.ring : 'rgba(255,255,255,0.08)',
                      boxShadow: selected ? `0 14px 34px -14px ${pl.from}, inset 0 0 0 1px ${pl.ring}55` : undefined,
                    }}
                  >
                    {saving > 0 && (
                      <span className="absolute -top-3 right-3 whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-slate-900 shadow-sm" style={{ background: 'linear-gradient(135deg, #f1dfb9, #dcb676)' }} title={`Best value: ${saving}% less per credit`}>
                        Best value · −{saving}%
                      </span>
                    )}
                    <span className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${pl.from}44`, color: tinted(pl.text) }}><Icon className="w-5 h-5" /></span>
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${selected ? 'border-transparent' : 'border-white/25'}`} style={selected ? { background: pl.ring } : undefined}>
                        {selected && <Check className="w-3.5 h-3.5 text-slate-900" strokeWidth={3} />}
                      </span>
                    </span>
                    <span className="mt-3 block text-[14px] font-semibold" style={{ color: tinted(pl.text) }}>{sponsoring ? (p.id === 'class' ? 'Gift a class' : 'Small gift') : p.label}</span>
                    <span className="block font-display text-[32px] sm:text-[38px] leading-tight text-slate-50 tabular-nums">
                      {p.credits}<span className="ml-1.5 text-[15px] sm:text-[16px] text-slate-300">credits</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[20px] sm:text-[22px] font-semibold text-white tabular-nums">${p.price}</span>
                      <span className="text-[12px] sm:text-[13px] text-slate-400 tabular-nums">${perCredit(p).toFixed(2)} each</span>
                    </span>
                    <span className="mt-2 block text-[13px] leading-snug text-slate-300">
                      {sponsoring ? `A free day of physics for about ${plural(studentDays(p.credits), 'student', 'students')}` : p.note}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* What happens when you pay */}
            {pack && (
              <div className="flex items-center justify-between gap-3 rounded-2xl px-4 sm:px-5 py-3.5 bg-slate-950/50 border border-white/[0.07]">
                <span className="text-[14px] sm:text-[15px] text-slate-200">
                  {sponsoring ? 'Student pool' : 'Your balance'} <span className="tabular-nums text-slate-400">{sponsoring ? poolCredits : credits}</span>
                  <ArrowRight className="inline w-4 h-4 mx-1.5 -mt-0.5 text-slate-500" />
                  <span className="font-semibold tabular-nums" style={{ color: tinted(look.text) }}>{(sponsoring ? poolCredits : credits) + pack.credits}</span>
                  <span className="text-slate-400"> credits</span>
                </span>
                <span className="text-[16px] sm:text-[17px] font-semibold text-white tabular-nums">${pack.price}</span>
              </div>
            )}

            {message && (
              <div className="flex items-start gap-2.5 text-[14px] text-red-200 bg-red-400/[0.08] border border-red-300/20 rounded-xl p-3.5" role="alert">
                <AlertCircle className="w-5 h-5 shrink-0" /> <span>{message}</span>
              </div>
            )}

            {phase === 'unavailable' ? (
              <p className="text-[14px] text-amber-200/90 bg-amber-400/[0.07] p-4 rounded-xl border border-amber-300/15">
                {status?.paypal || !status ? 'PayPal checkout is not available right now.' : 'PayPal is not set up on this server yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) and restart it.'}
              </p>
            ) : (
              <div className="relative min-h-[140px]">
                {(phase === 'loading' || busy) && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-slate-900/85 text-[15px] text-slate-200">
                    <span className="h-7 w-7 rounded-full border-2 border-white/15 animate-spin" style={{ borderTopColor: look.ring }}></span>
                    {busy ? 'Confirming your payment with PayPal…' : 'Loading secure checkout…'}
                  </div>
                )}
                {/* Two ways to pay: PayPal's own button, and a card, which opens its own window. PayPal's
                    frame keeps a light colour scheme, as its page has, so the browser draws it transparent
                    over the dark panel instead of on a white box */}
                <div className="rounded-2xl bg-[var(--panel-solid)] border border-white/[0.08] p-3 space-y-3 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]">
                  <div ref={holder} style={{ colorScheme: 'light' }} aria-label={pack ? `Pay $${pack.price} with PayPal` : 'Pay with PayPal'}></div>
                  <button
                    onClick={() => { setMessage(null); setCardOpen(true); }}
                    disabled={!sdk || phase !== 'ready'}
                    className="w-full h-[50px] inline-flex items-center justify-center gap-2.5 rounded-full bg-slate-800 hover:bg-slate-700 border border-white/10 text-white text-[16px] font-semibold disabled:opacity-60"
                  >
                    <CreditCard className="w-5 h-5" /> Debit or Credit Card
                  </button>
                </div>
              </div>
            )}

            {cardOpen && sdk && pack && (
              <CardWindow
                paypal={sdk}
                price={pack.price}
                credits={pack.credits}
                gift={sponsoring}
                colours={look}
                createOrder={createOrderId}
                approve={approve}
                onClose={() => setCardOpen(false)}
              />
            )}

            {/* Reassurance, in three short badges */}
            <div className="flex flex-wrap justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] text-emerald-200 bg-emerald-400/[0.09] border border-emerald-300/15" title="If a generated scene never passes its physics check, its credit comes back by itself">
                <RotateCcw className="w-3.5 h-3.5" /> Verified or free
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] text-sky-200 bg-sky-400/[0.09] border border-sky-300/15" title="Payment details stay with PayPal; Equilibria only sees that the order was paid">
                <Lock className="w-3.5 h-3.5" /> Secured by PayPal
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[12px] text-amber-200 bg-amber-400/[0.09] border border-amber-300/15" title="This demo uses PayPal's sandbox: test accounts and test cards, no real money">
                <ShieldCheck className="w-3.5 h-3.5" /> Sandbox: no real money
              </span>
            </div>

            {/* Past payments: each with PayPal's own transaction and order ids */}
            {purchases.length > 0 && (
              <div className="rounded-2xl border border-white/[0.07] bg-slate-950/40">
                <button
                  onClick={() => setHistoryOpen(open => !open)}
                  aria-expanded={historyOpen}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-[14px] text-slate-200 hover:text-white"
                >
                  <span className="inline-flex items-center gap-2"><ReceiptIcon className="w-4 h-4 text-amber-200" /> Your PayPal payments <span className="text-slate-400 tabular-nums">({purchases.length})</span></span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
                </button>
                {historyOpen && (
                  <ul className="px-4 pb-3 space-y-2">
                    {purchases.map(p => (
                      <li key={p.orderId} className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-1.5">
                        <div className="flex items-center justify-between gap-3 py-1.5">
                          <span className="text-[13px] text-slate-100">{p.purpose === 'pool' ? `Gift · ${p.credits} credits` : `${p.pack} · ${p.credits} credits`}<span className="block text-[11.5px] text-slate-400">{paidOn(p.paidAt)}</span></span>
                          <span className="text-[14px] font-semibold text-white tabular-nums">${p.amount}</span>
                        </div>
                        {p.captureId && <PayPalId label="Transaction ID" value={p.captureId} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* For yourself: a quiet invitation to gift, with what others have given */}
            {!sponsoring && !canClaim && (
              <button
                onClick={() => setPurpose('pool')}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 text-[13px] sm:text-[14px] text-slate-300 hover:text-white"
              >
                <Sparkles className="w-4 h-4 text-rose-300" />
                {pool && pool.donated > 0
                  ? <>{plural(pool.sponsors, 'sponsor has', 'sponsors have')} gifted {pool.donated} credits to students. <span className="underline underline-offset-4 decoration-rose-300/60">Gift some too</span></>
                  : <>Know a student who cannot pay? <span className="underline underline-offset-4 decoration-rose-300/60">Gift them credits</span></>}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
