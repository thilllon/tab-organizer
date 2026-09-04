import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TabRow } from '@/dashboard/components/TabRow';
import { pluralize } from '@/dashboard/lib/format';
import { groupColorClass } from '@/dashboard/lib/group-colors';
import type { GroupSnapshot, TabSnapshot } from '@/types';

export interface GroupSectionProps {
  group: GroupSnapshot;
  tabs: TabSnapshot[];
  /** Index of `tabs[0]` in the window's tab strip; row callbacks get absolute indices. */
  startIndex: number;
  /** Trailing buttons on the group header (the Export menu). */
  actions?: ReactNode;
  onOpenTab?(tabIndex: number): Promise<string | undefined> | undefined;
  renderTabActions?(tabIndex: number): ReactNode;
}

export function GroupSection({
  group,
  tabs,
  startIndex,
  actions,
  onOpenTab,
  renderTabActions,
}: GroupSectionProps) {
  const [open, setOpen] = useState(!group.collapsed);

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* The actions sit beside the trigger, never inside it: a button may not nest buttons. */}
        <div className="flex items-center gap-1 rounded-md pr-1 hover:bg-accent">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium"
            >
              <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
              <span className={`size-2.5 shrink-0 rounded-full ${groupColorClass(group.color)}`} />
              <span className="min-w-0 flex-1 truncate">
                {group.title.length > 0 ? group.title : 'Untitled group'}
              </span>
              <span className="text-xs text-muted-foreground">{pluralize(tabs.length, 'tab')}</span>
            </button>
          </CollapsibleTrigger>
          {actions}
        </div>
        <CollapsibleContent>
          <ul className="ml-5 border-l pl-2">
            {tabs.map((tab, index) => (
              <TabRow
                // biome-ignore lint/suspicious/noArrayIndexKey: no stable tab id; order is fixed.
                key={`${index}-${tab.url}`}
                tab={tab}
                onOpen={onOpenTab === undefined ? undefined : () => onOpenTab(startIndex + index)}
                actions={renderTabActions?.(startIndex + index)}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
