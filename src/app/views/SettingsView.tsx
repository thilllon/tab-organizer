import { Download, Keyboard, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { type CommandRow, commandRows } from '@/app/lib/command-rows';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ASSEMBLE_NAME, DEFAULT_SHORTCUTS } from '@/constants';
import { NativeSelect } from '@/dashboard/components/NativeSelect';
import { SessionSettingsFields } from '@/dashboard/components/SessionSettingsFields';
import { StorageMeter } from '@/dashboard/components/StorageMeter';
import { useSessionSettings } from '@/dashboard/hooks/useSessionSettings';
import {
  DEFAULT_SORT_SETTINGS,
  DUPLICATE_TAB_OPTIONS,
  GROUP_FROM_OPTIONS,
  GROUPING_MODE_OPTIONS,
  isDuplicateTabHandling,
  isGroupFrom,
  isGroupingMode,
  isSortBy,
  parseSortSettings,
  SORT_BY_OPTIONS,
  SORT_SETTING_KEYS,
  showsCustomSortOptions,
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
  /** A setting was written; the app shows the confirmation toast. */
  onSaved(message: string): void;
  /** A setting could not be written — shown in the app's error line, which stays up. */
  onError(message: string): void;
  onExportAll(): void;
  onImport(): void;
  exporting: boolean;
  /** The page's error lines, shown at the top of the scrolling body. */
  children?: ReactNode;
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

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** The id of the control this label names; given, the label is a real `<label>`. */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-48 flex-1">
        {htmlFor === undefined ? (
          <p className="text-sm">{label}</p>
        ) : (
          <Label htmlFor={htmlFor} className="leading-normal font-normal">
            {label}
          </Label>
        )}
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Everything configurable, in one place inside the app: Chrome's own "Options" entry opens this
 * very view (`app.html#settings`). It is the content of the Settings dialog in `App.tsx` — a
 * fixed title row over a scrolling body — so it must be rendered inside a `DialogContent`. Sort by and Duplicate tabs are visible because they change what a
 * click on the icon visibly does, with the three Custom-only choices indented under Sort by while
 * Custom is chosen; the other three sit under "Advanced". Nothing has a Save button
 * — a setting is written the moment it changes, as it already was for the session settings.
 */
export function SettingsView({
  summaries,
  onNotice,
  onSaved,
  onError,
  onExportAll,
  onImport,
  exporting,
  children,
}: SettingsViewProps) {
  const [sort, setSort] = useState<SortSettings>(DEFAULT_SORT_SETTINGS);
  const [suspenderDraft, setSuspenderDraft] = useState(
    DEFAULT_SORT_SETTINGS.tabSuspenderExtensionId,
  );
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const sessionSettings = useSessionSettings();

  useEffect(() => {
    chrome.storage.sync.get<Partial<SortSettings>>([...SORT_SETTING_KEYS], (result) => {
      const stored = parseSortSettings(result);
      setSort(stored);
      setSuspenderDraft(stored.tabSuspenderExtensionId);
    });
    // The real keys, read from Chrome rather than promised by this page: they are unbound until
    // the user assigns them at chrome://extensions/shortcuts.
    void chrome.commands.getAll().then((all) => {
      setCommands(commandRows(all));
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
        onError(`Could not save that setting — ${chrome.runtime.lastError.message ?? 'unknown'}`);
        return;
      }
      onSaved(SAVED_MESSAGE);
    });
  };

  /** The session half. `update()` reports failure through its result; it never throws. */
  const writeSession = (patch: Partial<SessionSettings>) => {
    void sessionSettings.update(patch).then((ok) => {
      if (ok) {
        onSaved(SAVED_MESSAGE);
      }
    });
  };

  const showCustomOptions = showsCustomSortOptions(sort.sortBy);
  const suspenderStatus = suspenderIdStatus(suspenderDraft);

  return (
    <>
      <DialogHeader className="border-b px-6 py-4">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription className="text-xs">Changes save as you make them.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/30 px-6 py-4">
        {children}

        <Group title="Sorting" description="What clicking the toolbar icon does.">
          <Field label="Sort by" htmlFor="sort-by">
            <NativeSelect
              id="sort-by"
              value={sort.sortBy}
              onChange={(event) => {
                const value = event.target.value;
                if (isSortBy(value)) {
                  write({ sortBy: value });
                }
              }}
            >
              {SORT_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {/* Only "Custom" reads these (CUSTOM_ONLY_SETTINGS), so they sit under "Sort by",
              indented, while it is chosen, and are not shown at all otherwise. */}
          {showCustomOptions && (
            <div className="space-y-5 border-l-2 border-border pl-4">
              <Field
                label="Tab groups"
                hint="What counts as the same site."
                htmlFor="grouping-mode"
              >
                <NativeSelect
                  id="grouping-mode"
                  value={sort.groupingMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isGroupingMode(value)) {
                      write({ groupingMode: value });
                    }
                  }}
                >
                  {GROUPING_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                label="Grouping direction"
                hint="Which end of the tab strip decides the order of the sites."
                htmlFor="group-from"
              >
                <NativeSelect
                  id="group-from"
                  value={sort.groupFrom}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (isGroupFrom(value)) {
                      write({ groupFrom: value });
                    }
                  }}
                >
                  {GROUP_FROM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                label="Preserve order within groups"
                hint="Keep each site’s tabs in the order you opened them."
                htmlFor="preserve-order"
              >
                <Switch
                  id="preserve-order"
                  checked={sort.preserveOrderWithinGroups}
                  onCheckedChange={(checked) => write({ preserveOrderWithinGroups: checked })}
                />
              </Field>
            </div>
          )}

          <Field
            label="Duplicate tabs"
            hint="When the same address is open more than once."
            htmlFor="duplicate-tabs"
          >
            <NativeSelect
              id="duplicate-tabs"
              value={sort.duplicateTabHandling}
              onChange={(event) => {
                const value = event.target.value;
                if (isDuplicateTabHandling(value)) {
                  write({ duplicateTabHandling: value });
                }
              }}
            >
              {DUPLICATE_TAB_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Advanced label="Advanced — order, pinned tabs, suspended tabs">
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

        <Group
          title="Keyboard shortcuts"
          description={`Chrome owns these. Sorting starts as ${DEFAULT_SHORTCUTS._execute_action} and ${ASSEMBLE_NAME} as ${DEFAULT_SHORTCUTS['assemble-tabs']} (Option in place of Alt on a Mac) when those keys are free; the rest start unset.`}
        >
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
      </div>
    </>
  );
}
