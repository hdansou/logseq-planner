// N71: the cell under a drag shows in both modes. Dark mode's 12% tint replaced an 18% grey fill of about the same
// lightness (a Matrix cell rendered (46, 48, 49) over, (44, 44, 47) plain on the stable app): every drop target takes
// `--pl-drop` (stronger in dark) and a 2px inset ring in `--pl-ring`.
import { describe, expect, it } from "vitest";
import theme from "./theme.css?inline";
import kanban from "./kanban.css?inline";
import matrix from "./matrix.css?inline";
import agenda from "./agenda.css?inline";
import calendar from "./calendar.css?inline";

const rule = (css: string, selector: string) => {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
};
const mixPercent = (block: string, token: string) => Number(new RegExp(`${token}:\\s*color-mix\\(in srgb, var\\(--pl-tint\\) (\\d+)%`).exec(block)?.[1]);

describe("drop targets (N71)", () => {
  it("--pl-drop is the light tint-soft, and stronger in dark", () => {
    const light = theme.slice(theme.indexOf(":root {"), theme.indexOf("html.dark {"));
    const dark = rule(theme, "html.dark {");
    expect(light).toMatch(/--pl-drop:\s*var\(--pl-tint-soft\)/);
    expect(mixPercent(dark, "--pl-drop")).toBeGreaterThanOrEqual(2 * mixPercent(dark, "--pl-tint-soft"));
  });

  it.each([
    ["kanban", kanban, ".pl-kb-cell[data-kb-over]"],
    ["matrix cell", matrix, ".pl-mx-cell[data-mx-over]"],
    ["matrix unplaced", matrix, ".pl-mx-unplaced[data-mx-over]"],
    ["agenda", agenda, ".pl-ag-drop[data-ag-over]"],
    ["calendar", calendar, "[data-cal-drop][data-cal-over]"],
  ])("%s: the drop target takes --pl-drop and an inset ring", (_, css, selector) => {
    const block = rule(css, selector);
    expect(block).toMatch(/background:\s*var\(--pl-drop\)/);
    expect(block).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--pl-ring\)/);
  });
});
