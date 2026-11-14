// Session 52 (owner, R5): hover styles only where the device can hover. On a touch screen a tap leaves the tapped
// control in its hover state until the next tap, and the app dims controls on hover (hover:opacity-80 and its
// kin, about 150 uses): the Recurring "Confirm" pill fell to 3.7:1 while it stuck (WCAG 1.4.3 needs 4.5:1).
// Tailwind's hoverOnlyWhenSupported puts every hover: class inside @media (hover: hover). jsdom has no media
// queries: the built stylesheet is checked live.
import { it, expect } from "vitest";
import config from "../tailwind.config";

it("hover: classes apply only where the device can hover", () => {
  expect(config.future).toMatchObject({ hoverOnlyWhenSupported: true });
});
