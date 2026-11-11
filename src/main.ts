import { Notice, Plugin } from "obsidian";
import { LocalBridgeServer } from "./bridge.js";
import { SearchIndex } from "./search-index.js";
import { generateToken, normalizeAllowedRoots } from "./security.js";
import { DEFAULT_SETTINGS, SecondBrainSettingTab } from "./settings.js";
import type { SecondBrainSettings } from "./types.js";
import { VaultService } from "./vault-service.js";
import { HostedRelayAgent } from "./relay-agent.js";

export default class SecondBrainPlugin extends Plugin {
  override settings: SecondBrainSettings = { ...DEFAULT_SETTINGS };
  private index: SearchIndex | null = null;
  private vaultService: VaultService | null = null;
  private bridge: LocalBridgeServer | null = null;
  private relay: HostedRelayAgent | null = null;

  get bridgeRunning(): boolean {
    return this.bridge?.running === true;
  }

  get relayConnected(): boolean {
    return this.relay?.connected === true;
  }

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new SearchIndex(this.app, this.settings.allowedRoots, this.settings.internalRoot);
    await this.index.initialize();
    this.vaultService = new VaultService(this.app, this.settings);
    await this.vaultService.initialize();
    this.bridge = new LocalBridgeServer(this.app, this.settings, this.index, this.vaultService);
    this.relay = new HostedRelayAgent(this.app, this.settings, this.index, this.vaultService);
    if (this.settings.bridgeEnabled) {
      try {
        await this.bridge.start();
      } catch (error) {
        console.error("Failed to start Second Brain Updater bridge", error);
        new Notice(`Second Brain Updater bridge failed to start: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.settings.relayEnabled) await this.relay.start();
    this.addSettingTab(new SecondBrainSettingTab(this.app, this));
  }

  override async onunload(): Promise<void> {
    await this.bridge?.stop();
    this.relay?.stop();
    this.index?.dispose();
  }

  private async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<SecondBrainSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded ?? {}) };
    try {
      this.settings.allowedRoots = normalizeAllowedRoots(this.settings.allowedRoots, this.settings.internalRoot);
    } catch (error) {
      console.error("Invalid Second Brain Updater allowed roots. Resetting to deny-all.", error);
      this.settings.allowedRoots = [];
    }
    if (!this.settings.token) this.settings.token = generateToken();
    await this.saveData(this.settings);
  }

  async updateSettings(
    patch: Partial<SecondBrainSettings>,
    options: { restartBridge?: boolean; restartRelay?: boolean; reindex?: boolean } = {},
  ): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.saveData(this.settings);
    this.vaultService?.reconfigure(this.settings);
    this.bridge?.updateSettings(this.settings);
    this.relay?.updateSettings(this.settings);
    if (options.reindex && this.index) {
      await this.index.reconfigure(this.settings.allowedRoots, this.settings.internalRoot);
    }
    if (options.restartBridge && this.bridge) {
      await this.bridge.stop();
      if (this.settings.bridgeEnabled) await this.bridge.start();
    }
    if (options.restartRelay && this.relay) await this.relay.start();
  }

  async rotateToken(): Promise<void> {
    await this.updateSettings({ token: generateToken() });
  }

  async pairRelay(code: string): Promise<void> {
    if (!this.relay) throw new Error("Relay agent is not initialized");
    const credentials = await this.relay.pair(code);
    await this.updateSettings({
      relayDeviceId: credentials.deviceId,
      relayDeviceSecret: credentials.deviceSecret,
      relayEnabled: true,
    }, { restartRelay: true });
  }
}
