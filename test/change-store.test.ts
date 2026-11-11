import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { ChangeStore } from "../src/change-store.js";
import type { ChangeSetRecord } from "../src/types.js";

function appWithHiddenAdapter() {
  const folders = new Set<string>([".second-brain"]);
  const files = new Map<string, string>();
  const adapter = {
    async exists(path: string) {
      return folders.has(path) || files.has(path);
    },
    async mkdir(path: string) {
      if (folders.has(path)) throw new Error("Folder already exists.");
      folders.add(path);
    },
    async read(path: string) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`Missing file: ${path}`);
      return content;
    },
    async write(path: string, content: string) {
      files.set(path, content);
    },
  };
  return {
    app: { vault: { adapter } } as unknown as App,
    files,
    folders,
  };
}

describe("ChangeStore hidden storage", () => {
  it("reuses an existing hidden root and persists change sets through the adapter", async () => {
    const { app, files, folders } = appWithHiddenAdapter();
    const store = new ChangeStore(app, ".second-brain");
    const record: ChangeSetRecord = {
      id: "cs_12345678",
      status: "staged",
      createdAt: "2026-10-10T00:00:00.000Z",
      scheduled: false,
      reason: "test",
      requestFingerprint: "fingerprint",
      changes: [],
      items: [],
      warnings: [],
    };

    await store.ensureFolders();
    await store.saveChangeSet(record);

    expect(folders).toContain(".second-brain/change-sets");
    expect(folders).toContain(".second-brain/state");
    expect(files.has(".second-brain/change-sets/cs_12345678.json")).toBe(true);
    await expect(store.getChangeSet(record.id)).resolves.toEqual(record);
  });
});
