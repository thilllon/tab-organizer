import { Download, Keyboard, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { AdvancedFold } from '@/components/advanced-fold';
import { NativeSelect } from '@/components/native-select';
import { SessionSettingsFields } from '@/components/session-settings-fields';
import { SettingsField } from '@/components/settings-field';
import { SettingsSection } from '@/components/settings-section';
import { ShortcutKeyChips } from '@/components/shortcut-key-chips';
import { StorageMeter } from '@/components/storage-meter';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useSessionSettings } from '@/hooks/use-session-settings';
import {
  CHANGE_ONLY_IN_CHROME,
  COMMANDS_FAILED,
  COMMANDS_LOADING,
  type CommandRow,
  commandRows,
  shortcutsDescription,
} from '@/lib/command-rows';
import { openShortcutSettings } from '@/lib/open-shortcut-settings';
import { isMacPlatform } from '@/lib/shortcut-keys';
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
} from '@/lib/sort-settings';
import type { SessionSettings, SessionSummary, SortSettings } from '@/types';

/**
 * What every save says. One wording for both halves of this page: the sort settings live in
 * `chrome.storage.sync` and the session settings in `chrome.storage.local`, but that split is our
 * problem, not something to explain in a toast.
 */
const SAVED_MESSAGE = 'Setting saved';

/** Chrome names keys differently on a Mac (Option, Command), so the page asks once. */
const IS_MAC = isMacPlatform(navigator.userAgent);

interface SettingsViewProps {
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

/**
 * Everything configurable, in one place inside the app: Chrome's own "Options" entry opens this
 * very view (`app.html#settings`). It is the content of the Settings dialog in `app.tsx` — a
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
  // `null` until Chrome answers; `'failed'` when it does not.
  const [commands, setCommands] = useState<CommandRow[] | null | 'failed'>(null);
  const sessionSettings = useSessionSettings();

  useEffect(() => {
    chrome.storage.sync.get<Partial<SortSettings>>([...SORT_SETTING_KEYS], (result) => {
      const stored = parseSortSettings(result);
      setSort(stored);
      setSuspenderDraft(stored.tabSuspenderExtensionId);
    });
    // The real keys, read from Chrome rather than promised by this page: they are unbound until
    // the user assigns them at chrome://extensions/shortcuts.
    chrome.commands.getAll().then(
      (all) => setCommands(commandRows(all, IS_MAC)),
      () => setCommands('failed'),
    );
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
        onError(`Could not save that setting: ${chrome.runtime.lastError.message ?? 'unknown'}`);
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

        <SettingsSection title="Sorting" description="What clicking the toolbar icon does.">
          <SettingsField label="Sort by" htmlFor="sort-by">
            <NativeSelect
              id="sort-by"
              title="How tabs are ordered when you click the toolbar icon"
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
          </SettingsField>

          {/* Only "Custom" reads these (CUSTOM_ONLY_SETTINGS), so they sit under "Sort by",
              indented, while it is chosen, and are not shown at all otherwise. */}
          {showCustomOptions && (
            <div className="space-y-5 border-l-2 border-border pl-4">
              <SettingsField
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
              </SettingsField>

              <SettingsField
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
              </SettingsField>

              <SettingsField
                label="Preserve order within groups"
                hint="Keep each site’s tabs in the order you opened them."
                htmlFor="preserve-order"
              >
                <Switch
                  id="preserve-order"
                  checked={sort.preserveOrderWithinGroups}
                  onCheckedChange={(checked) => write({ preserveOrderWithinGroups: checked })}
                />
              </SettingsField>
            </div>
          )}

          <SettingsField
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
          </SettingsField>

          <AdvancedFold label="Advanced" description="Pinned tabs, suspended tabs">
            <SettingsField
              label="Sort pinned tabs"
              htmlFor="sort-pinned"
              hint="Off: pinned tabs stay exactly where they are."
            >
              <Switch
                id="sort-pinned"
                checked={sort.sortPinnedTabs}
                onCheckedChange={(checked) => write({ sortPinnedTabs: checked })}
              />
            </SettingsField>

            <SettingsField
              label="Group suspended tabs together"
              htmlFor="group-suspended"
              hint="On: suspended tabs move to the front as one block."
            >
              <Switch
                id="group-suspended"
                checked={sort.groupSuspendedTabs}
                onCheckedChange={(checked) => write({ groupSuspendedTabs: checked })}
              />
            </SettingsField>

            <SettingsField
              label="Tab suspender extension ID"
              htmlFor="suspender-id"
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
            </SettingsField>
          </AdvancedFold>
        </SettingsSection>

        <SettingsSection
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
          <AdvancedFold label="Advanced" description="Interval, how many to keep, loading">
            <SessionSettingsFields
              settings={sessionSettings.settings}
              disabled={sessionSettings.loading}
              onChange={writeSession}
              subset="advanced"
              idPrefix="settings-sessions-advanced"
            />
          </AdvancedFold>
          {sessionSettings.error !== undefined && (
            <p role="alert" className="text-xs text-destructive">
              {sessionSettings.error}
            </p>
          )}
        </SettingsSection>

        <SettingsSection
          title="Backup"
          description="Sessions live on this device only. Export a file to move them somewhere else."
        >
          <SettingsField
            label="Export everything"
            hint="Saved sessions and snapshots, as one JSON file."
          >
            <Button variant="outline" size="sm" onClick={onExportAll} disabled={exporting}>
              <Download />
              Export…
            </Button>
          </SettingsField>
          <SettingsField label="Import" hint="JSON, bookmark HTML, a Markdown list or plain URLs.">
            <Button variant="outline" size="sm" onClick={onImport}>
              <Upload />
              Import…
            </Button>
          </SettingsField>
          <AdvancedFold label="Advanced" description="Storage used, delete everything">
            <StorageMeter summaries={summaries} onNotice={onNotice} />
          </AdvancedFold>
        </SettingsSection>

        <SettingsSection title="Keyboard shortcuts" description={shortcutsDescription(IS_MAC)}>
          {commands === null && <p className="text-xs text-muted-foreground">{COMMANDS_LOADING}</p>}
          {commands === 'failed' && (
            <p className="text-xs text-muted-foreground">{COMMANDS_FAILED}</p>
          )}
          {Array.isArray(commands) &&
            commands.map((command) => (
              <SettingsField key={command.id} label={command.name} hint={command.hint}>
                <ShortcutKeyChips keys={command.keys} />
              </SettingsField>
            ))}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openShortcutSettings()}
              title="Open Chrome's keyboard shortcuts page"
            >
              <Keyboard />
              Change in Chrome
            </Button>
            <p className="text-xs text-muted-foreground">{CHANGE_ONLY_IN_CHROME}</p>
          </div>
        </SettingsSection>
      </div>
    </>
  );
}
