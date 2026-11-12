import React from 'react';

// A slider with a visible handle, a coloured fill up to the value and a tall grab area (index.css: .range)
export const RangeSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  accent: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 0.1, accent, onChange }) => {
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <input
      type="range"
      className="range"
      aria-label={label}
      min={min} max={max} step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{ '--fill': `${fill}%`, '--accent': accent } as React.CSSProperties}
    />
  );
};

// Shows a value with as many decimals as its slider's step
export function formatValue(value: number | undefined, step = 0.1): string {
  if (value === undefined || !Number.isFinite(value)) return '–';
  const decimals = step >= 1 ? 0 : Math.min(3, Math.max(1, Math.ceil(-Math.log10(step) - 1e-9)));
  return value.toFixed(decimals);
}
