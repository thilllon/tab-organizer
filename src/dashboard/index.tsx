import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Sessions</h1>
    </main>
  </StrictMode>,
);
