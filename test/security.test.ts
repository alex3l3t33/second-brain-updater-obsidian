import { describe, expect, it } from "vitest";
import { assertAllowedPath, isPathAllowed, normalizeAllowedRoots, sanitizeVaultPath, sha256 } from "../src/security.js";

describe("vault path security", () => {
  it("normalizes a relative path", () => {
    expect(sanitizeVaultPath("./02 Projects/Test.md")).toBe("02 Projects/Test.md");
  });

  it("rejects traversal and absolute paths", () => {
    expect(() => sanitizeVaultPath("../Secrets.md")).toThrow(/traversal/);
    expect(() => sanitizeVaultPath("/tmp/Test.md")).toThrow(/Absolute/);
    expect(() => sanitizeVaultPath("C:\\tmp\\Test.md")).toThrow(/Absolute/);
  });

  it("enforces allowed roots and excludes internal state", () => {
    const roots = ["02 Projects", "04 Knowledge"];
    expect(isPathAllowed("02 Projects/App/Plan.md", roots, ".second-brain")).toBe(true);
    expect(isPathAllowed("01 Daily/2026-09-27.md", roots, ".second-brain")).toBe(false);
    expect(isPathAllowed(".second-brain/state/x.md", [".second-brain"], ".second-brain")).toBe(false);
  });

  it("normalizes roots and rejects overlap with internal storage", () => {
    expect(normalizeAllowedRoots(["02 Projects/", "02 Projects", "04 Knowledge"], ".second-brain")).toEqual(["02 Projects", "04 Knowledge"]);
    expect(() => normalizeAllowedRoots([".second-brain/backups"], ".second-brain")).toThrow(/overlaps internal/);
    expect(() => normalizeAllowedRoots(["."], ".second-brain")).toThrow();
  });

  it("allows only markdown targets", () => {
    expect(assertAllowedPath("02 Projects/Test.md", ["02 Projects"], ".second-brain")).toBe("02 Projects/Test.md");
    expect(() => assertAllowedPath("02 Projects/file.pdf", ["02 Projects"], ".second-brain")).toThrow(/Markdown/);
  });

  it("hashes deterministically", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
