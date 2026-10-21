import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { t, uiLocale } from '@/lib/i18n';
import { followSystemTheme } from '@/lib/theme';
import { applyStoredUiLanguage, followUiLanguageChanges } from '@/lib/ui-language';
import { App } from '@/pages/app';

import '@/styles/index.css';

// The stylesheet's `.dark` palette follows the OS; nothing here stores a theme.
followSystemTheme();

/**
 * The language chosen in Settings (or Chrome's) is put in use before anything is drawn, so no
 * string, date or number on the page is ever made in another one. `applyStoredUiLanguage()`
 * never rejects; it costs one storage read, plus two packaged files when a language is chosen.
 */
async function start(): Promise<void> {
  await applyStoredUiLanguage();
  // Chosen again in another window or on another device: reload into it, as Settings does.
  followUiLanguageChanges(() => location.reload());

  // app.html is static and says `lang="en"`; the page is in the UI language, so screen readers,
  // hyphenation and fonts follow that instead.
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
}

void start();
