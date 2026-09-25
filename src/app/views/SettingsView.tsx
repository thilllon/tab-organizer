import { Download, Keyboard, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { SavedToasts } from '@/app/components/SavedToasts';
import { useSavedToasts } from '@/app/lib/use-saved-toasts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { SessionSettingsFields } from '@/dashboard/components/SessionSettingsFields';
import { StorageMeter } from '@/dashboard/components/StorageMeter';
import { useSessionSettings } from '@/dashboard/hooks/useSessionSettings';
import {
  DEFAULT_SORT_SETTINGS,
  disabledSortControls,
  isDuplicateTabHandling,
  isGroupFrom,
  isGroupingMode,
  isSortBy,
  parseSortSettings,
  SORT_SETTING_KEYS,
  suspenderIdStatus,
  toStoredSortSettings,
} from '@/options/lib/sort-settings';
import { openShortcutSettings } from '@/sessions/shortcuts';
import type { SessionSettings, SessionSummary, SortSettings } from '@/types';

/**
 * What every save says. One wording for both halves of this page: the sort settings live in
 * `chrome.storage.sync` and the session settings in `chrome.storage.local`, but that split is our
 * problem, not something to explain in a toast.
 */
const SAVED_MESSAGE = 'Setting saved';

export interface SettingsViewProps {
  summaries: SessionSummary[];
  onNotice(message: string): void;
  onExportAll(): void;
  onImport(): void;
  exporting: boolean;
}

/** One boxed section with a heading and an optional explanation. */
function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-background">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description !== undefined && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="space-y-5 px-4 py-4">{children}</div>
    </section>
  );
}

/**
 * The settings people rarely change, folded away. `<details>` rather than a toggle so the browser
 * owns the open state and keyboard behaviour; the marker is drawn by CSS in index.css.
 */
