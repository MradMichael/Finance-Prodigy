"use client";

import { useCallback, useRef } from "react";

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

function hasTabStop(el: HTMLElement): boolean {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
    .some((c) => c.tabIndex >= 0 && !(c as HTMLButtonElement).disabled && !c.closest("[aria-hidden='true']"));
}

/**
 * A11Y-05 (owner, session 8): a scrolling area with nothing focusable inside
 * can't be scrolled from the keyboard. Watches one element and makes it a Tab
 * stop only while it overflows and holds no Tab stop of its own; takes the
 * stop away when either stops being true (content changes, resizes).
 * Returns the cleanup.
 */
export function watchScrollFocus(el: HTMLElement): () => void {
  let ours = false;
  const update = () => {
    const overflows = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
    if (overflows && !hasTabStop(el)) {
      if (!ours) { el.tabIndex = 0; ours = true; }
    } else if (ours) {
      el.removeAttribute("tabindex"); ours = false;
    }
  };
  update();
  const mutations = new MutationObserver(update);
  mutations.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "tabindex", "href"] });
  const resizes = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
  resizes?.observe(el);
  return () => { mutations.disconnect(); resizes?.disconnect(); };
}

/** A callback ref for a scrolling area: attaches when the element mounts, detaches when it goes. */
export function useScrollFocus(): (el: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    stop.current?.();
    stop.current = el ? watchScrollFocus(el) : null;
  }, []);
}
