import type { App, EventRef, TAbstractFile, TFile, TFolder } from "obsidian";
import type { SearchEntry } from "./types.js";
import { isPathAllowed } from "./security.js";

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC");
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(token => token.trim())
    .filter(token => token.length > 1);
}

function excerpt(content: string, needle: string): string {
  const normalized = normalizeText(content);
  const idx = normalized.indexOf(needle);
  const start = Math.max(0, idx >= 0 ? idx - 120 : 0);
  const end = Math.min(content.length, start + 320);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return "extension" in file && (file as TFile).extension === "md";
}

function isFolder(file: TAbstractFile): file is TFolder {
  return "children" in file;
}

export class SearchIndex {
  private readonly entries = new Map<string, SearchEntry>();
  private eventRefs: EventRef[] = [];

  constructor(
    private readonly app: App,
    private allowedRoots: string[],
    private internalRoot: string,
  ) {}

  async initialize(): Promise<void> {
    await this.rebuild();
    this.eventRefs.push(
      this.app.vault.on("create", file => void this.onCreateOrModify(file)),
      this.app.vault.on("modify", file => void this.onCreateOrModify(file)),
      this.app.vault.on("delete", file => this.entries.delete(file.path)),
      this.app.vault.on("rename", (file, oldPath) => {
        this.entries.delete(oldPath);
        void this.onCreateOrModify(file);
      }),
    );
  }

  dispose(): void {
    for (const ref of this.eventRefs.splice(0)) this.app.vault.offref(ref);
    this.entries.clear();
  }

  async reconfigure(allowedRoots: string[], internalRoot: string): Promise<void> {
    this.allowedRoots = allowedRoots;
    this.internalRoot = internalRoot;
    await this.rebuild();
  }

  private async onCreateOrModify(file: TAbstractFile): Promise<void> {
    if (!isMarkdownFile(file)) return;
    const note = file;
    if (!isPathAllowed(note.path, this.allowedRoots, this.internalRoot)) {
      this.entries.delete(note.path);
      return;
    }
    const content = await this.app.vault.cachedRead(note);
    this.entries.set(note.path, {
      path: note.path,
      title: note.basename,
      content,
      normalized: normalizeText(`${note.path}\n${note.basename}\n${content}`),
      modified: note.stat.mtime,
    });
  }

  async rebuild(): Promise<void> {
    this.entries.clear();
    const files = this.collectAllowedMarkdownFiles();
    const concurrency = 8;
    for (let i = 0; i < files.length; i += concurrency) {
      await Promise.all(files.slice(i, i + concurrency).map(file => this.onCreateOrModify(file)));
    }
  }

  private collectAllowedMarkdownFiles(): TFile[] {
    const files = new Map<string, TFile>();
    const visit = (entry: TAbstractFile): void => {
      if (isFolder(entry)) {
        for (const child of entry.children) visit(child);
        return;
      }
      if (isMarkdownFile(entry) && isPathAllowed(entry.path, this.allowedRoots, this.internalRoot)) {
        files.set(entry.path, entry);
      }
    };

    for (const root of this.allowedRoots) {
      const entry = this.app.vault.getAbstractFileByPath(root);
      if (entry) visit(entry);
    }
    return [...files.values()];
  }

  search(query: string, folder: string | undefined, limit: number): Array<{
    path: string;
    title: string;
    score: number;
    excerpt: string;
    modified: number;
  }> {
    const q = normalizeText(query.trim());
    const queryTokens = tokens(q);
    const folderPrefix = folder ? folder.replace(/\\/g, "/").replace(/\/$/, "") : undefined;
    const scored: Array<{ entry: SearchEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      if (folderPrefix && !(entry.path === folderPrefix || entry.path.startsWith(`${folderPrefix}/`))) continue;
      const path = normalizeText(entry.path);
      const title = normalizeText(entry.title);
      let score = 0;
      if (title === q) score += 30;
      if (title.includes(q)) score += 18;
      if (path.includes(q)) score += 10;
      if (entry.normalized.includes(q)) score += 8;
      for (const token of queryTokens) {
        if (title.includes(token)) score += 6;
        if (path.includes(token)) score += 3;
        if (entry.normalized.includes(token)) score += 1;
      }
      if (score > 0) scored.push({ entry, score });
    }

    return scored
      .sort((a, b) => b.score - a.score || b.entry.modified - a.entry.modified)
      .slice(0, limit)
      .map(({ entry, score }) => ({
        path: entry.path,
        title: entry.title,
        score,
        excerpt: excerpt(entry.content, q),
        modified: entry.modified,
      }));
  }
}
