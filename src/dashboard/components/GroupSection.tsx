import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TabRow } from '@/dashboard/components/TabRow';
import { pluralize } from '@/dashboard/lib/format';
import { groupColorClass } from '@/dashboard/lib/group-colors';
import type { GroupSnapshot, TabSnapshot } from '@/types';

export interface GroupSectionProps {
  group: GroupSnapshot;
  tabs: TabSnapshot[];
}

export function GroupSection({ group, tabs }: GroupSectionProps) {
  const [open, setOpen] = useState(!group.collapsed);

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-accent"
          >
            <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
            <span className={`size-2.5 shrink-0 rounded-full ${groupColorClass(group.color)}`} />
            <span className="min-w-0 flex-1 truncate">
              {group.title.length > 0 ? group.title : 'Untitled group'}
            </span>
            <span className="text-xs text-muted-foreground">{pluralize(tabs.length, 'tab')}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ml-5 border-l pl-2">
            {tabs.map((tab, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: tabs have no stable id; order is fixed per render.
              <TabRow key={`${index}-${tab.url}`} tab={tab} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
