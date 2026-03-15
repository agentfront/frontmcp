import 'reflect-metadata';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in document');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
