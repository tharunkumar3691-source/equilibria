import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Clear, quick tooltips for every control that has a title. The browser's own title tooltip is slow
// (about a second), small and easy to miss; this one appears after a short pause, reads well, and shows a
// shortcut written as "Reset ( R )" as a key. Nothing in the components changes: while an element is
// hovered (or focused from the keyboard) its title is held aside so the browser's tooltip stays away, and
// it is put back as soon as the pointer leaves, so React always finds the attribute it rendered.

interface Tip { text: string; keys: string[]; x: number; top: number; bottom: number; }

const SHOW_DELAY = 320;        // ms of resting on a control before its tip appears
const SKIM_WINDOW = 600;       // moving straight on to the next control shows its tip at once
const SHORTCUT = /\s\(\s([^()]{1,12})\s\)$/; // "Zoom in ( + )" -> "+", "Exit full screen ( F or Esc )"

const parse = (title: string): { text: string; keys: string[] } => {
    const match = title.match(SHORTCUT);
    if (!match || match.index === undefined) return { text: title, keys: [] };
    return { text: title.slice(0, match.index).trim(), keys: match[1].split(/\s+or\s+/).map(k => k.trim()).filter(Boolean) };
};

export const Tooltips: React.FC = () => {
    const [tip, setTip] = useState<Tip | null>(null);
    const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let current: HTMLElement | null = null; // The element whose title is held aside
        let addedLabel = false;                 // An accessible name was lent from the title while hovered
        let visible = false;
        let dismissed = false;                  // Clicked or scrolled: no tip again until the pointer leaves
        let timer = 0;
        let watch = 0;
        let lastHidden = 0;

        // Takes the element's title (again, if React has rendered a new one) into data-tip
        const hold = (el: HTMLElement) => {
            const title = el.getAttribute('title');
            if (title === null) return;
            el.setAttribute('data-tip', title);
            el.removeAttribute('title');
            // An icon-only control named only by its title keeps that name while the title is held aside
            if (!addedLabel && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim()) {
                el.setAttribute('aria-label', title);
                addedLabel = true;
            }
        };

        const hide = () => {
            window.clearTimeout(timer);
            window.clearInterval(watch);
            if (visible) lastHidden = performance.now();
            visible = false;
            setTip(null);
        };

        // Gives the element its title back and forgets it
        const release = () => {
            hide();
            if (current) {
                const held = current.getAttribute('data-tip');
                if (held !== null && !current.hasAttribute('title')) current.setAttribute('title', held);
                current.removeAttribute('data-tip');
                if (addedLabel) current.removeAttribute('aria-label');
            }
            current = null;
            addedLabel = false;
            dismissed = false;
        };

        const show = () => {
            if (!current || !current.isConnected) { release(); return; }
            if (dismissed) return;
            hold(current);
            const text = current.getAttribute('data-tip');
            const r = current.getBoundingClientRect();
            if (!text || (!r.width && !r.height)) return;
            visible = true;
            setTip({ ...parse(text), x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
            // A control that disappears while hovered (a menu closing, a scene changing) takes its tip with it
            window.clearInterval(watch);
            watch = window.setInterval(() => { if (!current || !current.isConnected) release(); }, 400);
        };

        const begin = (el: HTMLElement) => {
            if (el === current) return;
            release();
            current = el;
            hold(el);
            const quick = performance.now() - lastHidden < SKIM_WINDOW;
            timer = window.setTimeout(show, quick ? 0 : SHOW_DELAY);
        };

        const targetOf = (node: EventTarget | null): HTMLElement | null => {
            if (!(node instanceof Element)) return null;
            const el = node.closest<HTMLElement>('[title], [data-tip]');
            // Text fields explain themselves; a tip over them would cover what is being typed. Frames (PayPal's
            // card fields) carry titles meant for screen readers, not for display
            if (!el || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(el.tagName)) return null;
            return el;
        };

        const onOver = (e: PointerEvent) => {
            if (e.pointerType === 'touch') return;
            const el = targetOf(e.target);
            if (el) begin(el);
            else if (current) release();
        };
        const onOut = (e: PointerEvent) => {
            if (current && !e.relatedTarget) release(); // Left the window
        };
        // React may render a new title while the pointer rests (Pause becomes Resume): hold that one too
        const onMove = () => {
            if (!current || !current.hasAttribute('title')) return;
            hold(current);
            if (visible) show();
        };
        const onFocus = (e: FocusEvent) => {
            const el = targetOf(e.target);
            if (el && el === e.target && el.matches(':focus-visible')) begin(el);
        };
        const onBlur = (e: FocusEvent) => { if (current && e.target === current) release(); };
        // Escape hides the tip; Enter or Space acts on the control, like a click
        const onKey = (e: KeyboardEvent) => { if (visible && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { dismissed = true; hide(); } };
        // A click acts, so the tip has done its job; scrolling moves the control away from its tip
        const onDismiss = () => { if (current) { dismissed = true; hide(); } };

        document.addEventListener('pointerover', onOver, true);
        document.addEventListener('pointerout', onOut, true);
        document.addEventListener('pointermove', onMove, { passive: true });
        document.addEventListener('pointerdown', onDismiss, true);
        document.addEventListener('click', onDismiss, true);
        document.addEventListener('focusin', onFocus);
        document.addEventListener('focusout', onBlur);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onDismiss, true);
        window.addEventListener('blur', release);
        return () => {
            release();
            document.removeEventListener('pointerover', onOver, true);
            document.removeEventListener('pointerout', onOut, true);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerdown', onDismiss, true);
            document.removeEventListener('click', onDismiss, true);
            document.removeEventListener('focusin', onFocus);
            document.removeEventListener('focusout', onBlur);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', onDismiss, true);
            window.removeEventListener('blur', release);
        };
    }, []);

    // Placed under the control (or above it near the bottom of the window) and kept inside the window
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!tip || !box) { setPlacement(null); return; }
        const w = box.offsetWidth, h = box.offsetHeight, gap = 8, margin = 8;
        const below = tip.bottom + gap + h <= window.innerHeight - margin || tip.top - gap - h < margin;
        const left = Math.min(Math.max(tip.x - w / 2, margin), window.innerWidth - w - margin);
        setPlacement({ left, top: below ? tip.bottom + gap : tip.top - gap - h });
    }, [tip]);

    if (!tip) return null;
    return (
        <div
            ref={boxRef}
            role="tooltip"
            className="fixed z-[200] pointer-events-none max-w-[260px] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 shadow-calm text-[12px] leading-snug text-slate-100 flex items-center gap-2"
            style={placement ? { left: placement.left, top: placement.top } : { left: -9999, top: -9999 }}
        >
            <span>{tip.text}</span>
            {tip.keys.length > 0 && (
                <span className="shrink-0 flex items-center gap-1">
                    {tip.keys.map(k => (
                        <kbd key={k} className="min-w-[20px] px-1.5 py-px rounded-md bg-slate-950/70 border border-white/10 text-center font-mono text-[11px] text-slate-300">{k}</kbd>
                    ))}
                </span>
            )}
        </div>
    );
};
