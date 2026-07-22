/**
 * Renderer entry, loaded by Vite from index.html. Runs with context
 * isolation on and node integration off — it only ever talks to the
 * backend via typed REST endpoints (none exist in the renderer yet).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element #root not found in index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
