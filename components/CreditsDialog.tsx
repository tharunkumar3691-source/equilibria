import React, { useEffect, useRef, useState } from 'react';
import { Coins, X, Check, ShieldCheck, RotateCcw, Sparkles, AlertCircle, HeartHandshake, Gift } from 'lucide-react';
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

  // Escape closes, as with the other dialogs (not in the middle of confirming a payment)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'paying') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  // PayPal's buttons for the chosen pack and purpose (rebuilt when either changes)
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
        style: { layout: 'vertical', shape: 'pill', color: 'gold', label: 'pay', height: 42, tagline: false },
        createOrder: async () => {
          setMessage(null);
          const ready = prepared.current;
          prepared.current = null;
          if (ready && ready.pack === packId && ready.purpose === purpose) return ready.id;
          try { return (await createPayPalOrder(packId, purpose)).id; }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, purpose, status?.paypal?.clientId]);

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
  const pack = status?.packs.find(p => p.id === packId);
  const sponsoring = purpose === 'pool';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md" onClick={() => phase !== 'paying' && onClose()} role="dialog" aria-modal="true" aria-label="Credits">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-slate-900/95 border border-white/[0.08] rounded-3xl shadow-calm" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 bg-slate-900/95 backdrop-blur-sm border-b border-white/[0.06]">
          <h2 className="flex items-center gap-2 font-display text-lg text-slate-50"><Coins className="w-4 h-4 text-amber-300" /> Credits</h2>
          <button onClick={onClose} disabled={phase === 'paying'} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-40" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase === 'done' && result ? (
            <div className="text-center py-4" role="status">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/15 border border-emerald-300/30">
                {result.purpose === 'pool' ? <HeartHandshake className="w-6 h-6 text-emerald-300" /> : <Check className="w-6 h-6 text-emerald-300" />}
              </div>
              <p className="font-display text-xl text-slate-50">
                {result.purpose === 'pool' ? `${result.added} credits given to students` : `${result.added} credits added`}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                {result.purpose === 'pool'
                  ? <>The student pool now holds <span className="text-slate-100 font-medium tabular-nums">{pool?.credits ?? result.added}</span> credits. Thank you for paying it forward.</>
                  : <>You now have <span className="text-slate-100 font-medium tabular-nums">{credits}</span> credits.</>}
              </p>
              <button onClick={onClose} className="mt-6 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">
                Back to creating
              </button>
            </div>
          ) : (
            <>
              <div className={`rounded-2xl p-4 border ${request.reason === 'empty' ? 'bg-amber-400/[0.07] border-amber-300/20' : 'bg-slate-950/40 border-white/[0.06]'}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-slate-300">{request.reason === 'empty' ? 'You are out of credits' : 'Your balance'}</span>
                  <span className="font-display text-2xl text-slate-50 tabular-nums">{credits}</span>
                </div>
                <ul className="mt-3 space-y-1.5 text-[12px] leading-snug text-slate-400">
                  <li className="flex gap-2"><Sparkles className="w-3.5 h-3.5 mt-px shrink-0 text-blue-300" /> Each new scene or solved problem uses 1 credit. Demos, your library and chat edits are free.</li>
                  <li className="flex gap-2"><RotateCcw className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-300" /> Verified or free: if a scene never passes its physics check, the credit comes back by itself.</li>
                </ul>
              </div>

              {/* The pay-it-forward pool: what sponsors have given, and today's share for a student with none left */}
              {pool && (
                <div className="rounded-2xl p-4 border bg-emerald-400/[0.05] border-emerald-300/15">
                  <div className="flex items-start gap-3">
                    <HeartHandshake className="w-4 h-4 mt-0.5 shrink-0 text-emerald-300" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-slate-200">Student pool: <span className="font-medium tabular-nums">{pool.credits}</span> credits</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                        {pool.donated
                          ? `${pool.donated} credits given by ${pool.sponsors} ${pool.sponsors === 1 ? 'sponsor' : 'sponsors'} so far, for students who cannot pay.`
                          : 'Credits anyone can give to students who cannot pay. Be the first to sponsor.'}
                      </p>
                      {canClaim && (
                        <button onClick={claim} disabled={claiming} className="mt-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50">
                          <Gift className="w-3.5 h-3.5" /> {claiming ? 'Taking…' : `Take ${Math.min(pool.claimable, pool.credits)} free ${Math.min(pool.claimable, pool.credits) === 1 ? 'credit' : 'credits'}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-1 p-1 rounded-xl bg-black/20" role="tablist" aria-label="Who the credits are for">
                {([['self', 'For me', Coins], ['pool', 'Sponsor students', HeartHandshake]] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={purpose === id}
                    onClick={() => setPurpose(id)}
                    disabled={phase === 'paying'}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${purpose === id ? 'bg-slate-700/80 text-slate-50 shadow-xs' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>

              {status && (
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Credit pack">
                  {status.packs.map(p => (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={p.id === packId}
                      onClick={() => setPackId(p.id)}
                      disabled={phase === 'paying'}
                      className={`text-left rounded-2xl p-3.5 border transition-colors ${p.id === packId ? 'bg-blue-500/10 border-blue-300/50' : 'bg-slate-950/30 border-white/[0.06] hover:border-white/20'}`}
                    >
                      <span className="block text-[12px] text-slate-400">{p.label}</span>
                      <span className="block font-display text-xl text-slate-50 tabular-nums">{p.credits} credits</span>
                      <span className="block mt-1 text-[13px] font-medium text-blue-200 tabular-nums">${p.price}</span>
                      <span className="block mt-1 text-[11px] leading-snug text-slate-500">
                        {sponsoring ? `${p.credits} scenes for students who cannot pay` : p.note}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {message && (
                <div className="flex items-start gap-2 text-[12px] text-red-200 bg-red-400/[0.07] border border-red-300/15 rounded-xl p-2.5" role="alert">
                  <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /> <span>{message}</span>
                </div>
              )}

              {phase === 'unavailable' ? (
                <p className="text-[12px] text-amber-200/90 bg-amber-400/[0.07] p-3 rounded-xl border border-amber-300/15">
                  {status?.paypal || !status ? 'PayPal checkout is not available right now.' : 'PayPal is not set up on this server yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) and restart it.'}
                </p>
              ) : (
                <div>
                  <p className="mb-2 text-[12px] text-slate-400">
                    {pack ? (sponsoring ? `Give ${pack.credits} credits to the student pool for $${pack.price}` : `Buy ${pack.credits} credits for $${pack.price}`) : ''}
                  </p>
                  <div className="relative min-h-[110px]">
                    {(phase === 'loading' || phase === 'paying') && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-2xl bg-slate-900/80 text-[13px] text-slate-300">
                        <span className="h-4 w-4 rounded-full border-2 border-blue-400/25 border-t-blue-300 animate-spin"></span>
                        {phase === 'paying' ? 'Confirming your payment with PayPal…' : 'Loading PayPal…'}
                      </div>
                    )}
                    {/* PayPal's buttons draw on a white card so they keep their own colours */}
                    <div ref={holder} className="rounded-2xl bg-white p-3" aria-label={pack ? `Pay $${pack.price} with PayPal` : 'Pay with PayPal'}></div>
                  </div>
                </div>
              )}

              <p className="flex items-start gap-2 text-[11px] leading-snug text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400" />
                PayPal sandbox: no real money moves. Sign in with a PayPal sandbox test account. Payment details stay with PayPal; Equilibria only sees that the order was paid.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
