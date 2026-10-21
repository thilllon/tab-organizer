import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { t, uiLocale } from '@/lib/i18n';
import { followSystemTheme } from '@/lib/theme';
import { App } from '@/pages/app';

import '@/styles/index.css';

// The stylesheet's `.dark` palette follows the OS; nothing here stores a theme.
followSystemTheme();

// app.html is static and says `lang="en"`; the page is in the browser's UI language, so screen
// readers, hyphenation and fonts follow that instead.
document.documentElement.lang = uiLocale();
document.title = t('extName');

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
