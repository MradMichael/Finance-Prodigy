// VER-05 / AUD-01 (external audit, 2026-08-28): the first component-level
// test in this project. AUD-01 (any signed-in user, admin or not, could
// view /admin) was live-verified via a one-off local Playwright run, which
// proves the fix works today but isn't wired into CI anywhere -- it gives
// no protection against this exact class of regression happening again
// (which is literally how AUD-01 itself came to exist: a real gate was
// silently removed and nothing caught it). This test closes that gap with
// a real, fast, CI-run regression test instead.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AdminPage from "./page";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, back: vi.fn() }),
}));

function seedSession(userId: string, email = "user@example.com", name = "Test User") {
  localStorage.setItem("essa_session_v1", JSON.stringify({ userId, email, name }));
}

function seedUser(overrides: { id: string; isAdmin?: boolean }) {
  const existing = JSON.parse(localStorage.getItem("essa_users_v1") ?? "[]");
  existing.push({
    id: overrides.id, email: `${overrides.id}@example.com`, name: "Test User",
    pwHash: "irrelevant", createdAt: "2026-01-01T00:00:00.000Z",
    ...(overrides.isAdmin !== undefined ? { isAdmin: overrides.isAdmin } : {}),
  });
  localStorage.setItem("essa_users_v1", JSON.stringify(existing));
}

beforeEach(() => {
  localStorage.clear();
  replaceMock.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("not under test")));
});

describe("/admin page gate (AUD-01)", () => {
  it("redirects a signed-in user whose account is NOT isAdmin, without rendering the admin content", async () => {
    seedUser({ id: "u1", isAdmin: true }); // some other account already holds admin
    seedUser({ id: "u2", isAdmin: false });
    seedSession("u2");

    render(<AdminPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("Admin panel")).not.toBeInTheDocument();
  });

  it("renders the admin content for a signed-in user whose account IS isAdmin", async () => {
    seedUser({ id: "u1", isAdmin: true });
    seedSession("u1");

    render(<AdminPage />);

    await waitFor(() => expect(screen.getByText("Admin panel")).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalledWith("/");
  });

  it("redirects when there's no session at all (pre-existing gate, unaffected by the isAdmin fix)", async () => {
    render(<AdminPage />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("Admin panel")).not.toBeInTheDocument();
  });

  it("auto-promotes the first-ever account to admin (migration path) and lets it through the new gate", async () => {
    // No isAdmin set on this account at all -- ensureFirstUserIsAdmin must
    // run before the isAdmin check, or a legitimate first-ever user would
    // be locked out of their own admin page on first visit.
    seedUser({ id: "u1" });
    seedSession("u1");

    render(<AdminPage />);

    await waitFor(() => expect(screen.getByText("Admin panel")).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalledWith("/");
  });
});
