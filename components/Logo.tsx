import React from 'react';

// Equilibria's mark: a ball at rest on a level line, inside a quiet orbit. Balance, held.
export const LogoMark: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <circle cx="16" cy="16" r="11" fill="none" stroke="#b9a0ff" strokeWidth="1.4" opacity="0.5" />
    <path d="M4.5 19.5h23" stroke="#b9a0ff" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="16" cy="15" r="4.2" fill="#e8cc96" />
  </svg>
);

// The mark with the name, in the display face
export const Wordmark: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'sm' }) => (
  <span className={`inline-flex items-center ${size === 'lg' ? 'gap-3' : 'gap-2'}`}>
    <LogoMark className={size === 'lg' ? 'w-10 h-10' : 'w-6 h-6'} />
    <span className={`font-display font-medium text-slate-50 ${size === 'lg' ? 'text-4xl' : 'text-[17px]'}`}>Equilibria</span>
  </span>
);
