import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { TabRow, type TabRowSelection } from '@/components/tab-row';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { groupChipClass, groupRailClass } from '@/lib/group-colors';
import { t, tp } from '@/lib/i18n';
import type { GroupSnapshot, TabSnapshot } from '@/types';

interface GroupSectionProps {
  group: GroupSnapshot;
  tabs: TabSnapshot[];
  /** Index of `tabs[0]` in the window's tab strip; row callbacks get absolute indices. */
  startIndex: number;
  /** Trailing buttons on the group header (the Export menu). */
  actions?: ReactNode;
  onOpenTab(tabIndex: number): Promise<string | undefined> | undefined;
  renderTabActions?(tabIndex: number): ReactNode;
  tabSelection?(tabIndex: number): TabRowSelection | undefined;
}

export function GroupSection({
  group,
  tabs,
  startIndex,
  actions,
  onOpenTab,
  renderTabActions,
  tabSelection,
}: GroupSectionProps) {
  const [open, setOpen] = useState(!group.collapsed);

  const label = group.title.length > 0 ? group.title : t('treeUntitledGroup');

  return (
    // A tab group is a tree node with children: the collapsible trigger below is the toggle Radix
    // puts `aria-expanded` on, and this mirrors it for the node itself.
    <li role="treeitem" aria-expanded={open} aria-label={label} tabIndex={-1}>
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* The actions sit beside the trigger, never inside it: a button may not nest buttons. */}
        <div className="flex items-center gap-1 rounded-md pr-1 hover:bg-accent">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              title={open ? t('treeCollapseGroup', label) : t('treeExpandGroup', label)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
              {/* The group's name lives inside its colour rather than beside a dot, so the colour
                  labels something instead of floating on its own. */}
              <span
                className={`min-w-0 truncate rounded-full px-2 py-0.5 text-xs font-semibold ${groupChipClass(group.color)}`}
              >
                {label}
              </span>
              <span className="min-w-0 flex-1" />
              <span className="text-xs text-muted-foreground">{tp('tabCount', tabs.length)}</span>
            </button>
          </CollapsibleTrigger>
          {actions}
        </div>
        <CollapsibleContent>
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <fieldset> is for form controls; this is the ARIA group of tab rows inside a tab group. */}
          <ul role="group" className={`ml-5 border-l-2 pl-2 ${groupRailClass(group.color)}`}>
            {tabs.map((tab, index) => (
              <TabRow
                // oxlint-disable-next-line react/no-array-index-key -- no stable tab id; order is fixed.
                key={`${index}-${tab.url}`}
                tab={tab}
                selection={tabSelection?.(startIndex + index)}
                onOpen={() => onOpenTab(startIndex + index)}
                actions={renderTabActions?.(startIndex + index)}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
