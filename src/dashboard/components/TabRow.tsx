import { Pin } from 'lucide-react';
import { Favicon } from '@/dashboard/components/Favicon';
import { hostnameOf } from '@/dashboard/lib/format';
import type { TabSnapshot } from '@/types';

export interface TabRowProps {
  tab: TabSnapshot;
}

export function TabRow({ tab }: TabRowProps) {
  const open = () => {
    void chrome.tabs.create({ url: tab.url, active: false });
  };

  return (
    <li>
      <button
        type="button"
        onClick={open}
        title={tab.url}
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
    </li>
  );
}
