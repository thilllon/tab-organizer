import { type ReactNode, useEffect, useState } from 'react';

import { NativeSelect } from '@/components/native-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  CUSTOM_INTERVAL,
  HISTORY_INTERVAL_MAX_MINUTES,
  HISTORY_INTERVAL_MIN_MINUTES,
  HISTORY_INTERVALS,
  HISTORY_MAX_MAX,
  HISTORY_MAX_MIN,
  intervalLabel,
  intervalSelectValue,
  isRestoreLazy,
  lazyLabel,
  parseHistoryInterval,
  parseIntervalMinutes,
  parseSnapshotLimit,
  RESTORE_LAZY_MODES,
} from '@/lib/session-settings';
import type { SessionSettings } from '@/types';

interface SessionSettingsFieldsProps {
  settings: SessionSettings;
  /** True while the settings are still being read, or a write is in flight. */
  disabled: boolean;
  /** Every change writes straight through `useSessionSettings().update` - there is no Save button. */
  onChange(patch: Partial<SessionSettings>): void;
  /** Distinguishes the control ids of the two instances the Settings view renders. */
  idPrefix: string;
  /**
   * Which of the four controls to render: the app's Settings view shows the on/off switch first
   * and folds the rest into "Advanced", because a safety net people never think about should not
   * greet them with an interval and a ring size.
   */
  subset: 'basic' | 'advanced';
}

/**
 * The four `SessionSettings` controls, drawn twice by the Settings dialog's "Sessions" section:
 * the snapshot switch (`basic`) and, under its "Advanced" fold, the other three (`advanced`).
 * Presentational only: the Settings view holds `useSessionSettings()` and does the writing.
 *
 * The service worker re-arms the history alarm from its own `storage.onChanged` listener, so
 * nothing here touches `chrome.alarms` (AGENTS.md "Sessions rules").
 */
export function SessionSettingsFields({
  settings,
  disabled,
  onChange,
  idPrefix,
  subset,
}: SessionSettingsFieldsProps) {
  const showBasic = subset === 'basic';
  const showAdvanced = subset === 'advanced';
  const enabledId = `${idPrefix}-history-enabled`;
  const intervalId = `${idPrefix}-history-interval`;
  const customIntervalId = `${idPrefix}-history-interval-custom`;
  const maxId = `${idPrefix}-history-max`;
  const lazyId = `${idPrefix}-restore-lazy`;

  // The number input is edited as text ("" and "2" happen on the way to "20"), so it keeps a
  // draft and only writes a parsed, clamped value on blur/Enter. Re-seeded whenever the stored
  // value changes -- including when another app tab writes it.
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

  // "Custom" shows a minutes input. It stays open after the user picks it even while the stored
  // value is still a preset, and closes again when a preset is picked.
  const [customOpen, setCustomOpen] = useState(false);
  const intervalChoice = intervalSelectValue(settings.historyIntervalMinutes, customOpen);
  const [intervalDraft, setIntervalDraft] = useState(String(settings.historyIntervalMinutes));
  useEffect(() => {
    setIntervalDraft(String(settings.historyIntervalMinutes));
  }, [settings.historyIntervalMinutes]);

  const commitInterval = () => {
    const parsed = parseIntervalMinutes(intervalDraft);
    if (parsed === undefined) {
      setIntervalDraft(String(settings.historyIntervalMinutes));
      return;
    }
    setIntervalDraft(String(parsed));
    if (parsed !== settings.historyIntervalMinutes) {
      onChange({ historyIntervalMinutes: parsed });
    }
  };

  const intervalDisabled = disabled || !settings.historyEnabled;

  return (
    <div className="space-y-5">
      {showBasic && (
        <SettingRow label="Automatic snapshots" htmlFor={enabledId}>
          <Switch
            id={enabledId}
            checked={settings.historyEnabled}
            disabled={disabled}
            title="Save what is open on a timer, without asking"
            onCheckedChange={(checked) => onChange({ historyEnabled: checked })}
          />
        </SettingRow>
      )}

      {showAdvanced && (
        <SettingRow
          label="Snapshot interval"
          htmlFor={intervalId}
          hint={`Custom: ${HISTORY_INTERVAL_MIN_MINUTES} to ${HISTORY_INTERVAL_MAX_MINUTES} minutes.`}
        >
          <NativeSelect
            id={intervalId}
            value={intervalChoice}
            disabled={intervalDisabled}
            onChange={(event) => {
              const value = event.target.value;
              if (value === CUSTOM_INTERVAL) {
                setCustomOpen(true);
                return;
              }
              const minutes = parseHistoryInterval(value);
              if (minutes !== undefined) {
                setCustomOpen(false);
                onChange({ historyIntervalMinutes: minutes });
              }
            }}
          >
            {HISTORY_INTERVALS.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {intervalLabel(minutes)}
              </option>
            ))}
            <option value={CUSTOM_INTERVAL}>Custom</option>
          </NativeSelect>
          {intervalChoice === CUSTOM_INTERVAL && (
            <>
              <Input
                id={customIntervalId}
                aria-label="Custom snapshot interval in minutes"
                type="number"
                inputMode="numeric"
                min={HISTORY_INTERVAL_MIN_MINUTES}
                max={HISTORY_INTERVAL_MAX_MINUTES}
                step={1}
                className="h-8 w-20"
                value={intervalDraft}
                disabled={intervalDisabled}
                onChange={(event) => setIntervalDraft(event.target.value)}
                onBlur={commitInterval}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitInterval();
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </>
          )}
        </SettingRow>
      )}

      {showAdvanced && (
        <SettingRow
          label="Keep last"
          htmlFor={maxId}
          hint="Older snapshots are removed first. Protected ones are never counted."
        >
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
          <span className="text-sm text-muted-foreground">snapshots</span>
        </SettingRow>
      )}

      {showAdvanced && (
        <SettingRow
          label="Lazy restore"
          htmlFor={lazyId}
          hint="Opens tabs without loading them until you visit them."
        >
          <NativeSelect
            id={lazyId}
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
          </NativeSelect>
        </SettingRow>
      )}
    </div>
  );
}

/**
 * One setting per line: the label (and an optional grey hint) on the left, the control on the
 * right. The same shape as `Field` in the Settings view, so these rows line up with the sorting
 * rows above them; the label is a real `<label>` pointing at the control.
 */
function SettingRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-48 flex-1">
        <Label htmlFor={htmlFor} className="text-sm font-normal">
          {label}
        </Label>
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {/* The hint doubles as the tooltip of every control in the row without a title of its own. */}
      <div className="flex items-center gap-2" title={hint}>
        {children}
      </div>
    </div>
  );
}
