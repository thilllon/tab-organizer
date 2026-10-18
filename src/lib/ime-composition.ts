/** The parts of a React keyboard event the check reads. */
interface ComposingKeyEvent {
  nativeEvent: { isComposing: boolean };
  keyCode: number;
}

/**
 * Enter pressed to confirm an IME composition (Japanese, Korean, Chinese, …) reaches the input as
 * a keydown too and must not commit the rename. `isComposing` is the standard signal; keyCode 229
 * is the legacy one some IMEs still send with `isComposing` false.
 */
export function isComposingEnter(event: ComposingKeyEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
