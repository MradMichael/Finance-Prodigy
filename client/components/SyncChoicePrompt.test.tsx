// Opt-in sync, part 3 -- the prompt's two variants. The page-level test
// (app/page.sync-opt-in.test.tsx) covers when it appears and what a choice
// writes; this covers what it says and offers.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SyncChoicePrompt from "./SyncChoicePrompt";

afterEach(cleanup);

describe("an account WITH a server copy", () => {
  it("is told the upload happened without asking, and that it is paused", () => {
    render(<SyncChoicePrompt hasServerCopy busy={false} onChoose={vi.fn()} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/copied your data to its server automatically/i);
    expect(text).toMatch(/without\s+asking/i);
    expect(text).toMatch(/paused until you make one/i);
  });

  it("is offered all three answers, delete included", () => {
    const onChoose = vi.fn();
    render(<SyncChoicePrompt hasServerCopy busy={false} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: /keep backing up/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop, and delete the copy/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop, but keep the existing copy/i }));
    expect(onChoose.mock.calls.map((c) => c[0])).toEqual(["on", "off-delete", "off-keep"]);
  });
});

describe("an account with NO server copy", () => {
  it("is asked plainly, with backup off unless turned on, and no delete to offer", () => {
    const onChoose = vi.fn();
    render(<SyncChoicePrompt hasServerCopy={false} busy={false} onChoose={onChoose} />);
    expect(document.body.textContent).toMatch(/off unless you turn it on/i);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /turn backup on/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep it off/i }));
    expect(onChoose.mock.calls.map((c) => c[0])).toEqual(["on", "off-keep"]);
  });
});

describe("both variants", () => {
  it.each([true, false])("state both costs of backup off (hasServerCopy=%s)", (has) => {
    render(<SyncChoicePrompt hasServerCopy={has} busy={false} onChoose={vi.fn()} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/can.t sign in on another device/i);
    expect(text).toMatch(/recovery code only works on this device/i);
    // ...but only without a server copy: a kept copy can still be signed in to
    // from another device (owner, 2026-10-06).
    expect(text.replace(/\s+/g, " ")).toContain("With backup off and no copy left on the server, your data stays in this browser only");
  });

  // Session 2 item F (owner-approved in session 3): the prompt says what "on"
  // also does since SYNC-1 step 3, in the privacy page's approved sentence,
  // right after what the copy is for.
  it.each([true, false])("say that backup on also fetches the copy on open (hasServerCopy=%s)", (has) => {
    render(<SyncChoicePrompt hasServerCopy={has} busy={false} onChoose={vi.fn()} />);
    const main = screen.getByRole("dialog").querySelector("h2 + p")?.textContent?.replace(/\s+/g, " ") ?? "";
    expect(main).toMatch(/so the server can read it\. With backup on, each of your devices also fetches the copy when you open or return to ESSA, and combines it with what it already has\.$/);
  });

  it("is a blocking dialog: no close or cancel", () => {
    render(<SyncChoicePrompt hasServerCopy busy={false} onChoose={vi.fn()} />);
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(screen.queryByRole("button", { name: /close|cancel|later|not now/i })).toBeNull();
  });
});
