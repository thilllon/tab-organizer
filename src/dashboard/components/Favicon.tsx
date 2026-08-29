import { Globe } from 'lucide-react';
import { useState } from 'react';

export interface FaviconProps {
  url: string;
  size?: number;
}

/** CSS pixel size the icon is rendered at; `size` is the bitmap size requested from Chrome. */
const RENDER_PX = 16;

/**
 * Renders the site icon from Chrome's local favicon cache (no network); falls back to Globe.
 * Spec §9: request a 32 px bitmap (crisp on HiDPI) and display it at 16×16 CSS px.
 */
export function Favicon({ url, size = 32 }: FaviconProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Globe
        className="shrink-0 text-muted-foreground"
        style={{ width: RENDER_PX, height: RENDER_PX }}
      />
    );
  }

  const src = chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${String(size)}`,
  );
  return (
    <img
      src={src}
      width={RENDER_PX}
      height={RENDER_PX}
      alt=""
      className="shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
