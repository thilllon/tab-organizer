import { Pin } from 'lucide-react';
import { useState } from 'react';
import { Favicon } from '@/dashboard/components/Favicon';
import { hostnameOf } from '@/dashboard/lib/format';
import { openTabInBackground } from '@/dashboard/lib/open-tab';
import type { TabSnapshot } from '@/types';

export interface TabRowProps {
  tab: TabSnapshot;
}

export function TabRow({ tab }: TabRowProps) {
  const [error, setError] = useState<string | undefined>(undefined);

  const open = () => {
    // Sanitised (and awaited) in open-tab.ts: a stored url may be anything the page had at
    // capture time, and a rejected create must surface here rather than vanish.
    void openTabInBackground(tab.url).then((result) => {
      setError(result.ok ? undefined : result.reason);
    });
  };

  return (
    <li>
      <button
        type="button"
        onClick={open}
        title={error ?? tab.url}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
      >
        <Favicon url={tab.url} />
        <span className="min-w-0 flex-1 truncate">
          {tab.title.length > 0 ? tab.title : tab.url}
        </span>
        <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
          {hostnameOf(tab.url)}
        </span>
        {tab.pinned && (
          <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />
        )}
      </button>
      {error !== undefined && (
        <p role="alert" className="px-2 pb-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
