import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { timingSafeEqual } from "crypto";
import type { App } from "obsidian";
import type { SearchIndex } from "./search-index.js";
import type { VaultService } from "./vault-service.js";
import type { SecondBrainSettings } from "./types.js";
import { isPathAllowed, sanitizeVaultPath } from "./security.js";
import { parsePreviewRequest } from "./validation.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function secureEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid JSON request body");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value as Record<string, unknown>;
}

function classifyError(message: string): number {
  if (/applied-source state is invalid/i.test(message)) return 500;
  if (/not found/i.test(message)) return 404;
  if (/conflict|stale|already exists|no longer exists|already associated|associated with different content/i.test(message)) return 409;
  if (/outside allowed roots/i.test(message)) return 403;
  if (/automation policy|scheduled apply is disabled/i.test(message)) return 403;
  return 400;
}

export class LocalBridgeServer {
  private server: Server | null = null;

  constructor(
    private readonly app: App,
    private settings: SecondBrainSettings,
    private readonly index: SearchIndex,
    private readonly vaultService: VaultService,
  ) {}

  updateSettings(settings: SecondBrainSettings): void {
    this.settings = settings;
  }

  get running(): boolean {
    return this.server?.listening === true;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.settings.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private authorized(req: IncomingMessage): boolean {
    const value = req.headers.authorization ?? "";
    const prefix = "Bearer ";
    if (!value.startsWith(prefix)) return false;
    return secureEqual(value.slice(prefix.length), this.settings.token);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!this.authorized(req)) {
        json(res, 401, { error: "Unauthorized" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/status") {
        json(res, 200, {
          ok: true,
          vaultName: this.app.vault.getName(),
          allowedRoots: this.settings.allowedRoots,
          automationPolicy: this.settings.automationPolicy,
          pluginVersion: "0.3.6",
          bridgeVersion: "0.3.6",
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/search") {
        const body = asRecord(await readJson(req, this.settings.maxRequestBytes));
        const query = typeof body.query === "string" ? body.query.trim() : "";
        if (!query) throw new Error("query is required");
        const folder = typeof body.folder === "string" && body.folder.trim() ? sanitizeVaultPath(body.folder) : undefined;
        if (folder && !isPathAllowed(folder, this.settings.allowedRoots, this.settings.internalRoot)) {
          throw new Error(`Path is outside allowed roots: ${folder}`);
        }
        const requestedLimit = typeof body.limit === "number" ? Math.floor(body.limit) : 8;
        const limit = Math.max(1, Math.min(20, requestedLimit));
        json(res, 200, { results: this.index.search(query, folder, limit) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/read") {
        const body = asRecord(await readJson(req, this.settings.maxRequestBytes));
        if (typeof body.path !== "string") throw new Error("path is required");
        json(res, 200, await this.vaultService.readNote(body.path));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/preview") {
        const body = await readJson(req, this.settings.maxRequestBytes);
        json(res, 200, await this.vaultService.preview(parsePreviewRequest(body)));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/apply") {
        const body = asRecord(await readJson(req, this.settings.maxRequestBytes));
        if (typeof body.id !== "string") throw new Error("id is required");
        const sourceId = typeof body.sourceId === "string" ? body.sourceId : undefined;
        const scheduled = body.scheduled === true;
        json(res, 200, await this.vaultService.apply(body.id, sourceId, scheduled));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/change-sets/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/change-sets/".length));
        json(res, 200, await this.vaultService.getChangeSet(id));
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bridge error";
      console.error("Second Brain Updater bridge request failed", error);
      if (!res.headersSent) json(res, classifyError(message), { error: message });
    }
  }
}
