import { ChevronRight, Clock, FolderOpen, LayoutGrid, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { Route } from '@/app/lib/route';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatSessionMeta, pluralize } from '@/dashboard/lib/format';
import { HISTORY_OPEN_KEY, readUiState, writeUiState } from '@/dashboard/lib/ui-state';
import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/types';

export interface SidebarNavProps {
  route: Route;
  /** Saved sessions, newest first. */
  saved: SessionSummary[];
  /** Automatic snapshots, newest first. */
  history: SessionSummary[];
  windowCount: number;
  tabCount: number;
  /** The snapshot promoted after a restart, if it is still the newest one. */
  recoveredId?: string;
  loading: boolean;
  onNavigate(route: Route): void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  meta?: React.ReactNode;
  current: boolean;
  onClick(): void;
}

function NavItem({ icon, label, sub, meta, current, onClick }: NavItemProps) {
  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none',
          'hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50',
          current ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
        )}
      >
        <span aria-hidden="true" className="shrink-0 [&>svg]:size-4">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{label}</span>
          {sub !== undefined && (
            <span className="block truncate text-xs font-normal text-muted-foreground">{sub}</span>
          )}
        </span>
        {meta}
      </button>
    </li>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

/**
 * The left column: what you have (open tabs, saved sessions, automatic snapshots) as one list, so
 * the main pane only ever shows what is selected. Snapshots stay folded away — they are a safety
 * net, not something to browse — except right after a restart, when the recovered one is called
 * out here instead of in a banner over the page.
 */
export function SidebarNav({
  route,
  saved,
  history,
  windowCount,
  tabCount,
  recoveredId,
  loading,
  onNavigate,
}: SidebarNavProps) {
  const [historyOpen, setHistoryOpen] = useState(
    () => readUiState(HISTORY_OPEN_KEY) === 'open' || recoveredId !== undefined,
  );

  const toggleHistory = () => {
    setHistoryOpen((open) => {
      writeUiState(HISTORY_OPEN_KEY, open ? 'closed' : 'open');
      return !open;
    });
  };

  return (
    <nav aria-label="Sessions" className="flex flex-col gap-0.5">
      <ul className="contents">
        <NavItem
          icon={<LayoutGrid />}
          label="Open tabs"
          sub={`${pluralize(windowCount, 'window')}`}
          meta={<span className="font-mono text-xs text-muted-foreground">{tabCount}</span>}
          current={route.view === 'open'}
          onClick={() => onNavigate({ view: 'open' })}
        />
      </ul>

      <SectionLabel>Saved</SectionLabel>
      {loading ? (
        <p className="px-2 text-xs text-muted-foreground">Loading…</p>
      ) : saved.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">Nothing saved yet.</p>
      ) : (
        <ul className="contents">
          {saved.map((summary) => (
            <NavItem
              key={summary.id}
              icon={<FolderOpen />}
              label={summary.name}
              sub={formatSessionMeta(summary)}
              meta={
                summary.unreadable === undefined ? undefined : (
                  <Badge variant="secondary">newer</Badge>
                )
              }
              current={route.view === 'saved' && route.id === summary.id}
              onClick={() => onNavigate({ view: 'saved', id: summary.id })}
            />
          ))}
        </ul>
      )}

      <SectionLabel>Auto-saved</SectionLabel>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={historyOpen}
        onClick={toggleHistory}
        className="justify-start gap-2 px-2 font-normal text-muted-foreground"
      >
        <Clock />
        <span className="flex-1 text-left">
          {history.length === 0 ? 'No snapshots yet' : pluralize(history.length, 'snapshot')}
        </span>
        <ChevronRight className={cn('transition-transform', historyOpen && 'rotate-90')} />
      </Button>
      {historyOpen && history.length > 0 && (
        <ul className="contents">
          {history.map((summary) => (
            <NavItem
              key={summary.id}
              icon={summary.id === recoveredId ? <Undo2 /> : <Clock />}
              label={formatDateTime(summary.createdAt)}
              sub={formatSessionMeta(summary)}
              meta={
                summary.id === recoveredId ? (
                  <Badge variant="secondary">recovered</Badge>
                ) : summary.protected === true ? (
                  <Badge variant="outline">kept</Badge>
                ) : undefined
              }
              current={route.view === 'auto' && route.id === summary.id}
              onClick={() => onNavigate({ view: 'auto', id: summary.id })}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}
