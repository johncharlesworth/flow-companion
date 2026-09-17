import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/app.css';

import { isDemoRequested } from '@/lib/demo-flow';

import { App } from './App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('sidepanel: #root is missing from index.html');
}
root.className = 'h-full';

createRoot(root).render(
  <StrictMode>
    <App demo={isDemoRequested(window.location.search)} />
  </StrictMode>,
);
