import type { App } from "obsidian";
import type { AppliedSourceRecord, ChangeSetRecord } from "./types.js";
import { sanitizeVaultPath } from "./security.js";

interface AppliedSourceFile {
  version: 1;
  sources: Record<string, AppliedSourceRecord>;
}

export class ChangeStore {
  constructor(private readonly app: App, private internalRoot: string) {}

  reconfigure(internalRoot: string): void {
    this.internalRoot = internalRoot;
  }

  private get changeSetsRoot(): string {
    return `${sanitizeVaultPath(this.internalRoot)}/change-sets`;
  }

  private get stateRoot(): string {
    return `${sanitizeVaultPath(this.internalRoot)}/state`;
  }

  private get appliedPath(): string {
    return `${this.stateRoot}/applied-sources.json`;
  }

  async ensureFolders(): Promise<void> {
    await this.ensureFolder(sanitizeVaultPath(this.internalRoot));
    await this.ensureFolder(this.changeSetsRoot);
    await this.ensureFolder(this.stateRoot);
  }

  private async ensureFolder(path: string): Promise<void> {
    const pieces = sanitizeVaultPath(path).split("/");
    let current = "";
    for (const piece of pieces) {
      current = current ? `${current}/${piece}` : piece;
      if (await this.app.vault.adapter.exists(current)) continue;
      try {
        await this.app.vault.adapter.mkdir(current);
      } catch (error) {
        if (!(await this.app.vault.adapter.exists(current))) throw error;
      }
    }
  }

  async saveChangeSet(record: ChangeSetRecord): Promise<void> {
    await this.ensureFolders();
    const path = `${this.changeSetsRoot}/${record.id}.json`;
    const content = JSON.stringify(record, null, 2);
    await this.app.vault.adapter.write(path, content);
  }

  async getChangeSet(id: string): Promise<ChangeSetRecord | null> {
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(id)) throw new Error("Invalid change-set ID");
    const path = `${this.changeSetsRoot}/${id}.json`;
    if (!(await this.app.vault.adapter.exists(path))) return null;
    const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as ChangeSetRecord;
    return parsed;
  }

  async getAppliedSource(sourceId: string): Promise<AppliedSourceRecord | null> {
    const state = await this.readApplied();
    return state.sources[sourceId] ?? null;
  }

  async recordAppliedSource(record: AppliedSourceRecord): Promise<void> {
    const state = await this.readApplied();
    state.sources[record.sourceId] = record;
    const entries = Object.values(state.sources).sort((a, b) => b.appliedAt.localeCompare(a.appliedAt)).slice(0, 1000);
    state.sources = Object.fromEntries(entries.map(item => [item.sourceId, item]));
    await this.ensureFolders();
    const content = JSON.stringify(state, null, 2);
    await this.app.vault.adapter.write(this.appliedPath, content);
  }

  private async readApplied(): Promise<AppliedSourceFile> {
    if (!(await this.app.vault.adapter.exists(this.appliedPath))) return { version: 1, sources: {} };
    try {
      const parsed = JSON.parse(await this.app.vault.adapter.read(this.appliedPath)) as AppliedSourceFile;
      if (parsed.version !== 1 || !parsed.sources || typeof parsed.sources !== "object") {
        throw new Error("Unsupported applied-source state format");
      }
      return parsed;
    } catch (error) {
      throw new Error(`Applied-source state is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
