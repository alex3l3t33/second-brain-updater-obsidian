import { describe, expect, it } from "vitest";
import { parsePreviewRequest } from "../src/validation.js";

const hash = "a".repeat(64);

describe("parsePreviewRequest", () => {
  it("accepts a valid update", () => {
    const result = parsePreviewRequest({
      changes: [{ operation: "update", path: "02 Projects/Test.md", content: "# Test", expectedHash: hash }],
      reason: " refresh note ",
      sourceId: "daily:2026-09-27T08:00:00Z",
      scheduled: true,
    });
    expect(result.reason).toBe("refresh note");
    expect(result.changes[0]?.expectedHash).toBe(hash);
  });

  it("rejects an update without expectedHash", () => {
    expect(() => parsePreviewRequest({
      changes: [{ operation: "update", path: "02 Projects/Test.md", content: "# Test" }],
      reason: "refresh",
    })).toThrow(/expectedHash is required/);
  });

  it("rejects malformed change operations", () => {
    expect(() => parsePreviewRequest({
      changes: [{ operation: "delete", path: "02 Projects/Test.md", content: "" }],
      reason: "bad",
    })).toThrow(/create or update/);
  });

  it("rejects malformed hashes", () => {
    expect(() => parsePreviewRequest({
      changes: [{ operation: "update", path: "02 Projects/Test.md", content: "# Test", expectedHash: "123" }],
      reason: "bad",
    })).toThrow(/SHA-256/);
  });
});
