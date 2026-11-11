import type { App, TFile } from "obsidian";
import { randomUUID } from "crypto";
import { compactUnifiedDiff } from "./diff.js";
import { ChangeStore } from "./change-store.js";
import { assertAllowedPath, sanitizeVaultPath, sha256 } from "./security.js";
import type { ChangeSetRecord, PreviewRequest, SecondBrainSettings, StoredChange } from "./types.js";

export class VaultService {
  private readonly store: ChangeStore;
  private applyTail: Promise<void> = Promise.resolve();

  constructor(private readonly app: App, private settings: SecondBrainSettings) {
    this.store = new ChangeStore(app, settings.internalRoot);
  }

  async initialize(): Promise<void> {
    await this.store.ensureFolders();
  }

  reconfigure(settings: SecondBrainSettings): void {
    this.settings = settings;
    this.store.reconfigure(settings.internalRoot);
  }

  async readNote(inputPath: string): Promise<{ path: string; content: string; hash: string; modified: number }> {
    const path = assertAllowedPath(inputPath, this.settings.allowedRoots, this.settings.internalRoot);
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error(`Note not found: ${path}`);
    const content = await this.app.vault.cachedRead(file);
    return { path, content, hash: sha256(content), modified: file.stat.mtime };
  }

  async preview(request: PreviewRequest): Promise<ChangeSetRecord> {
    if (!request.reason?.trim()) throw new Error("A change reason is required");
    if (!Array.isArray(request.changes) || request.changes.length < 1 || request.changes.length > 25) {
      throw new Error("A change set must contain 1 to 25 changes");
    }
    const requestFingerprint = sha256(JSON.stringify(request.changes.map(change => ({
      operation: change.operation,
      path: sanitizeVaultPath(change.path),
      content: change.content,
    }))));
    if (request.sourceId) {
      const existing = await this.store.getAppliedSource(request.sourceId);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new Error(`sourceId is already associated with different content: ${request.sourceId}`);
        }
        const prior = await this.store.getChangeSet(existing.changeSetId);
        if (prior) return prior;
      }
    }

    const seen = new Set<string>();
    const stored: StoredChange[] = [];
    const items: ChangeSetRecord["items"] = [];
    const warnings: string[] = [];

    for (const change of request.changes) {
      const path = assertAllowedPath(change.path, this.settings.allowedRoots, this.settings.internalRoot);
      if (seen.has(path)) throw new Error(`Duplicate path in change set: ${path}`);
      seen.add(path);
      if (Buffer.byteLength(change.content, "utf8") > this.settings.maxRequestBytes) {
        throw new Error(`Content too large for ${path}`);
      }
      const file = this.app.vault.getFileByPath(path);
      const before = file ? await this.app.vault.cachedRead(file) : "";
      const beforeHash = file ? sha256(before) : null;
      const afterHash = sha256(change.content);

      if (change.operation === "create" && file) throw new Error(`Create target already exists: ${path}`);
      if (change.operation === "update" && !file) throw new Error(`Update target does not exist: ${path}`);
      if (change.operation === "update") {
        if (!change.expectedHash) throw new Error(`expectedHash is required for update: ${path}`);
        if (change.expectedHash !== beforeHash) throw new Error(`Stale note hash for ${path}`);
      }
      if (beforeHash === afterHash) warnings.push(`${path} has no content changes.`);

      stored.push({ ...change, path, beforeHash, afterHash });
      items.push({
        operation: change.operation,
        path,
        beforeHash,
        afterHash,
        diff: compactUnifiedDiff(path, before, change.content),
      });
    }

    const id = `cs_${randomUUID().replace(/-/g, "")}`;
    const record: ChangeSetRecord = {
      id,
      status: "staged",
      createdAt: new Date().toISOString(),
      sourceId: request.sourceId,
      scheduled: request.scheduled === true,
      reason: request.reason.trim(),
      requestFingerprint,
      changes: stored,
      items,
      warnings,
    };
    await this.store.saveChangeSet(record);
    return record;
  }

  async getChangeSet(id: string): Promise<ChangeSetRecord> {
    const record = await this.store.getChangeSet(id);
    if (!record) throw new Error(`Change set not found: ${id}`);
    if (record.status === "staged" && this.isExpired(record)) {
      record.status = "expired";
      await this.store.saveChangeSet(record);
    }
    return record;
  }

  apply(id: string, sourceId: string | undefined, scheduled: boolean): Promise<{
    id: string;
    status: "applied";
    appliedAt: string;
    paths: string[];
    idempotentReplay: boolean;
  }> {
    const operation = this.applyTail.then(() => this.applyLocked(id, sourceId, scheduled));
    this.applyTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async applyLocked(id: string, sourceId: string | undefined, scheduled: boolean): Promise<{
    id: string;
    status: "applied";
    appliedAt: string;
    paths: string[];
    idempotentReplay: boolean;
  }> {
    if (sourceId) {
      const prior = await this.store.getAppliedSource(sourceId);
      if (prior) {
        if (prior.changeSetId !== id) {
          throw new Error(`sourceId is already associated with change set ${prior.changeSetId}`);
        }
        return { id: prior.changeSetId, status: "applied", appliedAt: prior.appliedAt, paths: prior.paths, idempotentReplay: true };
      }
    }

    const record = await this.getChangeSet(id);
    if (record.status === "applied") {
      return { id: record.id, status: "applied", appliedAt: record.appliedAt ?? record.createdAt, paths: record.changes.map(change => change.path), idempotentReplay: true };
    }
    if (record.status !== "staged") throw new Error(`Change set ${id} is ${record.status}`);
    if (scheduled || record.scheduled) {
      if (this.settings.automationPolicy !== "safe-apply") {
        throw new Error("Scheduled apply is disabled by automation policy");
      }
      if (!sourceId && !record.sourceId) {
        throw new Error("Scheduled apply requires a stable sourceId");
      }
    }
    if (sourceId && record.sourceId && sourceId !== record.sourceId) {
      throw new Error("sourceId does not match the staged change set");
    }

    await this.revalidate(record);
    const rollback: Array<{ path: string; existed: boolean; content: string; appliedHash: string }> = [];
    const timestamp = new Date();
    const backupStamp = timestamp.toISOString().replace(/[:.]/g, "-");

    try {
      for (const change of record.changes) {
        const existing = this.app.vault.getFileByPath(change.path);
        if (existing) {
          const oldContent = await this.app.vault.read(existing);
          if (!change.expectedHash || sha256(oldContent) !== change.expectedHash || sha256(oldContent) !== change.beforeHash) {
            throw new Error(`Conflict detected for ${change.path}`);
          }
          await this.backup(existing, oldContent, backupStamp);
          await this.app.vault.process(existing, current => {
            if (sha256(current) !== change.expectedHash || sha256(current) !== change.beforeHash) {
              throw new Error(`Conflict detected for ${change.path}`);
            }
            return change.content;
          });
          rollback.push({ path: change.path, existed: true, content: oldContent, appliedHash: change.afterHash });
        } else {
          if (change.operation !== "create") throw new Error(`Update target no longer exists: ${change.path}`);
          await this.ensureParent(change.path);
          await this.app.vault.create(change.path, change.content);
          rollback.push({ path: change.path, existed: false, content: "", appliedHash: change.afterHash });
        }
      }
    } catch (error) {
      await this.rollback(rollback);
      throw error;
    }

    record.status = "applied";
    record.appliedAt = timestamp.toISOString();
    await this.store.saveChangeSet(record);
    const effectiveSourceId = sourceId ?? record.sourceId;
    const paths = record.changes.map(change => change.path);
    if (effectiveSourceId) {
      await this.store.recordAppliedSource({
        sourceId: effectiveSourceId,
        changeSetId: record.id,
        appliedAt: record.appliedAt,
        paths,
        requestFingerprint: record.requestFingerprint,
      });
    }
    return { id: record.id, status: "applied", appliedAt: record.appliedAt, paths, idempotentReplay: false };
  }

  private isExpired(record: ChangeSetRecord): boolean {
    const ttl = this.settings.stagedTtlMinutes * 60_000;
    return Date.now() - Date.parse(record.createdAt) > ttl;
  }

  private async revalidate(record: ChangeSetRecord): Promise<void> {
    if (this.isExpired(record)) throw new Error(`Change set ${record.id} has expired`);
    for (const change of record.changes) {
      const path = assertAllowedPath(change.path, this.settings.allowedRoots, this.settings.internalRoot);
      const file = this.app.vault.getFileByPath(path);
      if (change.operation === "create") {
        if (file) throw new Error(`Create target now exists: ${path}`);
      } else {
        if (!file) throw new Error(`Update target no longer exists: ${path}`);
        const current = await this.app.vault.cachedRead(file);
        const currentHash = sha256(current);
        if (!change.expectedHash || currentHash !== change.expectedHash || currentHash !== change.beforeHash) {
          throw new Error(`Conflict detected for ${path}`);
        }
      }
    }
  }

  private async backup(file: TFile, content: string, stamp: string): Promise<void> {
    const backupRoot = sanitizeVaultPath(this.settings.backupRoot);
    const path = `${backupRoot}/${stamp}/${file.path}`;
    await this.ensureAdapterParent(path);
    if (!(await this.app.vault.adapter.exists(path))) await this.app.vault.adapter.write(path, content);
  }

  private async ensureAdapterParent(path: string): Promise<void> {
    const parts = sanitizeVaultPath(path).split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (await this.app.vault.adapter.exists(current)) continue;
      try {
        await this.app.vault.adapter.mkdir(current);
      } catch (error) {
        if (!(await this.app.vault.adapter.exists(current))) throw error;
      }
    }
  }

  private async ensureParent(path: string): Promise<void> {
    const parts = sanitizeVaultPath(path).split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private async rollback(entries: Array<{ path: string; existed: boolean; content: string; appliedHash: string }>): Promise<void> {
    for (const entry of entries.reverse()) {
      try {
        const file = this.app.vault.getFileByPath(entry.path);
        if (file) {
          const current = await this.app.vault.read(file);
          if (sha256(current) !== entry.appliedHash) {
            console.error("Obsidian Second Brain rollback skipped because the note changed", entry.path);
            continue;
          }
        }
        if (entry.existed) {
          if (file) await this.app.vault.modify(file, entry.content);
          else {
            await this.ensureParent(entry.path);
            await this.app.vault.create(entry.path, entry.content);
          }
        } else if (file) {
          await this.app.vault.delete(file, true);
        }
      } catch (rollbackError) {
        console.error("Obsidian Second Brain rollback failed", entry.path, rollbackError);
      }
    }
  }
}
