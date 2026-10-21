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
  changeOnlyInChrome,
  type CommandRow,
  commandRows,
  commandsFailed,
  commandsLoading,
  shortcutsDescription,
} from '@/lib/command-rows';
import { t } from '@/lib/i18n';
import { openShortcutSettings } from '@/lib/open-shortcut-settings';
import { isMacPlatform } from '@/lib/shortcut-keys';
import {
  DEFAULT_SORT_SETTINGS,
  duplicateTabOptions,
  groupFromOptions,
  groupingModeOptions,
  isDuplicateTabHandling,
  isGroupFrom,
  isGroupingMode,
  isSortBy,
  parseSortSettings,
  sortByOptions,
  SORT_SETTING_KEYS,
  showsCustomSortOptions,
  suspenderIdStatus,
  toStoredSortSettings,
} from '@/lib/sort-settings';
import type { SessionSettings, SessionSummary, SortSettings } from '@/types';

/** Chrome names keys differently on a Mac (Option, Command), so the page asks once. */
const IS_MAC = isMacPlatform(navigator.userAgent);

interface SettingsViewProps {
  summaries: SessionSummary[];
  onNotice(message: string): void;
  /** A setting was written; the app shows the confirmation toast. */
  onSaved(message: string): void;
  /** A setting could not be written - shown in the app's error line, which stays up. */
  onError(message: string): void;
  onExportAll(): void;
  onImport(): void;
  exporting: boolean;
  /** The page's error lines, shown at the top of the scrolling body. */
  children?: ReactNode;
}

