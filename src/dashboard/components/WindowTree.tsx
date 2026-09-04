import type { ReactNode } from 'react';
import { GroupSection } from '@/dashboard/components/GroupSection';
import { TabRow } from '@/dashboard/components/TabRow';
import { pluralize } from '@/dashboard/lib/format';
import { segmentTabs } from '@/dashboard/lib/segments';
import type { WindowSnapshot } from '@/types';

export interface WindowTreeProps {
  /**
   * A saved `WindowSnapshot` or a live `OpenWindowView` — the live one is the same shape with
   * runtime ids added, so the tree renders both without knowing which it has.
   */
  window: Pick<WindowSnapshot, 'state' | 'groups' | 'tabs'>;
  index: number;
  /** Shown after the tab count, e.g. the open-windows pane's "This window" marker. */
  badge?: ReactNode;
  /** Header buttons, right-aligned (Restore window / Save this window / Close window / …). */
  actions?: ReactNode;
  /**
   * Called with a tab's absolute index in `window.tabs` when its row is clicked; resolves with an
   * error message to show inline, or undefined. Left out, the row opens the saved url in a
   * background tab.
   */
  onOpenTab?(tabIndex: number): Promise<string | undefined> | undefined;
  /** Trailing icon buttons for the tab at that absolute index. */
  renderTabActions?(tabIndex: number): ReactNode;
}

export function WindowTree({
  window,
  index,
  badge,
  actions,
  onOpenTab,
  renderTabActions,
}: WindowTreeProps) {
  const segments = segmentTabs(window.tabs);

  return (
    <section className="rounded-md border">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1">
        <h3 className="text-sm font-medium">Window {index + 1}</h3>
        <span className="text-xs text-muted-foreground">
          {pluralize(window.tabs.length, 'tab')}
          {window.state !== 'normal' ? ` · ${window.state}` : ''}
        </span>
        {badge}
        {actions !== undefined && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
      <ul className="p-1">
        {segments.map((segment, segmentIndex) => {
          const group =
            segment.groupIndex !== undefined ? window.groups[segment.groupIndex] : undefined;
          if (group !== undefined) {
            return (
              <GroupSection
                // biome-ignore lint/suspicious/noArrayIndexKey: no stable segment id
                key={`group-${segmentIndex}-${String(segment.groupIndex)}`}
                group={group}
                tabs={segment.tabs}
                startIndex={segment.startIndex}
                onOpenTab={onOpenTab}
                renderTabActions={renderTabActions}
              />
            );
          }
          return segment.tabs.map((tab, tabIndex) => (
            <TabRow
              // biome-ignore lint/suspicious/noArrayIndexKey: no stable tab id; order is fixed.
              key={`tab-${segmentIndex}-${tabIndex}-${tab.url}`}
              tab={tab}
              onOpen={
                onOpenTab === undefined ? undefined : () => onOpenTab(segment.startIndex + tabIndex)
              }
              actions={renderTabActions?.(segment.startIndex + tabIndex)}
            />
          ));
        })}
      </ul>
    </section>
  );
}
