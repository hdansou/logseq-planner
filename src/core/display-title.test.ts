import { describe, expect, it } from "vitest";
import { displayTitle, LINK_PLACEHOLDER, refUuids, titlesByUuid } from "./display-title";

const SITE = "6a000000-0000-4000-8000-000000000001";
const MOBILE = "6a000000-0000-4000-8000-000000000002";
const titles = titlesByUuid([
  { uuid: SITE, title: "Website relaunch" },
  { uuid: MOBILE, title: "Mobile app" },
]);

describe("displayTitle (T04 open item: inline refs show the node's name)", () => {
  it("replaces an inline [[uuid]] ref with the referenced node's title", () => {
    expect(displayTitle(`Draft brief [[${SITE}]]`, titles)).toBe("Draft brief Website relaunch");
  });

  it("replaces several refs and leaves the rest of the text alone", () => {
    expect(displayTitle(`Sync [[${SITE}]] with [[${MOBILE}]] today`, titles)).toBe("Sync Website relaunch with Mobile app today");
  });

  it("shows a neutral placeholder, never the raw uuid, for a node that is not loaded", () => {
    const out = displayTitle("Ask [[6a000000-0000-4000-8000-0000000000ff]] first", titles);
    expect(out).toBe(`Ask ${LINK_PLACEHOLDER} first`);
    expect(out).not.toMatch(/\[\[|[0-9a-f]{8}-/);
  });

  it("drops the brackets of a ref that is not a uuid", () => {
    expect(displayTitle("Read [[Some page]]", titles)).toBe("Read Some page");
  });

  it("is case-insensitive on the uuid and leaves plain titles unchanged", () => {
    expect(displayTitle(`x [[${SITE.toUpperCase()}]]`, titles)).toBe("x Website relaunch");
    expect(displayTitle("Ship homepage", titles)).toBe("Ship homepage");
  });
});

describe("refUuids (titles of linked nodes outside the loaded set)", () => {
  it("collects each inline [[uuid]] once, lower-cased, in order; plain [[text]] and bare uuids are not refs", () => {
    expect(refUuids([`Draft brief [[${SITE}]]`, `Sync [[${SITE.toUpperCase()}]] with [[${MOBILE}]]`, "No refs [[Some page]]", `bare ${MOBILE}`]))
      .toEqual([SITE, MOBILE]);
    expect(refUuids([])).toEqual([]);
  });
});
