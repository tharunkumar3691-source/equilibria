// The app's colour themes. Each one is a set of colour values in index.css (`:root[data-theme="…"]`);
// choosing one sets that attribute on the page and remembers it in this browser.

export type ThemeId = 'white' | 'dark' | 'purple' | 'green' | 'yellow' | 'orange';

export interface Theme {
  id: ThemeId;
  label: string;
  light: boolean;
  swatch: [string, string];   // Background and accent, for the picker
  bar: string;                // The browser's title-bar colour (phones)
}

export const THEMES: Theme[] = [
  { id: 'white', label: 'White', light: true, swatch: ['#f3f4f7', '#6366f1'], bar: '#f3f4f7' },
  { id: 'dark', label: 'Dark', light: false, swatch: ['#0b0c0e', '#3d8bf0'], bar: '#0b0c0e' },
  { id: 'purple', label: 'Purple', light: false, swatch: ['#0d0a18', '#8a5cf6'], bar: '#0d0a18' },
  { id: 'green', label: 'Light green', light: true, swatch: ['#eaf6ee', '#22a862'], bar: '#eaf6ee' },
  { id: 'yellow', label: 'Yellow', light: true, swatch: ['#fbf5dc', '#f59e0b'], bar: '#fbf5dc' },
  { id: 'orange', label: 'Orange', light: false, swatch: ['#100b08', '#f5731f'], bar: '#100b08' },
];

const KEY = 'equilibria.theme';
const DEFAULT: ThemeId = 'dark';

export const savedTheme = (): ThemeId => {
  try {
    const id = localStorage.getItem(KEY);
    if (THEMES.some(t => t.id === id)) return id as ThemeId;
  } catch { /* Storage blocked: the default theme */ }
  return DEFAULT;
};

export function applyTheme(id: ThemeId, remember = true) {
  const theme = THEMES.find(t => t.id === id) ?? THEMES.find(t => t.id === DEFAULT)!;
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bar);
  if (remember) {
    try { localStorage.setItem(KEY, theme.id); } catch { /* Not remembered: fine */ }
  }
}

// The saved theme goes on before the first paint, so the page never flashes the default colours
if (typeof document !== 'undefined') applyTheme(savedTheme(), false);
