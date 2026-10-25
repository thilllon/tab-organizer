import { useEffect, useState } from 'react';

import { hasYoutubeAccess, touchesYoutubeAccess } from '@/lib/pause-youtube';

/**
 * Whether Chrome lets the extension pause YouTube: `null` until Chrome answers. Follows
 * `chrome.permissions.onAdded` / `onRemoved`, so a grant from Chrome's prompt, or a removal at
 * chrome://extensions or from another app tab, shows at once. The listeners live in the page and
 * die with it; the service worker asks Chrome itself each time.
 */
export function useYoutubeAccess(): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      hasYoutubeAccess().then(
        (value) => {
          if (live) {
            setGranted(value);
          }
        },
        (err: unknown) => {
          console.error('[tab-organizer] YouTube access unknown', err);
          if (live) {
            setGranted(false);
          }
        },
      );
    };
    const onChange = (permissions: chrome.permissions.Permissions) => {
      if (touchesYoutubeAccess(permissions)) {
        refresh();
      }
    };
    chrome.permissions.onAdded.addListener(onChange);
    chrome.permissions.onRemoved.addListener(onChange);
    refresh();
    return () => {
      live = false;
      chrome.permissions.onAdded.removeListener(onChange);
      chrome.permissions.onRemoved.removeListener(onChange);
    };
  }, []);

  return granted;
}
