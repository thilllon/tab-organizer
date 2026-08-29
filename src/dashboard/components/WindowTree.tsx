import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroupSection } from '@/dashboard/components/GroupSection';
import { TabRow } from '@/dashboard/components/TabRow';
import { pluralize } from '@/dashboard/lib/format';
import { segmentTabs } from '@/dashboard/lib/segments';
import type { WindowSnapshot } from '@/types';

export interface WindowTreeProps {
  window: WindowSnapshot;
  index: number;
  onRestoreWindow?(): void;
}

export function WindowTree({ window, index, onRestoreWindow }: WindowTreeProps) {
  const segments = segmentTabs(window.tabs);

  return (
    <section className="rounded-md border">
      <header className="flex items-center gap-2 border-b bg-muted/40 px-2 py-1">
        <h3 className="text-sm font-medium">Window {index + 1}</h3>
        <span className="text-xs text-muted-foreground">
          {pluralize(window.tabs.length, 'tab')}
          {window.state !== 'normal' ? ` · ${window.state}` : ''}
        </span>
        {onRestoreWindow !== undefined && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onRestoreWindow}>
            <RotateCcw />
            Restore window
          </Button>
        )}
      </header>
      <ul className="p-1">
        {segments.map((segment, segmentIndex) => {
          const group =
            segment.groupIndex !== undefined ? window.groups[segment.groupIndex] : undefined;
          if (group !== undefined) {
            return (
              <GroupSection
                // biome-ignore lint/suspicious/noArrayIndexKey: segments have no stable id; order is fixed per render.
                key={`group-${segmentIndex}-${String(segment.groupIndex)}`}
                group={group}
                tabs={segment.tabs}
              />
            );
          }
          return segment.tabs.map((tab, tabIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: tabs have no stable id; order is fixed per render.
            <TabRow key={`tab-${segmentIndex}-${tabIndex}-${tab.url}`} tab={tab} />
          ));
        })}
      </ul>
    </section>
  );
}
