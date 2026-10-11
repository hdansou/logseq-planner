import { describe, expect, it } from "vitest";
import { pageTitle, propertyKey } from "./names";

describe("names", () => {
  it("a page is `Plugin <role>: <Plugin name>`", () => {
    expect(pageTitle("views", "Planner")).toBe("Plugin views: Planner");
    expect(pageTitle("settings", "Outline Canvas")).toBe("Plugin settings: Outline Canvas");
    expect(pageTitle("state", "Planner")).toBe("Plugin state: Planner");
  });

  it("a property key is `<plugin>-<role>`, lower case and hyphenated", () => {
    expect(propertyKey("Planner", "view-config")).toBe("planner-view-config");
    expect(propertyKey("Outline Canvas", "ui-state")).toBe("outline-canvas-ui-state");
    expect(propertyKey("planner", "settings")).toBe("planner-settings");
  });

  it("rejects a plugin name with nothing usable in it", () => {
    expect(() => propertyKey("  ", "settings")).toThrow(/plugin name/);
    expect(() => pageTitle("views", "")).toThrow(/plugin name/);
  });
});
