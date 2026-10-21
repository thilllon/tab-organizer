/**
 * Classes for the box that holds a row's icon buttons (a tab row's Go to tab / Close tab, a
 * group's or a window's Export, ...). The rows themselves light up with `bg-accent` on hover,
 * which is exactly the ghost button's own hover colour, so a hovered button vanished into its row
 * and the user could not see which action they were about to click. Inside these rows a ghost
 * button gets the stronger `input` token behind it and the full foreground colour for its icon on
 * hover, on keyboard focus and while its menu is open.
 *
 * Written as descendant selectors on the container so the stock `src/components/ui/button.tsx`
 * stays as the shadcn CLI wrote it; `data-variant` is the attribute that component sets. The extra
 * attribute in the selector also outranks the variant's own `hover:` classes, dark mode included.
 */
export const ROW_ACTIONS_CLASS = [
  '[&_[data-variant=ghost]]:text-muted-foreground',
  '[&_[data-variant=ghost]:hover]:bg-input',
  '[&_[data-variant=ghost]:hover]:text-foreground',
  '[&_[data-variant=ghost]:focus-visible]:bg-input',
  '[&_[data-variant=ghost]:focus-visible]:text-foreground',
  '[&_[data-variant=ghost][aria-expanded=true]]:bg-input',
  '[&_[data-variant=ghost][aria-expanded=true]]:text-foreground',
].join(' ');
