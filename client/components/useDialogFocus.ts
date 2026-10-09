"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

/**
 * A11Y-02: a modal dialog (role="dialog", aria-modal) takes focus when it
 * opens, keeps Tab inside itself, and gives focus back to where it was when it
 * closes. `aria-modal` alone does none of this.
 *
 * Focus goes to the dialog itself (tabIndex -1), so a screen reader announces
 * it by its name and nothing in it is pressed by a stray Enter: the backup
 * prompt's first choice turns backup on. Tab then reaches its controls.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open = true): void {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
    dialog.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !dialog) return;
      const stops = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[aria-hidden='true']"));
      if (stops.length === 0) { e.preventDefault(); return; }
      const first = stops[0], last = stops[stops.length - 1];
      const at = document.activeElement;
      if (!dialog.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (at === first || at === dialog)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (before && before.isConnected) before.focus();
    };
  }, [ref, open]);
}
