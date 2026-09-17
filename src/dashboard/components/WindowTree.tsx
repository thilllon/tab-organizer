import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GroupSection } from '@/dashboard/components/GroupSection';
import { TabRow } from '@/dashboard/components/TabRow';
import { pluralize } from '@/dashboard/lib/format';
import { segmentTabs } from '@/dashboard/lib/segments';
import {
  hiddenTabCount,
  initialTabPage,
  nextTabPage,
  showMoreLabel,
} from '@/dashboard/lib/tab-paging';
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
  /** Trailing buttons on a group header, by that group's index in `window.groups`. */
  renderGroupActions?(groupIndex: number): ReactNode;
}

/**
 * One window as a `role="treeitem"` holding a `role="group"` of tab (and tab-group) rows. The
 * host renders it inside a `role="tree"` (the open-windows pane, a history row) or a
 * `role="group"` (an expanded saved session), so the whole session → window → group → tab
 * structure is one ARIA tree.
 *
 * Large windows are paged (`tab-paging.ts`): a 10,000-tab window mounts 200 rows and grows a page
 * per click, and every mounted row carries `content-visibility: auto` (see `index.css`) so the
 * ones off screen cost no layout.
 */
export function WindowTree({
  window,
  index,
  badge,
  actions,
  onOpenTab,
  renderTabActions,
  renderGroupActions,
}: WindowTreeProps) {
  const total = window.tabs.length;
  const [visible, setVisible] = useState(() => initialTabPage(total));

  // A different window in the same slot (a live pane refetch, another session expanded) starts
  // over at page one; growing the page count is otherwise the only thing that moves it.
  useEffect(() => {
    setVisible(initialTabPage(total));
  }, [total]);

  const shown = useMemo(
    () => (visible >= total ? window.tabs : window.tabs.slice(0, visible)),
    [window.tabs, visible, total],
  );
  // Segmenting the visible prefix keeps every callback index absolute: a segment's `startIndex`
  // is still its position in the full tab strip.
  const segments = useMemo(() => segmentTabs(shown), [shown]);
  const hidden = hiddenTabCount(visible, total);

  return (
    <section
      // A window is a node of the sessions tree; it stays a <section> so its heading keeps
      // labelling a real region.
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: see above
      role="treeitem"
      aria-expanded
      aria-label={`Window ${index + 1}`}
      // -1, not 0: the rows inside are what the Tab key walks (no roving tabindex here).
      tabIndex={-1}
      className="cv-window rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1">
        <h3 className="text-sm font-medium">Window {index + 1}</h3>
        <span className="text-xs text-muted-foreground">
          {pluralize(total, 'tab')}
          {window.state !== 'normal' ? ` · ${window.state}` : ''}
        </span>
        {badge}
        {actions !== undefined && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
      {/* biome-ignore lint/a11y/useSemanticElements: <fieldset> is for form controls; this is the ARIA group of tab rows under a window node. */}
      <ul role="group" className="p-1">
        {segments.map((segment, segmentIndex) => {
          const groupIndex = segment.groupIndex;
          const group = groupIndex !== undefined ? window.groups[groupIndex] : undefined;
          if (group !== undefined && groupIndex !== undefined) {
            return (
              <GroupSection
                // biome-ignore lint/suspicious/noArrayIndexKey: no stable segment id
                key={`group-${segmentIndex}-${String(groupIndex)}`}
                group={group}
                tabs={segment.tabs}
                startIndex={segment.startIndex}
                actions={renderGroupActions?.(groupIndex)}
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
      {hidden > 0 && (
        <div className="border-t px-2 py-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setVisible((current) => nextTabPage(current, total))}
          >
            {showMoreLabel(visible, total)}
          </Button>
        </div>
      )}
    </section>
  );
}
