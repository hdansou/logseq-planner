import { describe, expect, it } from "vitest";
import { propertySchemaFor } from "./schema";

describe("propertySchemaFor", () => {
  it("creates a missing property hidden; a text property is the host's default type", () => {
    expect(propertySchemaFor(null, "default")).toEqual({ type: "default", hide: true });
    expect(propertySchemaFor(null, "string")).toEqual({ type: "string", hide: true });
  });

  it("only hides an existing one, never changes its type, and does nothing when it is hidden", () => {
    expect(propertySchemaFor({ type: "string", hide: false }, "default")).toEqual({ hide: true });
    expect(propertySchemaFor({ type: "default", hide: true }, "default")).toBeNull();
  });
});
