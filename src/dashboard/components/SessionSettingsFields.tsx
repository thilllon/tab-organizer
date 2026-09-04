import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  HISTORY_INTERVALS,
  HISTORY_MAX_MAX,
  HISTORY_MAX_MIN,
  intervalLabel,
  isRestoreLazy,
  lazyLabel,
  parseHistoryInterval,
  parseSnapshotLimit,
  RESTORE_LAZY_MODES,
} from '@/dashboard/lib/session-settings';
import { cn } from '@/lib/utils';
import type { SessionSettings } from '@/types';

export interface SessionSettingsFieldsProps {
  settings: SessionSettings;
  /** True while the settings are still being read, or a write is in flight. */
  disabled?: boolean;
  /** Every change writes straight through `useSessionSettings().update` — there is no Save button. */
  onChange(patch: Partial<SessionSettings>): void;
  /** Layout classes: a wrapping row in the dashboard, a stack in the Options card. */
  className?: string;
  /** Distinguishes the control ids when a page renders more than one instance. */
  idPrefix?: string;
}

// A native <select>: the repo has no shadcn Select component and this is the only place two
// would be needed. Styled like `Input` so it sits with the rest of the controls.
const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

/**
 * The four `SessionSettings` controls, shared by the dashboard's settings row and the Options
 * page's "Sessions" card so both surfaces carry the same labels and the same rules. Presentational
 * only: the owning surface holds `useSessionSettings()` and does the writing.
 *
 * The service worker re-arms the history alarm from its own `storage.onChanged` listener, so
 * nothing here touches `chrome.alarms` (AGENTS.md "Sessions rules").
 */
export function SessionSettingsFields({
  settings,
  disabled,
  onChange,
  className,
  idPrefix = 'session-settings',
}: SessionSettingsFieldsProps) {
  const enabledId = `${idPrefix}-history-enabled`;
  const intervalId = `${idPrefix}-history-interval`;
  const maxId = `${idPrefix}-history-max`;
  const lazyId = `${idPrefix}-restore-lazy`;

  // The number input is edited as text ("" and "2" happen on the way to "20"), so it keeps a
  // draft and only writes a parsed, clamped value on blur/Enter. Re-seeded whenever the stored
  // value changes -- including when another surface (the Options page) writes it.
  const [maxDraft, setMaxDraft] = useState(String(settings.historyMaxSnapshots));
  useEffect(() => {
    setMaxDraft(String(settings.historyMaxSnapshots));
  }, [settings.historyMaxSnapshots]);

  const commitMax = () => {
    const parsed = parseSnapshotLimit(maxDraft);
    if (parsed === undefined) {
      setMaxDraft(String(settings.historyMaxSnapshots));
      return;
    }
    setMaxDraft(String(parsed));
    if (parsed !== settings.historyMaxSnapshots) {
      onChange({ historyMaxSnapshots: parsed });
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-3', className)}>
      <div className="flex items-center gap-2">
        <Switch
          id={enabledId}
          checked={settings.historyEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ historyEnabled: checked })}
        />
        <Label htmlFor={enabledId}>Automatic snapshots</Label>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor={intervalId}>Snapshot interval</Label>
        <select
          id={intervalId}
          className={SELECT_CLASS}
          value={String(settings.historyIntervalMinutes)}
          disabled={disabled || !settings.historyEnabled}
          onChange={(event) => {
            const minutes = parseHistoryInterval(event.target.value);
            if (minutes !== undefined) {
              onChange({ historyIntervalMinutes: minutes });
            }
          }}
        >
          {HISTORY_INTERVALS.map((minutes) => (
            <option key={minutes} value={String(minutes)}>
              {intervalLabel(minutes)}
            </option>
          ))}
        </select>
      </div>

      <Label htmlFor={maxId} className="gap-2">
        Keep last
        <Input
          id={maxId}
          type="number"
          inputMode="numeric"
          min={HISTORY_MAX_MIN}
          max={HISTORY_MAX_MAX}
          step={1}
          className="h-8 w-20"
          value={maxDraft}
          disabled={disabled}
          onChange={(event) => setMaxDraft(event.target.value)}
          onBlur={commitMax}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitMax();
            }
          }}
        />
        snapshots
      </Label>

      <div className="flex items-center gap-2">
        <Label htmlFor={lazyId}>Lazy restore</Label>
        <select
          id={lazyId}
          className={SELECT_CLASS}
          value={settings.restoreLazy}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            if (isRestoreLazy(value)) {
              onChange({ restoreLazy: value });
            }
          }}
        >
          {RESTORE_LAZY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {lazyLabel(mode)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
