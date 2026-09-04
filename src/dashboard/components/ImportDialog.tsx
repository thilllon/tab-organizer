import { Upload } from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/dashboard/lib/errors';
import { pluralize } from '@/dashboard/lib/format';
import {
  buildImportPreview,
  checkImportSize,
  fileReadError,
  formatImportTotals,
  type ImportPreview,
  importButtonLabel,
  importFormatLabel,
  utf8ByteLength,
} from '@/dashboard/lib/import-preview';
import { type ImportFormat, importSessions } from '@/sessions/import';
import { sessionRepo } from '@/sessions/storage';
import type { Session } from '@/types';

/** Extensions the picker offers; every one of them is handled by a parser in import.ts. */
export const IMPORT_ACCEPT = '.json,.html,.htm,.md,.txt';

const TEXTAREA_LABEL = 'Paste sessions, bookmarks or links';

type ParsedInput =
  | { kind: 'empty' }
  | { kind: 'error'; error: string }
  | {
      kind: 'ready';
      format: ImportFormat;
      sessions: Session[];
      warnings: string[];
      preview: ImportPreview;
    };

export interface ImportDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called with the number of sessions written; the dashboard shows the confirmation. */
  onImported(count: number): void;
}

/**
 * File picker + paste box for spec §8's import. The parsers are pure (`src/sessions/import.ts`),
 * so the whole preview — detected format, warnings, the session → window → tab tree and the
 * totals — is computed from the text before a single write happens. Committing writes each
 * session through `sessionRepo.put`, which takes the Web Lock per session.
 */
export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // A dialog reopened after an import must not still show the previous one's preview.
  useEffect(() => {
    if (!open) {
      setText('');
      setFileName(undefined);
      setError(undefined);
      setBusy(false);
    }
  }, [open]);

  /**
   * Parse + preview, recomputed only when the text itself changes (a keystroke in the paste box,
   * or a file that finished reading). `Date.now()` is read here rather than passed in: it only
   * stamps the imported sessions' createdAt/updatedAt, and the ones this build produces are the
   * ones the commit below writes.
   */
  const parsed = useMemo<ParsedInput>(() => {
    if (text.trim() === '') {
      return { kind: 'empty' };
    }
    const size = checkImportSize(utf8ByteLength(text));
    if (!size.ok) {
      return { kind: 'error', error: size.error };
    }
    const result = importSessions(text, Date.now());
    if (result.format === null) {
      return { kind: 'error', error: result.error };
    }
    return {
      kind: 'ready',
      format: result.format,
      sessions: result.sessions,
      warnings: result.warnings,
      preview: buildImportPreview(result.sessions),
    };
  }, [text]);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    // Checked before the read, so an oversized file is never pulled into memory at all.
    const size = checkImportSize(file.size);
    if (!size.ok) {
      setText('');
      setFileName(file.name);
      setError(size.error);
      return;
    }
    setBusy(true);
    file
      .text()
      .then((content) => {
        setFileName(file.name);
        setError(undefined);
        setText(content);
      })
      .catch((err: unknown) => {
        setText('');
        setError(fileReadError(err));
      })
      .finally(() => setBusy(false));
  };

  const commit = async () => {
    if (parsed.kind !== 'ready') {
      return;
    }
    setBusy(true);
    try {
      for (const session of parsed.sessions) {
        await sessionRepo.put(session);
      }
      onImported(parsed.sessions.length);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const shownError = error ?? (parsed.kind === 'error' ? parsed.error : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import sessions</DialogTitle>
          <DialogDescription>
            A Tab Organizer JSON export, a bookmarks HTML file, Markdown or a plain list of links.
            Imported sessions are added to the saved list on this device; nothing is uploaded.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="import-file">Choose a file</Label>
          <Input id="import-file" type="file" accept={IMPORT_ACCEPT} onChange={handleFile} />
          {fileName !== undefined && <p className="text-xs text-muted-foreground">{fileName}</p>}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="import-text">{TEXTAREA_LABEL}</Label>
          <textarea
            id="import-text"
            aria-label={TEXTAREA_LABEL}
            value={text}
            spellCheck={false}
            rows={5}
            placeholder="https://example.com/&#10;- [Docs](https://example.com/docs)"
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            onChange={(event) => {
              setError(undefined);
              setFileName(undefined);
              setText(event.target.value);
            }}
          />
        </div>

        {shownError !== undefined && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {shownError}
          </p>
        )}

        {parsed.kind === 'ready' && (
          <div className="grid gap-2">
            <p className="text-sm">
              Detected <strong>{importFormatLabel(parsed.format)}</strong> ·{' '}
              {formatImportTotals(parsed.preview)}
            </p>
            {parsed.warnings.length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {parsed.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="max-h-64 overflow-y-auto rounded-md border p-2">
              <ul className="space-y-2">
                {parsed.preview.sessions.map((previewSession, sessionIndex) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview names are not unique
                    key={`session-${sessionIndex}`}
                  >
                    <p className="truncate text-sm font-medium">{previewSession.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pluralize(previewSession.windowCount, 'window')} ·{' '}
                      {pluralize(previewSession.tabCount, 'tab')}
                    </p>
                    <ul className="mt-1 ml-2 space-y-1 border-l pl-2">
                      {previewSession.windows.map((previewWindow) => (
                        <li key={previewWindow.number}>
                          <p className="text-xs font-medium">
                            Window {previewWindow.number} ·{' '}
                            {pluralize(previewWindow.tabCount, 'tab')}
                          </p>
                          <ul className="text-xs text-muted-foreground">
                            {previewWindow.titles.map((title, titleIndex) => (
                              <li
                                // biome-ignore lint/suspicious/noArrayIndexKey: titles repeat
                                key={`title-${titleIndex}`}
                                className="truncate"
                              >
                                {title}
                              </li>
                            ))}
                            {previewWindow.moreTabs > 0 && (
                              <li>+{pluralize(previewWindow.moreTabs, 'more tab')}</li>
                            )}
                          </ul>
                        </li>
                      ))}
                      {previewSession.moreWindows > 0 && (
                        <li className="text-xs text-muted-foreground">
                          +{pluralize(previewSession.moreWindows, 'more window')}
                        </li>
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
              {parsed.preview.moreSessions > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  +{pluralize(parsed.preview.moreSessions, 'more session')}
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={parsed.kind !== 'ready' || busy} onClick={() => void commit()}>
            <Upload />
            {parsed.kind === 'ready' ? importButtonLabel(parsed.sessions.length) : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
