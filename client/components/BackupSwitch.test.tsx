// Opt-in sync, part 2 -- the Profile switch. The component states the two
// real costs of leaving backup off, and offers delete-or-keep on the way off.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import BackupSwitch from "./BackupSwitch";

afterEach(cleanup);

describe("BackupSwitch", () => {
  it("off: says so, and states both costs of leaving it off", () => {
    render(<BackupSwitch on={false} busy={false} onChoose={vi.fn()} />);
    expect(screen.getByRole("switch", { name: /automatic backup/i }).getAttribute("aria-checked")).toBe("false");
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/can.t sign in on another device/i);
    expect(text).toMatch(/recovery code only works on this device/i);
  });

  it("turning on is one act", () => {
    const onChoose = vi.fn();
    render(<BackupSwitch on={false} busy={false} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("switch", { name: /automatic backup/i }));
    expect(onChoose).toHaveBeenCalledWith("on");
  });

  it("on: says what is uploaded and that the server can read it", () => {
    render(<BackupSwitch on busy={false} onChoose={vi.fn()} />);
    expect(screen.getByRole("switch", { name: /automatic backup/i }).getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toMatch(/server can read it/i);
  });

  it("turning off asks delete-or-keep, and chooses nothing until answered", () => {
    const onChoose = vi.fn();
    render(<BackupSwitch on busy={false} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("switch", { name: /automatic backup/i }));
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /turn off and delete the server copy/i }));
    expect(onChoose).toHaveBeenCalledWith("off-delete");
  });

  it("off, keep is its own answer", () => {
    const onChoose = vi.fn();
    render(<BackupSwitch on busy={false} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("switch", { name: /automatic backup/i }));
    fireEvent.click(screen.getByRole("button", { name: /turn off, keep the existing copy/i }));
    expect(onChoose).toHaveBeenCalledWith("off-keep");
  });

  it("cancel leaves backup on and chooses nothing", () => {
    const onChoose = vi.fn();
    render(<BackupSwitch on busy={false} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("switch", { name: /automatic backup/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /turn off and delete/i })).toBeNull();
  });
});
