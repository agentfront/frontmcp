import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerAllRenderers } from '@frontmcp/ui/renderer';
import { App } from './App';

registerAllRenderers();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
