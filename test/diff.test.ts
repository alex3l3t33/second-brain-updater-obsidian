import { describe, expect, it } from "vitest";
import { compactUnifiedDiff } from "../src/diff.js";

describe("compactUnifiedDiff", () => {
  it("shows changed lines", () => {
    const diff = compactUnifiedDiff("A.md", "one\ntwo\nthree", "one\nTWO\nthree");
    expect(diff).toContain("-two");
    expect(diff).toContain("+TWO");
  });

  it("reports no changes", () => {
    expect(compactUnifiedDiff("A.md", "same", "same")).toContain("(no changes)");
  });
});