/**
 * Everything configurable, in one place inside the app: Chrome's own "Options" entry opens this
 * very view (`app.html#settings`). It is the content of the Settings dialog in `app.tsx` - a
 * fixed title row over a scrolling body - so it must be rendered inside a `DialogContent`. Sort by and Duplicate tabs are visible because they change what a
 * click on the icon visibly does, with the three Custom-only choices indented under Sort by while
 * Custom is chosen; the other three sit under "Advanced". Nothing has a Save button
 * - a setting is written the moment it changes, as it already was for the session settings.
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
   * Writes one changed key straight through and confirms it. One wording, "Setting saved", for both
   * halves of this page: sort settings live in `chrome.storage.sync` and session settings in
   * `chrome.storage.local`, but that split is not something to explain in a toast. The confirmation is raised in the
   * storage callback, not beside the `setSort` above it: the control moves optimistically so it
   * never feels laggy, but "Saved" must mean the write actually landed.
   */
  const write = (patch: Partial<SortSettings>) => {
    const next = { ...sort, ...patch };
    setSort(next);
    chrome.storage.sync.set(toStoredSortSettings(next), () => {
      if (chrome.runtime.lastError !== undefined) {
        onError(
          t('settingsSaveFailed', chrome.runtime.lastError.message ?? t('settingsUnknownError')),
        );
        return;
      }
      onSaved(t('settingsSaved'));
    });
  };

  /** The session half. `update()` reports failure through its result; it never throws. */
  const writeSession = (patch: Partial<SessionSettings>) => {
    void sessionSettings.update(patch).then((ok) => {
      if (ok) {
        onSaved(t('settingsSaved'));
      }
    });
  };

  const showCustomOptions = showsCustomSortOptions(sort.sortBy);
  const suspenderStatus = suspenderIdStatus(suspenderDraft);

  return (
    <>
      <DialogHeader className="border-b px-6 py-4">
        <DialogTitle>{t('settingsTitle')}</DialogTitle>
        <DialogDescription className="text-xs">{t('settingsSubtitle')}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/30 px-6 py-4">
        {children}

        <SettingsSection
          title={t('settingsSortingTitle')}
          description={t('settingsSortingDescription')}
        >
          <SettingsField label={t('settingsSortBy')} htmlFor="sort-by">
            <NativeSelect
              id="sort-by"
              title={t('settingsSortByTitle')}
              value={sort.sortBy}
              onChange={(event) => {
                const value = event.target.value;
                if (isSortBy(value)) {
                  write({ sortBy: value });
                }
              }}
            >
              {sortByOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </SettingsField>

          {/* Only "Custom" reads these (showsCustomSortOptions), so they sit under "Sort by",
              indented, while it is chosen, and are not shown at all otherwise. */}
          {showCustomOptions && (
            <div className="space-y-5 border-l-2 border-border pl-4">
              <SettingsField
                label={t('settingsTabGroups')}
                hint={t('settingsTabGroupsHint')}
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
                  {groupingModeOptions().map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </SettingsField>

              <SettingsField
                label={t('settingsGroupingDirection')}
                hint={t('settingsGroupingDirectionHint')}
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
                  {groupFromOptions().map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </SettingsField>

              <SettingsField
                label={t('settingsPreserveOrder')}
                hint={t('settingsPreserveOrderHint')}
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
            label={t('settingsDuplicateTabs')}
            hint={t('settingsDuplicateTabsHint')}
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
              {duplicateTabOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </SettingsField>

          <AdvancedFold
            label={t('settingsAdvanced')}
            description={t('settingsSortingAdvancedDescription')}
          >
            <SettingsField
              label={t('settingsSortPinned')}
              htmlFor="sort-pinned"
              hint={t('settingsSortPinnedHint')}
            >
              <Switch
                id="sort-pinned"
                checked={sort.sortPinnedTabs}
                onCheckedChange={(checked) => write({ sortPinnedTabs: checked })}
              />
            </SettingsField>

            <SettingsField
              label={t('settingsGroupSuspended')}
              htmlFor="group-suspended"
              hint={t('settingsGroupSuspendedHint')}
            >
              <Switch
                id="group-suspended"
                checked={sort.groupSuspendedTabs}
                onCheckedChange={(checked) => write({ groupSuspendedTabs: checked })}
              />
            </SettingsField>

            <SettingsField
              label={t('settingsSuspenderId')}
              htmlFor="suspender-id"
              hint={t('settingsSuspenderIdHint')}
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
                  <span className="text-xs text-destructive">
                    {t('settingsSuspenderIdInvalid')}
                  </span>
                )}
              </div>
            </SettingsField>
          </AdvancedFold>
        </SettingsSection>

        <SettingsSection
          title={t('settingsSessionsTitle')}
          description={t('settingsSessionsDescription')}
        >
          <SessionSettingsFields
            settings={sessionSettings.settings}
            disabled={sessionSettings.loading}
            onChange={writeSession}
            subset="basic"
            idPrefix="settings-sessions"
          />
          <AdvancedFold
            label={t('settingsAdvanced')}
            description={t('settingsSessionsAdvancedDescription')}
          >
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
          title={t('settingsBackupTitle')}
          description={t('settingsBackupDescription')}
        >
          <SettingsField
            label={t('settingsExportEverything')}
            hint={t('settingsExportEverythingHint')}
          >
            <Button variant="outline" size="sm" onClick={onExportAll} disabled={exporting}>
              <Download />
              {t('settingsExportButton')}
            </Button>
          </SettingsField>
          <SettingsField label={t('settingsImport')} hint={t('settingsImportHint')}>
            <Button variant="outline" size="sm" onClick={onImport}>
              <Upload />
              {t('settingsImportButton')}
            </Button>
          </SettingsField>
          <AdvancedFold
            label={t('settingsAdvanced')}
            description={t('settingsBackupAdvancedDescription')}
          >
            <StorageMeter summaries={summaries} onNotice={onNotice} />
          </AdvancedFold>
        </SettingsSection>

        <SettingsSection
          title={t('settingsShortcutsTitle')}
          description={shortcutsDescription(IS_MAC)}
        >
          {commands === null && (
            <p className="text-xs text-muted-foreground">{commandsLoading()}</p>
          )}
          {commands === 'failed' && (
            <p className="text-xs text-muted-foreground">{commandsFailed()}</p>
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
              title={t('settingsChangeInChromeTitle')}
            >
              <Keyboard />
              {t('settingsChangeInChrome')}
            </Button>
            <p className="text-xs text-muted-foreground">{changeOnlyInChrome()}</p>
          </div>
        </SettingsSection>
      </div>
    </>
  );
}
