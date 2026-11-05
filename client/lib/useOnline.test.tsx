// PWA P3 (owner-approved, 2026-11-05): whether the browser says it is online, kept current by its own
// "online"/"offline" events. Only the browser's word: true can't prove a server is reachable (the same rule as
// page.tsx's failedSyncStatus), so what this decides is limited to "say you're offline when the device says so".
import { it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnline } from "./useOnline";

let online = true;
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
afterEach(() => { online = true; });

it("starts from what the browser says", () => {
  online = false;
  expect(renderHook(() => useOnline()).result.current).toBe(false);
  online = true;
  expect(renderHook(() => useOnline()).result.current).toBe(true);
});

it("follows the browser's offline and online events", () => {
  const { result } = renderHook(() => useOnline());
  act(() => { online = false; window.dispatchEvent(new Event("offline")); });
  expect(result.current).toBe(false);
  act(() => { online = true; window.dispatchEvent(new Event("online")); });
  expect(result.current).toBe(true);
});

it("removes both listeners when unmounted", () => {
  const added: string[] = [], removed: string[] = [];
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = ((t: string, l: EventListener) => { added.push(t); add(t, l); }) as typeof window.addEventListener;
  window.removeEventListener = ((t: string, l: EventListener) => { removed.push(t); remove(t, l); }) as typeof window.removeEventListener;
  try {
    const { unmount } = renderHook(() => useOnline());
    expect(added).toEqual(expect.arrayContaining(["online", "offline"]));
    unmount();
    expect(removed).toEqual(expect.arrayContaining(["online", "offline"]));
  } finally {
    window.addEventListener = add; window.removeEventListener = remove;
  }
});