function Advanced({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group -mx-2 rounded-md px-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm font-medium text-foreground/80 hover:bg-muted">
        <span
          aria-hidden="true"
          className="size-2.5 rotate-[-45deg] border-r-2 border-b-2 border-primary transition-transform group-open:rotate-45"
        />
        {label}
      </summary>
      <div className="space-y-5 py-3">{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-48 flex-1">
        <p className="text-sm">{label}</p>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

interface CommandRow {
  name: string;
  shortcut: string;
}

/**
 * Everything configurable, in one place inside the app: Chrome's own "Options" entry opens this
 * very view (`app.html#settings`). Three sorting choices are visible because they change what a
 * click on the icon visibly does; the other five sit under "Advanced". Nothing has a Save button
 * — a setting is written the moment it changes, as it already was for the session settings.
 */
export function SettingsView({
  summaries,
  onNotice,
  onExportAll,
  onImport,
  exporting,
}: SettingsViewProps) {
  const [sort, setSort] = useState<SortSettings>(DEFAULT_SORT_SETTINGS);
  const [suspenderDraft, setSuspenderDraft] = useState(
    DEFAULT_SORT_SETTINGS.tabSuspenderExtensionId,
  );
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const sessionSettings = useSessionSettings();
  const { toasts, show } = useSavedToasts();

  useEffect(() => {
    chrome.storage.sync.get<Partial<SortSettings>>([...SORT_SETTING_KEYS], (result) => {
      const stored = parseSortSettings(result);
      setSort(stored);
      setSuspenderDraft(stored.tabSuspenderExtensionId);
    });
    // The real keys, read from Chrome rather than promised by this page: they are unbound until
    // the user assigns them at chrome://extensions/shortcuts.
    void chrome.commands.getAll().then((all) => {
      setCommands(
        all.map((command) => ({
          name: command.description ?? command.name ?? '',
          shortcut:
            command.shortcut !== undefined && command.shortcut !== ''
              ? command.shortcut
              : 'Not set',
        })),
      );
    });
  }, []);

  /**
   * Writes one changed key straight through and confirms it. The confirmation is raised in the
   * storage callback, not beside the `setSort` above it: the control moves optimistically so it
   * never feels laggy, but "Saved" must mean the write actually landed.
   */
  const write = (patch: Partial<SortSettings>) => {
    const next = { ...sort, ...patch };
    setSort(next);
    chrome.storage.sync.set(toStoredSortSettings(next), () => {
      if (chrome.runtime.lastError !== undefined) {
        onNotice(`Could not save that setting — ${chrome.runtime.lastError.message ?? 'unknown'}`);
        return;
      }
      show(SAVED_MESSAGE);
    });
  };

  /** The session half. `update()` reports failure through its result; it never throws. */
  const writeSession = (patch: Partial<SessionSettings>) => {
    void sessionSettings.update(patch).then((ok) => {
      if (ok) {
        show(SAVED_MESSAGE);
      }
    });
  };

  const customOnly = disabledSortControls(sort.sortBy);
  const suspenderStatus = suspenderIdStatus(suspenderDraft);

  return (
    <section aria-label="Settings" className="min-w-0 space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Settings</h1>
        <span className="text-xs text-muted-foreground">Changes save as you make them.</span>
      </header>

      <Group title="Sorting" description="What clicking the toolbar icon does.">
        <Field label="Sort by">
          <RadioGroup
            value={sort.sortBy}
            onValueChange={(value) => isSortBy(value) && write({ sortBy: value })}
            className="flex gap-4"
          >
            <span className="flex items-center gap-2">
              <RadioGroupItem value="url" id="sort-url" />
              <Label htmlFor="sort-url">By URL</Label>
            </span>
            <span className="flex items-center gap-2">
              <RadioGroupItem value="title" id="sort-title" />
              <Label htmlFor="sort-title">By title</Label>
            </span>
            <span className="flex items-center gap-2">
              <RadioGroupItem value="custom" id="sort-custom" />
              <Label htmlFor="sort-custom">Custom</Label>
            </span>
          </RadioGroup>
        </Field>

        <Field label="Duplicate tabs" hint="When the same address is open more than once.">
          <RadioGroup
            value={sort.duplicateTabHandling}
            onValueChange={(value) =>
              isDuplicateTabHandling(value) && write({ duplicateTabHandling: value })
            }
            className="flex gap-4"
          >
            <span className="flex items-center gap-2">
              <RadioGroupItem value="none" id="dupe-none" />
              <Label htmlFor="dupe-none">Keep all</Label>
            </span>
            <span className="flex items-center gap-2">
              <RadioGroupItem value="closeAllButOne" id="dupe-close" />
              <Label htmlFor="dupe-close">Keep one</Label>
            </span>
            <span className="flex items-center gap-2">
              <RadioGroupItem value="group" id="dupe-group" />
              <Label htmlFor="dupe-group">Group them</Label>
            </span>
          </RadioGroup>
        </Field>

        <Field label="Tab groups" hint="Collect tabs from the same site into a Chrome tab group.">
          <RadioGroup
            value={sort.groupingMode}
            onValueChange={(value) => isGroupingMode(value) && write({ groupingMode: value })}
            className="flex gap-4"
          >
            <span className="flex items-center gap-2">
              <RadioGroupItem value="subdomain" id="group-subdomain" />
              <Label htmlFor="group-subdomain">By full hostname</Label>
            </span>
            <span className="flex items-center gap-2">
              <RadioGroupItem value="domain" id="group-domain" />
              <Label htmlFor="group-domain">By domain</Label>
            </span>
          </RadioGroup>
        </Field>

        <Advanced label="Advanced — order, pinned tabs, suspended tabs">
          <Field
            label="Grouping direction"
            hint={customOnly.groupFrom ? 'Custom sorting only.' : undefined}
          >
            <RadioGroup
              value={sort.groupFrom}
              disabled={customOnly.groupFrom}
              onValueChange={(value) => isGroupFrom(value) && write({ groupFrom: value })}
              className="flex gap-4"
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem value="leftToRight" id="group-ltr" />
                <Label htmlFor="group-ltr">Left to right</Label>
              </span>
              <span className="flex items-center gap-2">
                <RadioGroupItem value="rightToLeft" id="group-rtl" />
                <Label htmlFor="group-rtl">Right to left</Label>
              </span>
            </RadioGroup>
          </Field>

          <Field
            label="Preserve order within groups"
            hint={
              customOnly.preserveOrderWithinGroups
                ? 'Custom sorting only.'
                : 'Keep each group’s tabs in the order you opened them.'
            }
          >
            <Switch
              id="preserve-order"
              checked={sort.preserveOrderWithinGroups}
              disabled={customOnly.preserveOrderWithinGroups}
              onCheckedChange={(checked) => write({ preserveOrderWithinGroups: checked })}
            />
          </Field>

          <Field label="Sort pinned tabs" hint="Off: pinned tabs stay exactly where they are.">
            <Switch
              id="sort-pinned"
              checked={sort.sortPinnedTabs}
              onCheckedChange={(checked) => write({ sortPinnedTabs: checked })}
            />
          </Field>

          <Field
            label="Group suspended tabs together"
            hint="On: suspended tabs move to the front as one block."
          >
            <Switch
              id="group-suspended"
              checked={sort.groupSuspendedTabs}
              onCheckedChange={(checked) => write({ groupSuspendedTabs: checked })}
            />
          </Field>

          <Field
            label="Tab suspender extension ID"
            hint="Which extension’s suspended pages to recognise. Empty uses The Marvellous Suspender."
          >
            <div className="flex items-center gap-2">
              <Input
                id="suspender-id"
                value={suspenderDraft}
                aria-invalid={suspenderStatus === 'invalid'}
                className="h-8 w-72 font-mono text-xs"
                onChange={(event) => setSuspenderDraft(event.target.value)}
                onBlur={() => {
                  if (suspenderStatus === 'invalid') {
                    return;
                  }
                  const stored = toStoredSortSettings({
                    ...sort,
                    tabSuspenderExtensionId: suspenderDraft,
                  });
                  setSuspenderDraft(stored.tabSuspenderExtensionId);
                  write({ tabSuspenderExtensionId: stored.tabSuspenderExtensionId });
                }}
              />
              {suspenderStatus === 'invalid' && (
                <span className="text-xs text-destructive">32 letters a–p</span>
              )}
            </div>
          </Field>
        </Advanced>
      </Group>

      <Group
        title="Sessions"
        description="Automatic snapshots are the safety net behind a crash or a closed window. They stay on this device."
      >
        <SessionSettingsFields
          settings={sessionSettings.settings}
          disabled={sessionSettings.loading}
          onChange={writeSession}
          subset="basic"
          idPrefix="settings-sessions"
        />
        <Advanced label="Advanced — interval, how many to keep, loading">
          <SessionSettingsFields
            settings={sessionSettings.settings}
            disabled={sessionSettings.loading}
            onChange={writeSession}
            subset="advanced"
            idPrefix="settings-sessions-advanced"
            className="gap-x-6 gap-y-4"
          />
        </Advanced>
        {sessionSettings.error !== undefined && (
          <p role="alert" className="text-xs text-destructive">
            {sessionSettings.error}
          </p>
        )}
      </Group>

      <Group
        title="Backup"
        description="Sessions live on this device only. Export a file to move them somewhere else."
      >
        <Field label="Export everything" hint="Saved sessions and snapshots, as one JSON file.">
          <Button variant="outline" size="sm" onClick={onExportAll} disabled={exporting}>
            <Download />
            Export…
          </Button>
        </Field>
        <Field label="Import" hint="JSON, bookmark HTML, a Markdown list or plain URLs.">
          <Button variant="outline" size="sm" onClick={onImport}>
            <Upload />
            Import…
          </Button>
        </Field>
        <Advanced label="Advanced — storage used, delete everything">
          <StorageMeter summaries={summaries} onNotice={onNotice} />
        </Advanced>
      </Group>

      <Group title="Keyboard shortcuts" description="Chrome owns these; none is set by default.">
        {commands.map((command) => (
          <Field key={command.name} label={command.name}>
            <span className="rounded border px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {command.shortcut}
            </span>
          </Field>
        ))}
        <Button variant="outline" size="sm" onClick={() => void openShortcutSettings()}>
          <Keyboard />
          Change in Chrome
        </Button>
      </Group>

      <SavedToasts toasts={toasts} />
    </section>
  );
}
