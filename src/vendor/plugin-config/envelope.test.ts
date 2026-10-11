import { describe, expect, it } from "vitest";
import { readEnvelope, writeEnvelope } from "./envelope";

describe("envelope { v, config }", () => {
  it("writes the version and the payload", () => {
    expect(JSON.parse(writeEnvelope(2, { a: 1 }))).toEqual({ v: 2, config: { a: 1 } });
  });

  it("reads a value up to the supported version and keeps the keys it does not know", () => {
    const r = readEnvelope('{"v":1,"config":{"a":1},"extra":true}', 2);
    expect(r).toEqual({ ok: true, v: 1, config: { a: 1 }, rest: { extra: true } });
  });

  it("writing it back keeps the unknown keys", () => {
    const r = readEnvelope('{"v":1,"config":{"a":1},"extra":true}', 1);
    if (!r.ok) throw new Error("expected ok");
    expect(JSON.parse(writeEnvelope(r.v, { a: 2 }, r.rest))).toEqual({ v: 1, config: { a: 2 }, extra: true });
  });

  it("reports, never throws, on a value that cannot be used", () => {
    expect(readEnvelope("nope", 1)).toEqual({ ok: false, reason: expect.stringMatching(/JSON/) });
    expect(readEnvelope('{"config":{}}', 1)).toEqual({ ok: false, reason: expect.stringMatching(/version/) });
    expect(readEnvelope('{"v":3,"config":{}}', 2)).toEqual({ ok: false, reason: expect.stringMatching(/newer/) });
    expect(readEnvelope('{"v":1}', 1)).toEqual({ ok: false, reason: expect.stringMatching(/config/) });
  });
});
