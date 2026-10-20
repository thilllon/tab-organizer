import { t } from '@/lib/i18n';
import type { CaptureScope } from '@/lib/session-capture';

/** What a save that captured nothing says, worded for what was being saved. */
export function nothingToSaveNotice(scope: CaptureScope): string {
  if (typeof scope === 'object' && 'tabIds' in scope) {
    return t('appNothingToSaveTabs');
  }
  return scope === 'all' ? t('appNothingToSaveAll') : t('appNothingToSaveWindow');
}
