import { FolderOpen, Keyboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { SessionSettingsFields } from '@/dashboard/components/SessionSettingsFields';
import { useSessionSettings } from '@/dashboard/hooks/useSessionSettings';
import { cn } from '@/lib/utils';
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
import { openDashboard } from '@/sessions/open-dashboard';
import { openShortcutSettings } from '@/sessions/shortcuts';
import type { DuplicateTabHandling, GroupFrom, GroupingMode, SortBy, SortSettings } from '@/types';

export const Options = () => {
  const [sortBy, setSortBy] = useState<SortBy>(DEFAULT_SORT_SETTINGS.sortBy);
  const [groupFrom, setGroupFrom] = useState<GroupFrom>(DEFAULT_SORT_SETTINGS.groupFrom);
  const [preserveOrder, setPreserveOrder] = useState(
    DEFAULT_SORT_SETTINGS.preserveOrderWithinGroups,
  );
  const [sortPinnedTabs, setSortPinnedTabs] = useState(DEFAULT_SORT_SETTINGS.sortPinnedTabs);
  const [groupSuspendedTabs, setGroupSuspendedTabs] = useState(
    DEFAULT_SORT_SETTINGS.groupSuspendedTabs,
  );
  const [suspenderId, setSuspenderId] = useState(DEFAULT_SORT_SETTINGS.tabSuspenderExtensionId);
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateTabHandling>(
    DEFAULT_SORT_SETTINGS.duplicateTabHandling,
  );
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(
    DEFAULT_SORT_SETTINGS.groupingMode,
  );
  const [saved, setSaved] = useState(false);
  // Session settings are device-local (`chrome.storage.local` via sessionRepo) and apply
  // immediately -- they deliberately do not go through this page's "Save" button, which writes
  // the sort settings to chrome.storage.sync.
  const sessionSettings = useSessionSettings();

  // Read every key this page writes, so nothing is left showing a default it would then save over.
  useEffect(() => {
    chrome.storage.sync.get<Partial<SortSettings>>([...SORT_SETTING_KEYS], (result) => {
      const stored = parseSortSettings(result);
      setSortBy(stored.sortBy);
      setGroupFrom(stored.groupFrom);
      setPreserveOrder(stored.preserveOrderWithinGroups);
      setSortPinnedTabs(stored.sortPinnedTabs);
      setGroupSuspendedTabs(stored.groupSuspendedTabs);
      setSuspenderId(stored.tabSuspenderExtensionId);
      setDuplicateHandling(stored.duplicateTabHandling);
      setGroupingMode(stored.groupingMode);
    });
  }, []);

  // `groupFrom` and `preserveOrderWithinGroups` reach `sortByCustom()` only; the URL and title
  // modes never see them (src/background/sort.ts).
  const customOnly = disabledSortControls(sortBy);
  // Empty is valid — it means "use the default" (`normalizeSuspenderId`); only a malformed id
  // blocks the save, since it would build a suspended-page prefix that matches no tab.
  const suspenderInvalid = suspenderIdStatus(suspenderId) === 'invalid';

  const handleSave = () => {
    if (suspenderInvalid) {
      return;
    }
    const settings = toStoredSortSettings({
      sortBy,
      groupFrom,
      preserveOrderWithinGroups: preserveOrder,
      groupSuspendedTabs,
      tabSuspenderExtensionId: suspenderId,
      sortPinnedTabs,
      duplicateTabHandling: duplicateHandling,
      groupingMode,
    });
    chrome.storage.sync.set(settings, () => {
      // An empty field means "use the default"; show the id that was actually written.
      setSuspenderId(settings.tabSuspenderExtensionId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleSortByChange = (value: string) => {
    if (isSortBy(value)) {
      setSortBy(value);
    }
  };

  const handleGroupFromChange = (value: string) => {
    if (isGroupFrom(value)) {
      setGroupFrom(value);
    }
  };

  const handleDuplicateChange = (value: string) => {
    if (isDuplicateTabHandling(value)) {
      setDuplicateHandling(value);
    }
  };

  const handleGroupingChange = (value: string) => {
    if (isGroupingMode(value)) {
      setGroupingMode(value);
    }
  };

  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h3 className="text-center text-lg font-semibold tracking-wide text-primary uppercase">
        Tab Organizer
      </h3>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Sort Mode</h4>
          <p className="text-xs text-muted-foreground">
            How should tabs be ordered when you click the extension icon?
          </p>
        </div>

        <RadioGroup value={sortBy} onValueChange={handleSortByChange} aria-label="Sort mode">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="url" id="sort-url" />
              <Label htmlFor="sort-url">By URL</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Alphabetically by web address, so tabs from the same site end up next to each other
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="title" id="sort-title" />
              <Label htmlFor="sort-title">By title</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Alphabetically by page title, whatever the address
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="custom" id="sort-custom" />
              <Label htmlFor="sort-custom">Custom grouping</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Keeps each site's tabs together, in the order the sites first appear in the tab strip
            </p>
          </div>
        </RadioGroup>

        <div className="space-y-3 border-l pl-4">
          <p id="custom-grouping-note" className="text-xs text-muted-foreground">
            The two settings below apply to the Custom grouping mode only.
            {customOnly.groupFrom && ' Select Custom grouping above to change them.'}
          </p>

          <div className={cn('space-y-4', customOnly.groupFrom && 'opacity-60')}>
            <div className="space-y-2">
              <h5 className="text-sm font-medium">Grouping direction</h5>
              <RadioGroup
                value={groupFrom}
                onValueChange={handleGroupFromChange}
                disabled={customOnly.groupFrom}
                aria-label="Grouping direction"
                aria-describedby="custom-grouping-note"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="leftToRight" id="group-left-to-right" />
                    <Label htmlFor="group-left-to-right">Left to right</Label>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground">
                    Groups follow the order the sites first appear from the left of the tab strip
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="rightToLeft" id="group-right-to-left" />
                    <Label htmlFor="group-right-to-left">Right to left</Label>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground">
                    Groups follow the order the sites first appear from the right, i.e. the most
                    recently opened sites come first
                  </p>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="preserve-order"
                  checked={preserveOrder}
                  disabled={customOnly.preserveOrderWithinGroups}
                  aria-describedby="custom-grouping-note"
                  onCheckedChange={setPreserveOrder}
                />
                <Label htmlFor="preserve-order">Preserve order within groups</Label>
              </div>
              <p className="pl-10 text-xs text-muted-foreground">
                Tabs of the same site keep the order they were already in instead of being sorted by
                URL
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Pinned Tabs</h4>
          <p className="text-xs text-muted-foreground">Should pinned tabs take part in the sort?</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Switch id="sort-pinned" checked={sortPinnedTabs} onCheckedChange={setSortPinnedTabs} />
            <Label htmlFor="sort-pinned">Sort pinned tabs</Label>
          </div>
          <p className="pl-10 text-xs text-muted-foreground">
            Off: pinned tabs are left in the order you put them in
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Suspended Tabs</h4>
          <p className="text-xs text-muted-foreground">
            Tabs parked by a suspender extension such as The Marvellous Suspender.
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Switch
              id="group-suspended"
              checked={groupSuspendedTabs}
              onCheckedChange={setGroupSuspendedTabs}
            />
            <Label htmlFor="group-suspended">Group suspended tabs together</Label>
          </div>
          <p className="pl-10 text-xs text-muted-foreground">
            On: suspended tabs are moved to the front as one block. Off: each one is sorted by the
            address it was suspended from.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="suspender-id">Tab suspender extension ID</Label>
          <div className="flex items-center gap-2">
            <Input
              id="suspender-id"
              value={suspenderId}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              className="font-mono text-xs"
              placeholder={DEFAULT_SORT_SETTINGS.tabSuspenderExtensionId}
              aria-invalid={suspenderInvalid}
              aria-describedby="suspender-id-help"
              onChange={(event) => setSuspenderId(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={suspenderId.trim() === DEFAULT_SORT_SETTINGS.tabSuspenderExtensionId}
              onClick={() => setSuspenderId(DEFAULT_SORT_SETTINGS.tabSuspenderExtensionId)}
            >
              Reset to default
            </Button>
          </div>
          <p id="suspender-id-help" className="text-xs text-muted-foreground">
            Which extension's suspended pages to recognise: 32 letters from a to p. Sorting uses it
            to detect suspended tabs, and Sessions uses it to save a suspended tab under its real
            address. Leave it empty to use The Marvellous Suspender.
          </p>
          {suspenderInvalid && (
            <p role="alert" className="text-xs text-destructive">
              That is not a Chrome extension ID (32 letters from a to p). Fix it, clear the field or
              reset to the default before saving.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Tab Grouping</h4>
          <p className="text-xs text-muted-foreground">How should tabs be grouped when sorting?</p>
        </div>

        <RadioGroup value={groupingMode} onValueChange={handleGroupingChange}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="subdomain" id="subdomain" />
              <Label htmlFor="subdomain">Group by full hostname (subdomain)</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              e.g. mail.google.com and drive.google.com are separated into different groups
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="domain" id="domain" />
              <Label htmlFor="domain">Group by domain only</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              e.g. mail.google.com and drive.google.com are merged into one google.com group
            </p>
          </div>
        </RadioGroup>
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">Duplicate Tabs</h4>
          <p className="text-xs text-muted-foreground">
            How should tabs with the same URL be handled?
          </p>
        </div>

        <RadioGroup value={duplicateHandling} onValueChange={handleDuplicateChange}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id="none" />
              <Label htmlFor="none">Do nothing</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Duplicate tabs are left as they are
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="closeAllButOne" id="closeAllButOne" />
              <Label htmlFor="closeAllButOne">Keep one, close the rest</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Only the active (or first) tab is kept; all other duplicates are closed automatically
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="group" id="group" />
              <Label htmlFor="group">Group into tab group</Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              Duplicate tabs are grouped together so you can review and close them manually
            </p>
          </div>
        </RadioGroup>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <h4 className="text-sm font-medium">Sessions</h4>
          <p className="text-xs text-muted-foreground">
            Save and restore windows, tabs and tab groups. Sessions are stored only on this device.
            You can also save from the icon's right-click menu.
          </p>
        </div>
        <SessionSettingsFields
          settings={sessionSettings.settings}
          disabled={sessionSettings.loading}
          idPrefix="options"
          className="flex-col items-start gap-3"
          onChange={(patch) => void sessionSettings.update(patch)}
        />
        {sessionSettings.error !== undefined && (
          <p role="alert" className="text-xs text-destructive">
            {sessionSettings.error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              openDashboard().catch((err) => console.error('[tab-organizer:sessions]', err));
            }}
          >
            <FolderOpen />
            Open Sessions dashboard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              openShortcutSettings().catch((err) => console.error('[tab-organizer:sessions]', err));
            }}
          >
            <Keyboard />
            Set keyboard shortcuts
          </Button>
        </div>
      </section>

      <div className="flex items-center gap-3 pt-2">
        <Button size="lg" className="w-full" onClick={handleSave} disabled={suspenderInvalid}>
          Save
        </Button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>

      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span>v{chrome.runtime.getManifest().version}</span>
        <a
          href="https://github.com/thilllon/tab-organizer"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          GitHub
        </a>
      </p>
    </main>
  );
};
