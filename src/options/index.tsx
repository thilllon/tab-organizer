import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { followSystemTheme } from '@/lib/theme';
import { Options } from './Options';

import './index.css';

// The stylesheet's `.dark` palette follows the OS; nothing here stores a theme (spec §12 Phase 6).
followSystemTheme();

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
