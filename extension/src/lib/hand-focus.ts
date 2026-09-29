/**
 * Hands focus back to the message box after a control that disappears when it
 * is pressed (Send turns into Stop, Stop back into Send, "Jump to latest" goes
 * once the view is at the bottom), so focus does not fall to the page.
 *
 * Only after a pointer press, unless the caller says a keyboard press is safe
 * too: after Stop or Jump the box is idle, so a second Enter from the keyboard
 * would land in it and send whatever draft is there. After Send the box is
 * busy and ignores Enter, so Send passes `keyboardToo`.
 *
 * Never over a text selection: focusing the box would clear it before the
 * user could copy it.
 */
export function handFocusBack(box: HTMLElement | null, { pointer, keyboardToo = false }: { pointer: boolean; keyboardToo?: boolean }): void {
  if (!box || (!pointer && !keyboardToo)) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  box.focus();
}
