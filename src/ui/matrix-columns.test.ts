// N76: in Every value the Matrix's columns shrink to fit the view down to 130 px before the grid scrolls sideways (were at
// least 220 px: seven values across did not fit, and a drag to a column out of view was hard). Quadrants keep 220 px.
import { describe, expect, it } from "vitest";
import matrix from "./matrix.css?inline";

const rule = (selector: string) => {
  const at = matrix.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return matrix.slice(matrix.indexOf("{", at) + 1, matrix.indexOf("}", at));
};

describe("Matrix columns (N76)", () => {
  it("Every value: columns of at least 130 px; the grid's default stays 220 px", () => {
    expect(rule(".pl-mx")).toMatch(/minmax\(220px, 1fr\)/);
    expect(rule('.pl-mx[data-mx-layout="values"]')).toMatch(/grid-template-columns:\s*max-content repeat\(var\(--pl-mx-cols\), minmax\(130px, 1fr\)\)/);
  });

  it("under 640 px Every value still stacks in one column (the narrow rule names it: it outranks a bare .pl-mx)", () => {
    const narrow = matrix.slice(matrix.indexOf("@container (max-width: 639px)"));
    expect(narrow).toMatch(/\.pl-mx\[data-mx-layout="values"\][^{]*\{ grid-template-columns: 1fr;|,\s*\.pl-mx\[data-mx-layout="values"\]\s*\{ grid-template-columns: 1fr;/);
  });
});
