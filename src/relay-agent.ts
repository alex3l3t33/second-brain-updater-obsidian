import type { App } from "obsidian";
import type { SearchIndex } from "./search-index.js";
import type { SecondBrainSettings } from "./types.js";
import { parsePreviewRequest } from "./validation.js";
import type { VaultService } from "./vault-service.js";

interface RelayRequest {
  id: string;
  method: string;
  payload: Record<string, unknown>;
}

export class HostedRelayAgent {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private stopped = true;

  constructor(
    private readonly app: App,
    private settings: SecondBrainSettings,
    private readonly index: SearchIndex,
    private readonly vaultService: VaultService,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  updateSettings(settings: SecondBrainSettings): void {
    this.settings = settings;
  }

  async pair(code: string): Promise<{ deviceId: string; deviceSecret: string }> {
    const baseUrl = this.validateRelayUrl();
    if (!code.trim()) throw new Error("Pairing code is required");
    const response = await fetch(`${baseUrl}/v1/pair/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim(), deviceName: `${this.app.vault.getName()} on Obsidian` }),
    });
    const body = await response.json() as { deviceId?: string; deviceSecret?: string; error?: string };
    if (!response.ok || !body.deviceId || !body.deviceSecret) throw new Error(body.error ?? "Pairing failed");
    return { deviceId: body.deviceId, deviceSecret: body.deviceSecret };
  }

  async start(): Promise<void> {
    this.stop();
    this.stopped = false;
    if (!this.settings.relayEnabled || !this.settings.relayDeviceId || !this.settings.relayDeviceSecret) return;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private validateRelayUrl(): string {
    const parsed = new URL(this.settings.relayUrl);
    if (parsed.protocol !== "https:") throw new Error("Relay service URL must use HTTPS");
    return parsed.toString().replace(/\/$/, "");
  }

  private async connect(): Promise<void> {
    try {
      const baseUrl = this.validateRelayUrl();
      const session = await fetch(`${baseUrl}/v1/agent/session`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.settings.relayDeviceSecret}`,
          "x-device-id": this.settings.relayDeviceId,
        },
      });
      const body = await session.json() as { ticket?: string; error?: string };
      if (!session.ok || !body.ticket) throw new Error(body.error ?? "Relay session failed");
      const wsUrl = new URL(baseUrl);
      wsUrl.protocol = "wss:";
      wsUrl.pathname = "/v1/agent/connect";
      wsUrl.searchParams.set("ticket", body.ticket);
      const socket = new WebSocket(wsUrl);
      this.socket = socket;
      socket.addEventListener("open", () => this.startHeartbeat(socket));
      socket.addEventListener("message", event => { void this.onMessage(String(event.data)); });
      socket.addEventListener("close", () => {
        this.stopHeartbeat();
        this.scheduleReconnect();
      });
      socket.addEventListener("error", () => socket.close());
    } catch (error) {
      console.error("Second Brain Updater relay connection failed", error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.socket = null;
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 5_000);
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, 25_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async onMessage(raw: string): Promise<void> {
    let request: RelayRequest | null = null;
    try {
      const parsed = JSON.parse(raw) as RelayRequest & { type?: string };
      if (parsed.type === "pong") return;
      request = parsed;
      const result = await this.dispatch(request.method, request.payload ?? {});
      this.socket?.send(JSON.stringify({ id: request.id, ok: true, result }));
    } catch (error) {
      const id = request?.id ?? "unknown";
      this.socket?.send(JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : "Agent request failed" }));
    }
  }

  private async dispatch(method: string, payload: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "status": return {
        ok: true,
        vaultName: this.app.vault.getName(),
        allowedRoots: this.settings.allowedRoots,
        automationPolicy: this.settings.automationPolicy,
        pluginVersion: "0.3.6",
        bridgeVersion: "0.3.6",
      };
      case "search": {
        const query = typeof payload.query === "string" ? payload.query : "";
        const folder = typeof payload.folder === "string" ? payload.folder : undefined;
        const limit = typeof payload.limit === "number" ? payload.limit : 8;
        return this.index.search(query, folder, limit);
      }
      case "read": return this.vaultService.readNote(String(payload.path ?? ""));
      case "preview": return this.vaultService.preview(parsePreviewRequest(payload));
      case "apply": return this.vaultService.apply(String(payload.id ?? ""), typeof payload.sourceId === "string" ? payload.sourceId : undefined, payload.scheduled === true);
      case "changeSet": return this.vaultService.getChangeSet(String(payload.id ?? ""));
      default: throw new Error(`Unsupported relay method: ${method}`);
    }
  }
}
