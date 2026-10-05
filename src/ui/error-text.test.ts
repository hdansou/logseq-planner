import { describe, expect, it } from "vitest";
import { errorText } from "./html";

describe("errorText (N19: the host rejects with plain objects, not Errors)", () => {
  it("gives an Error's message", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
  });
  it("gives the message of a plain object that has one (a host error crossing the plugin bridge)", () => {
    expect(errorText({ message: "Extra inputs passed", data: { status: 500 } })).toBe("Extra inputs passed");
  });
  it("gives a string as it is, and other values as JSON, never [object Object]", () => {
    expect(errorText("plain")).toBe("plain");
    expect(errorText({ code: 7 })).toBe('{"code":7}');
    expect(errorText(null)).toBe("null");
    expect(errorText(undefined)).toBe("undefined");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(errorText(loop)).toBe("Unknown error");
  });
});
