import type { App, EventRef, TAbstractFile, TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { SearchIndex } from "../src/search-index.js";

function note(path: string, content: string): TFile & { content: string } {
  const name = path.split("/").at(-1) ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ""),
    extension: "md",
    stat: { ctime: 1, mtime: 2, size: content.length },
    vault: undefined,
    parent: null,
    content,
  } as unknown as TFile & { content: string };
}

function folder(path: string, children: TAbstractFile[]): TFolder {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    children,
    vault: undefined,
    parent: null,
    isRoot: () => false,
  } as unknown as TFolder;
}

describe("SearchIndex scope", () => {
  it("walks only configured roots instead of enumerating the entire vault", async () => {
    const approved = note("Approved/Plan.md", "approved roadmap evidence");
    const outside = note("Private/Secret.md", "outside confidential material");
    const roots = new Map<string, TAbstractFile>([
      ["Approved", folder("Approved", [approved])],
      ["Private", folder("Private", [outside])],
    ]);
    const on = vi.fn(() => ({} as EventRef));
    const app = {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => roots.get(path) ?? null),
        cachedRead: vi.fn(async (file: TFile & { content?: string }) => file.content ?? ""),
        on,
        offref: vi.fn(),
      },
    } as unknown as App;

    const index = new SearchIndex(app, ["Approved"], ".second-brain");
    await index.initialize();

    expect(index.search("roadmap", undefined, 10).map(result => result.path)).toEqual(["Approved/Plan.md"]);
    expect(index.search("confidential", undefined, 10)).toEqual([]);
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledTimes(1);
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith("Approved");
    index.dispose();
  });
});
