import './lib/theme'; // Puts the saved colour theme on before anything is drawn
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Landing } from './components/Landing';
import { readSharePayload } from './lib/library';
import './index.css';

const ENTERED_KEY = 'equilibria.entered';

// The landing page shows once per visit. A shared link goes straight to its simulation, and a reload
// in the same tab goes straight back to the app.
const skipLanding = (): boolean => {
  if (readSharePayload()) return true;
  try { return sessionStorage.getItem(ENTERED_KEY) === '1'; } catch { return false; }
};

const Root: React.FC = () => {
  const [stage, setStage] = useState<'landing' | 'leaving' | 'app'>(() => (skipLanding() ? 'app' : 'landing'));
  const enter = () => {
    try { sessionStorage.setItem(ENTERED_KEY, '1'); } catch { /* Shown again next reload: fine */ }
    setStage('leaving');
    // The app opens underneath while the landing page fades away
    window.setTimeout(() => setStage('app'), 520);
  };
  return (
    <>
      {stage !== 'landing' && <App />}
      {stage !== 'app' && <Landing onEnter={enter} leaving={stage === 'leaving'} />}
    </>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
