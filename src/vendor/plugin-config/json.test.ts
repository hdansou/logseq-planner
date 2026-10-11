import { describe, expect, it } from "vitest";
import { fenceJson, propertyText, unfenceJson } from "./json";

const compact = '{"v":1,"config":{"a":[1,2]}}';

describe("fenced JSON in a text property", () => {
  it("fenceJson writes pretty JSON in a json fence; unfenceJson gives the compact text back", () => {
    const fenced = fenceJson(compact);
    expect(fenced).toBe('```json\n{\n  "v": 1,\n  "config": {\n    "a": [\n      1,\n      2\n    ]\n  }\n}\n```');
    expect(unfenceJson(fenced)).toBe(compact);
  });

  it("unfenceJson takes an unfenced value and compacts it when it parses", () => {
    expect(unfenceJson(compact)).toBe(compact);
    expect(unfenceJson('{ "v": 1 }')).toBe('{"v":1}');
    expect(unfenceJson("not json")).toBe("not json");
    expect(unfenceJson("```json\nnot json\n```")).toBe("not json");
  });

  it("fenceJson refuses text that is not JSON", () => {
    expect(() => fenceJson("not json")).toThrow(/JSON/);
  });

  it("propertyText takes a string property or the value object of a text property", () => {
    expect(propertyText("x")).toBe("x");
    expect(propertyText({ id: 1, value: "y", title: "z" })).toBe("y");
    expect(propertyText({ id: 1, title: "z" })).toBe("z");
    expect(propertyText(null)).toBeNull();
    expect(propertyText(undefined)).toBeNull();
    expect(propertyText(5)).toBeNull();
  });
});
