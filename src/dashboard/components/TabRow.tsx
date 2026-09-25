import { Pin } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Favicon } from '@/dashboard/components/Favicon';
import { hostnameOf } from '@/dashboard/lib/format';
import { openTabInBackground } from '@/dashboard/lib/open-tab';
import { browserHandlesClick, hrefFor } from '@/lib/link';
import type { TabSnapshot } from '@/types';

export interface TabRowProps {
  tab: TabSnapshot;
  /**
   * Open mode (open-windows pane): clicking the row goes to the live tab instead of opening the
   * saved url in a new background tab. Report a failure through `error` below.
   */
  onOpen?(): Promise<string | undefined> | undefined;
  /** Trailing icon buttons (Go to tab / Close tab / Remove from session). */
  actions?: ReactNode;
}

export function TabRow({ tab, onOpen, actions }: TabRowProps) {
  const [error, setError] = useState<string | undefined>(undefined);

  const open = () => {
    if (onOpen !== undefined) {
      void Promise.resolve(onOpen()).then(setError);
      return;
    }
    // Sanitised (and awaited) in open-tab.ts: a stored url may be anything the page had at
    // capture time, and a rejected create must surface here rather than vanish.
    void openTabInBackground(tab.url).then((result) => {
      setError(result.ok ? undefined : result.reason);
    });
  };

  /**
   * An `href` only so the browser will show where the row goes (status bar, "Copy link address",
   * ⌘-click). `hrefFor` returns undefined for anything that must not be a live link, and the row
   * falls back to the button it has always been — behaviour on a plain click is identical either
   * way, so nothing is lost by a url that cannot be linked.
   */
  const href = hrefFor(tab.url);

  const onClick = (event: React.MouseEvent) => {
    if (browserHandlesClick(event)) {
      // ⌘/Ctrl/Shift-click: the user asked for the browser's behaviour, so leave the anchor alone.
      return;
    }
    // A plain click must not navigate this page to the site — that would close the app.
    event.preventDefault();
    open();
  };

  const label = tab.title.length > 0 ? tab.title : tab.url;
  const inner = (
    <>
      <Favicon url={tab.url} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
        {hostnameOf(tab.url)}
      </span>
      {tab.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
    </>
  );
  const rowClass =
    'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

  return (
    // `cv-tab-row` (index.css) lets Chrome skip layout for rows scrolled out of view — the one
    // thing that keeps a 10,000-tab session scrolling smoothly.
    <li role="treeitem" tabIndex={-1} className="cv-tab-row">
      {/* The actions sit beside the row button, never inside it: a button may not nest buttons. */}
      <div className="flex items-center gap-1 rounded-md pr-1 hover:bg-accent">
        {href === undefined ? (
          <button type="button" onClick={open} title={error ?? tab.url} className={rowClass}>
            {inner}
          </button>
        ) : (
          <a href={href} onClick={onClick} title={error ?? tab.url} className={rowClass}>
            {inner}
          </a>
        )}
        {actions}
      </div>
      {error !== undefined && (
        <p role="alert" className="px-2 pb-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
