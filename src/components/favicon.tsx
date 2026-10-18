import { Globe } from 'lucide-react';
import { useState } from 'react';

interface FaviconProps {
  url: string;
}

/** CSS pixel size the icon is rendered at. */
const RENDER_PX = 16;

/** Bitmap size requested from Chrome: twice the rendered size, so it stays crisp on HiDPI. */
const FAVICON_REQUEST_PX = 32;

/**
 * Renders the site icon from Chrome's local favicon cache (no network); falls back to Globe.
 * Spec §9: request a 32 px bitmap (crisp on HiDPI) and display it at 16×16 CSS px.
 */
export function Favicon({ url }: FaviconProps) {
  // Tracks *which* url last failed to load, rather than a plain boolean, so a component instance
  // that survives a body reload (same list position, different tab) doesn't keep showing the
  // Globe fallback for a url that hasn't actually failed. No effect needed: `failed` is derived
  // directly from comparing the current url to the last one that errored.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === url;

  if (failed) {
    return (
      <Globe
        className="shrink-0 text-muted-foreground"
        style={{ width: RENDER_PX, height: RENDER_PX }}
      />
    );
  }

  const src = chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${String(FAVICON_REQUEST_PX)}`,
  );
  return (
    <img
      src={src}
      width={RENDER_PX}
      height={RENDER_PX}
      alt=""
      // A 10,000-tab session would otherwise ask Chrome's favicon cache for 10,000 bitmaps at
      // once; lazy + async keeps that to the rows actually on screen and off the main thread.
      loading="lazy"
      decoding="async"
      className="shrink-0"
      onError={() => setFailedUrl(url)}
    />
  );
}
