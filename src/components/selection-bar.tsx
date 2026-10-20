import { Copy, EllipsisVertical, Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/i18n';
import { type CopyFormat, copyFormatItems, selectionLabel } from '@/lib/tab-selection';

interface SelectionBarProps {
  count: number;
  /** A save or a restore is running: saving has to wait, copying and closing do not. */
  busy: boolean;
  onClear(): void;
  onSave(): void;
  onSaveAndClose(): void;
  onCopy(format: CopyFormat): void;
  onClose(): void;
  onSelectBySite(mode: 'like' | 'unlike'): void;
}

/**
 * What the Open tabs view shows in place of its heading while tabs are ticked: how many, and what
 * can be done with exactly those. The three things done most are buttons; the rest is behind the
 * menu. It is presentational - the view holds the selection and does the work.
 */
export function SelectionBar({
  count,
  busy,
  onClear,
  onSave,
  onSaveAndClose,
  onCopy,
  onClose,
  onSelectBySite,
}: SelectionBarProps) {
  const others = copyFormatItems().filter((item) => item.format !== 'links');

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('openClearSelection')}
          title={t('openClearSelection')}
          onClick={onClear}
        >
          <X />
        </Button>
        <p
          aria-live="polite"
          title={selectionLabel(count)}
          className="truncate text-lg font-semibold"
        >
          {selectionLabel(count)}
        </p>
      </div>
      <Button variant="outline" onClick={onSave} disabled={busy} title={t('openSaveTabsTitle')}>
        <Save />
        {t('commonSave')}
      </Button>
      <Button variant="outline" onClick={() => onCopy('links')} title={t('openCopyTitle')}>
        <Copy />
        {t('openCopy')}
      </Button>
      <Button variant="outline" onClick={onClose} title={t('openCloseTabsTitle')}>
        <X />
        {t('commonClose')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('openMoreActions')}
            title={t('openMoreActions')}
          >
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onSaveAndClose} disabled={busy}>
            {t('openSaveAndClose')}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t('openCopyAs')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {others.map((item) => (
                <DropdownMenuItem key={item.format} onSelect={() => onCopy(item.format)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSelectBySite('like')}>
            {t('openSelectLike')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectBySite('unlike')}>
            {t('openSelectUnlike')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
