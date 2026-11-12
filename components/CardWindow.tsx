import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowLeft, Check, Copy, CreditCard, HeartHandshake, Lock } from 'lucide-react';

// Paying by debit or credit card in its own window, over the credits window. The card details are typed
// into PayPal's hosted fields (each one a PayPal frame), so card numbers never reach Equilibria. When
// PayPal does not offer those fields for the account, its own card form opens here instead.

interface CardWindowProps {
  paypal: any;                                         // PayPal's JavaScript SDK
  price: string;
  credits: number;
  gift: boolean;                                       // Paying for the student pool
  colours: { from: string; to: string; ring: string };
  createOrder: () => Promise<string>;
  approve: (orderId: string) => Promise<string | null>; // Captures the order; a message when it failed
  onClose: () => void;
}

const TEST_CARD = '4012 8888 8888 1881';

const FIELD_STYLE = {
  input: { 'font-size': '16px', 'font-family': 'Inter, system-ui, sans-serif', color: '#1b2324', padding: '12px 14px' },
  '.invalid': { color: '#a95b56' },
};

export const CardWindow: React.FC<CardWindowProps> = ({ paypal, price, credits, gift, colours, createOrder, approve, onClose }) => {
  const nameField = useRef<HTMLDivElement>(null);
  const numberField = useRef<HTMLDivElement>(null);
  const expiryField = useRef<HTMLDivElement>(null);
  const cvvField = useRef<HTMLDivElement>(null);
  const fallback = useRef<HTMLDivElement>(null);
  const card = useRef<any>(null);
  const [mode, setMode] = useState<'loading' | 'fields' | 'buttons' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // PayPal keeps the callbacks it was given; they read the latest ones from here
  const handlers = useRef({ createOrder, approve });
  handlers.current = { createOrder, approve };

  useEffect(() => {
    let gone = false;
    const containers = [nameField, numberField, expiryField, cvvField, fallback];
    // Starts from empty containers, and empties them again when closed: a second render never doubles the fields
    const clear = () => containers.forEach(c => { if (c.current) c.current.innerHTML = ''; });
    clear();
    const failed = (error: unknown, text: string) => {
      console.error('[PayPal card]', error);
      if (!gone) { setMessage(text); setBusy(false); }
    };
    const finish = async (orderId: string) => {
      const problem = await handlers.current.approve(orderId);
      if (!gone && problem) { setMessage(problem); setBusy(false); }
    };

    const fields = typeof paypal?.CardFields === 'function' ? paypal.CardFields({
      style: FIELD_STYLE,
      createOrder: () => handlers.current.createOrder(),
      onApprove: (data: { orderID: string }) => finish(data.orderID),
      onError: (error: unknown) => failed(error, 'The card could not be charged. Check the details, or try another card.'),
      inputEvents: {
        onChange: (data: any) => { const c = data?.cards?.[0]; if (!gone) setBrand(c ? (c.niceType || c.type || null) : null); },
      },
    }) : null;

    if (fields?.isEligible?.()) {
      card.current = fields;
      Promise.all([
        fields.NameField({ placeholder: 'Name on card' }).render(nameField.current),
        fields.NumberField({ placeholder: '1234 5678 9012 3456' }).render(numberField.current),
        fields.ExpiryField({ placeholder: 'MM / YY' }).render(expiryField.current),
        fields.CVVField({ placeholder: '123' }).render(cvvField.current),
      ]).then(() => { if (!gone) setMode('fields'); })
        .catch(error => { failed(error, 'The card form could not be shown. Close this window and try again.'); if (!gone) setMode('failed'); });
    } else {
      // PayPal's own card button; its form opens inside this window
      const buttons = paypal.Buttons({
        fundingSource: paypal.FUNDING.CARD,
        style: { layout: 'vertical', shape: 'pill', label: 'pay', height: 50 },
        createOrder: () => handlers.current.createOrder(),
        onApprove: (data: { orderID: string }) => finish(data.orderID),
        onError: (error: unknown) => failed(error, 'The card could not be charged. Check the details, or try another card.'),
      });
      if (buttons.isEligible && !buttons.isEligible()) {
        setMessage('Card payments are not available for this account. Close this window and pay with PayPal.');
        setMode('failed');
      } else {
        buttons.render(fallback.current)
          .then(() => { if (!gone) setMode('buttons'); })
          .catch((error: unknown) => { failed(error, 'The card form could not be shown. Close this window and try again.'); if (!gone) setMode('failed'); });
      }
    }
    return () => { gone = true; card.current = null; clear(); };
  }, [paypal]);

  const pay = async () => {
    const fields = card.current;
    if (!fields || busy) return;
    setMessage(null);
    const state = await fields.getState().catch(() => null);
    if (state && !state.isFormValid) {
      const f = state.fields || {};
      const missing = [
        f.cardNameField && !f.cardNameField.isValid && 'name',
        f.cardNumberField && !f.cardNumberField.isValid && 'card number',
        f.cardExpiryField && !f.cardExpiryField.isValid && 'expiry date',
        f.cardCvvField && !f.cardCvvField.isValid && 'security code',
      ].filter(Boolean);
      setMessage(missing.length ? `Check the ${missing.join(', ')}.` : 'Check the card details.');
      return;
    }
    setBusy(true);
    try { await fields.submit(); }
    catch (error) {
      console.error('[PayPal card]', error);
      setMessage('The card could not be charged. Check the details, or try another card.');
      setBusy(false);
    }
  };

  const copyTestCard = async () => {
    try { await navigator.clipboard.writeText(TEST_CARD.replace(/\s/g, '')); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { /* The number is on screen to type */ }
  };

  const close = () => { if (!busy) onClose(); };

  // Drawn at the page's top level, so nothing in the credits window can clip or shift it
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-2 sm:p-5 bg-slate-950/70 backdrop-blur-sm" onClick={close} role="dialog" aria-modal="true" aria-label="Pay by card">
      <div
        className="relative w-full max-w-[500px] max-h-[96vh] overflow-y-auto overflow-x-hidden rounded-[28px] border border-white/[0.09] bg-slate-900 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)] credits-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 sm:px-7 pt-5 sm:pt-6">
          <button onClick={close} disabled={busy} className="p-2.5 -ml-2 rounded-full text-slate-200 hover:text-white hover:bg-white/[0.07] disabled:opacity-40" aria-label="Back to the credits window">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-[24px] sm:text-[26px] leading-tight text-slate-50">Pay by card</h2>
            <p className="text-[13px] sm:text-[14px] text-slate-300">Debit or credit card, processed by PayPal</p>
          </div>
        </div>

        <div className="px-5 sm:px-7 pt-5 pb-6 space-y-5">
          {/* What is being paid for, drawn as a card in the pack's colours */}
          <div
            className="relative overflow-hidden rounded-2xl p-5 text-white h-[150px] sm:h-[164px] flex flex-col justify-between"
            style={{ background: `linear-gradient(135deg, ${colours.from}, ${colours.to})`, boxShadow: `0 18px 40px -18px ${colours.from}` }}
          >
            <span className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/15" aria-hidden="true"></span>
            <span className="pointer-events-none absolute -left-8 -bottom-16 h-40 w-40 rounded-full bg-black/10" aria-hidden="true"></span>
            <div className="relative flex items-start justify-between">
              <span className="h-8 w-11 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 opacity-90" aria-hidden="true"></span>
              <span className="text-[14px] font-bold uppercase tracking-[0.12em] text-white/90">{brand || <CreditCard className="w-6 h-6" />}</span>
            </div>
            <div className="relative">
              <div className="font-mono text-[16px] sm:text-[18px] tracking-[0.18em] text-white/80">•••• •••• •••• ••••</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <span className="text-[13px] sm:text-[14px] text-white/90 flex items-center gap-1.5">
                  {gift && <HeartHandshake className="w-4 h-4" />}
                  {credits} credits {gift ? 'for students' : 'for you'}
                </span>
                <span className="font-display text-[26px] sm:text-[28px] leading-none tabular-nums">${price}</span>
              </div>
            </div>
          </div>

          {/* PayPal's hosted fields, on a light sheet so they read as one form */}
          <div className="relative">
            {mode === 'loading' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-slate-900/90 text-[15px] text-slate-200">
                <span className="h-7 w-7 rounded-full border-2 border-white/15 animate-spin" style={{ borderTopColor: colours.ring }}></span>
                Loading the secure card form…
              </div>
            )}
            <div style={{ colorScheme: 'light' }} className={mode === 'buttons' || mode === 'failed' ? 'hidden' : 'rounded-2xl bg-white p-4 sm:p-5 space-y-2'}>
              <div>
                <span className="block px-1 text-[13px] font-semibold text-slate-600">Name on card</span>
                <div ref={nameField} className="-mx-1"></div>
              </div>
              <div>
                <span className="block px-1 text-[13px] font-semibold text-slate-600">Card number</span>
                <div ref={numberField} className="-mx-1"></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block px-1 text-[13px] font-semibold text-slate-600">Expiry</span>
                  <div ref={expiryField} className="-mx-1"></div>
                </div>
                <div>
                  <span className="block px-1 text-[13px] font-semibold text-slate-600">Security code</span>
                  <div ref={cvvField} className="-mx-1"></div>
                </div>
              </div>
            </div>
            <div ref={fallback} style={{ colorScheme: 'light' }} className={mode === 'buttons' ? 'rounded-2xl bg-[#121718] border border-white/[0.08] p-2.5' : 'hidden'}></div>
          </div>

          {/* A tester needs PayPal's sandbox card, not a real one */}
          <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-amber-400/[0.08] border border-amber-300/20 text-[13px] sm:text-[14px] text-amber-100">
            <span className="min-w-0 flex-1">
              Sandbox test card <span className="font-mono font-semibold whitespace-nowrap">{TEST_CARD}</span>, any future date, any 3 digits. No real money moves.
            </span>
            <button onClick={copyTestCard} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-300/15 hover:bg-amber-300/25 text-[12px] font-semibold" title="Copy the test card number">
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
            </button>
          </div>

          {message && (
            <div className="flex items-start gap-2.5 text-[14px] text-red-200 bg-red-400/[0.08] border border-red-300/20 rounded-xl p-3.5" role="alert">
              <AlertCircle className="w-5 h-5 shrink-0" /> <span>{message}</span>
            </div>
          )}

          {mode === 'fields' && (
            <button
              onClick={pay}
              disabled={busy}
              className="w-full h-[54px] inline-flex items-center justify-center gap-2.5 rounded-full text-white text-[17px] font-semibold shadow-calm hover:brightness-110 disabled:opacity-80"
              style={{ background: `linear-gradient(135deg, ${colours.from}, ${colours.to})` }}
            >
              {busy
                ? <><span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin"></span> Confirming with PayPal…</>
                : <><Lock className="w-5 h-5" /> Pay ${price}</>}
            </button>
          )}

          <p className="flex items-center justify-center gap-1.5 text-[12px] sm:text-[13px] text-slate-400">
            <Lock className="w-3.5 h-3.5" /> Card details go straight to PayPal; Equilibria never sees them.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
};
