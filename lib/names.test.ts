import { describe, expect, it } from "vitest";
import { artName, chogFromQuery, chogLabel } from "./names";

describe("names", () => {
  it("labels by token number", () => expect(chogLabel(7)).toBe("Chog #7"));
  it("shows the art name only when it differs", () => {
    expect(artName({ id: 7, name: "CHOG #1468" })).toBe("CHOG #1468");
    expect(artName({ id: 7, name: "CHOG #7" })).toBeNull();
  });
  it("accepts id and token in the link", () => {
    expect(chogFromQuery(new URLSearchParams("id=7"), 1969)).toBe(7);
    expect(chogFromQuery(new URLSearchParams("token=7"), 1969)).toBe(7);
    expect(chogFromQuery(new URLSearchParams("id=0&token=9"), 1969)).toBe(9);
    expect(chogFromQuery(new URLSearchParams("token=99999"), 1969)).toBeNull();
    expect(chogFromQuery(new URLSearchParams(""), 1969)).toBeNull();
  });
});
