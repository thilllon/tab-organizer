import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { SettingsField } from '@/components/settings-field';
import { Button } from '@/components/ui/button';
import { useYoutubeAccess } from '@/hooks/use-youtube-access';
import { t } from '@/lib/i18n';
import {
  removeYoutubeAccess,
  requestYoutubeAccess,
  youtubeAccessHintKey,
} from '@/lib/pause-youtube';

interface YoutubeAccessFieldProps {
  /**
   * The menu item or shortcut opened Settings here (`#settings/youtube`) because the access is
   * missing: the row is brought into view, Allow access is focused and the hint says why.
   */
  sentHere: boolean;
  onSaved(message: string): void;
  onNotice(message: string): void;
  onError(message: string): void;
}

/**
 * The Settings row that grants or takes back access to YouTube, which "Pause all YouTube videos"
 * needs. The request is made straight from the click, before anything is awaited: Chrome only
 * shows its prompt for a user gesture. The row shows what Chrome reports, not what was asked for.
 */
export function YoutubeAccessField({
  sentHere,
  onSaved,
  onNotice,
  onError,
}: YoutubeAccessFieldProps) {
  const granted = useYoutubeAccess();
  const row = useRef<HTMLDivElement>(null);
  const command = t('cmdPauseYoutube');

  // Once Chrome has answered (the button is disabled until then). The dialog's own autofocus has
  // already run, and it leaves alone a focus that is inside it.
  useEffect(() => {
    if (!sentHere || granted !== false) {
      return;
    }
    row.current?.scrollIntoView({ block: 'center' });
    row.current?.querySelector('button')?.focus();
  }, [sentHere, granted]);

  const failed = (err: unknown) => {
    console.error('[tab-organizer] YouTube access not changed', err);
    onError(t('settingsYoutubeAccessFailed'));
  };

  const allow = () => {
    requestYoutubeAccess().then((ok) => {
      // Allowing pauses nothing by itself: say how to run the command now.
      onNotice(ok ? t('settingsYoutubeAllowed', command) : t('settingsYoutubeDeclined'));
    }, failed);
  };

  const remove = () => {
    removeYoutubeAccess().then(() => onSaved(t('settingsSaved')), failed);
  };

  return (
    <div ref={row}>
      <SettingsField
        label={t('settingsYoutubeAccess')}
        hint={t(youtubeAccessHintKey(granted, sentHere), command)}
      >
        {granted === true ? (
          <Button variant="outline" size="sm" onClick={remove}>
            <ShieldOff />
            {t('settingsYoutubeRemove')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={allow} disabled={granted === null}>
            <ShieldCheck />
            {t('settingsYoutubeAllow')}
          </Button>
        )}
      </SettingsField>
    </div>
  );
}
