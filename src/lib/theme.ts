/**
 * Dark mode (spec §12 Phase 6). The stylesheet ships a `.dark` palette behind
 * `@custom-variant dark (&:is(.dark *))`, so the only thing needed at runtime is the `dark`
 * class on `<html>` - there is no theme *setting*, the extension simply follows the OS.
 *
 * The app page calls `followSystemTheme()` once at startup; everything that decides what
 * the class list should look like lives in `withDarkClass`, which is pure and unit-tested (the
 * DOM half cannot be: vitest runs in Node without a DOM).
 */

export const DARK_CLASS = 'dark';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * The class attribute `<html>` should carry for the given preference. Other classes are kept and
 * their order preserved (a stray second `dark` is collapsed), so this can run over an element
 * something else also writes to.
 */
export function withDarkClass(className: string, dark: boolean): string {
  const classes = className.split(/\s+/).filter((name) => name !== '' && name !== DARK_CLASS);
  if (dark) {
    classes.push(DARK_CLASS);
  }
  return classes.join(' ');
}

/**
 * Applies `matchMedia('(prefers-color-scheme: dark)')` to `<html>` and keeps following it.
 *
 * `color-scheme` is set alongside the class so Chrome's own widgets - form controls, scrollbars,
 * the canvas behind the page - switch with it.
 */
export function followSystemTheme(): void {
  const root = document.documentElement;
  const apply = (dark: boolean): void => {
    root.className = withDarkClass(root.className, dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  };
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  apply(media.matches);
  media.addEventListener('change', (event) => {
    apply(event.matches);
  });
}
