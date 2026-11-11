import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type SecondBrainPlugin from "./main.js";
import type { AutomationPolicy, SecondBrainSettings } from "./types.js";
import { normalizeAllowedRoots } from "./security.js";

export const DEFAULT_SETTINGS: SecondBrainSettings = {
  bridgeEnabled: true,
  port: 27123,
  token: "",
  allowedRoots: [],
  automationPolicy: "preview-only",
  backupRoot: ".second-brain/backups",
  internalRoot: ".second-brain",
  maxRequestBytes: 2_000_000,
  stagedTtlMinutes: 1440,
  relayEnabled: false,
  relayUrl: "https://obsidian.myplusapps.fr",
  relayDeviceId: "",
  relayDeviceSecret: "",
};

export class SecondBrainSettingTab extends PluginSettingTab {
  private rootsTimer: number | null = null;
  private pairingCode = "";

  constructor(app: App, private readonly plugin: SecondBrainPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Second Brain Updater" });

    const status = containerEl.createDiv({ cls: "obsidian-second-brain-status" });
    status.createEl("strong", { text: this.plugin.bridgeRunning ? "Bridge running" : "Bridge stopped" });
    status.createEl("div", { text: `Local endpoint: http://127.0.0.1:${this.plugin.settings.port}` });
    status.createEl("div", { text: `${this.plugin.settings.allowedRoots.length} approved folder root(s)` });
    status.createEl("div", { text: `Public relay: ${this.plugin.relayConnected ? "connected" : "disconnected"}` });

    new Setting(containerEl)
      .setName("Enable local bridge")
      .setDesc("Runs the vault safety bridge on the loopback interface only.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.bridgeEnabled)
        .onChange(async value => {
          await this.plugin.updateSettings({ bridgeEnabled: value }, { restartBridge: true });
          this.display();
        }));

    new Setting(containerEl)
      .setName("Bridge port")
      .setDesc("Local Obsidian bridge port. The MCP bridge defaults to 27123.")
      .addText(text => text
        .setValue(String(this.plugin.settings.port))
        .onChange(async value => {
          const port = Number.parseInt(value, 10);
          if (Number.isInteger(port) && port > 1024 && port < 65536 && port !== this.plugin.settings.port) {
            await this.plugin.updateSettings({ port }, { restartBridge: true });
          }
        }));

    new Setting(containerEl)
      .setName("Allowed folder roots")
      .setDesc("One vault-relative folder per line. ChatGPT cannot read or write outside these roots.")
      .addTextArea(area => {
        area.setValue(this.plugin.settings.allowedRoots.join("\n"));
        area.inputEl.rows = 8;
        area.inputEl.cols = 45;
        area.onChange(value => {
          if (this.rootsTimer !== null) window.clearTimeout(this.rootsTimer);
          this.rootsTimer = window.setTimeout(() => {
            try {
              const rawRoots = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
              const roots = normalizeAllowedRoots(rawRoots, this.plugin.settings.internalRoot);
              void this.plugin.updateSettings({ allowedRoots: roots }, { reindex: true });
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Invalid allowed folder root");
            }
          }, 600);
        });
      });

    new Setting(containerEl)
      .setName("Automation policy")
      .setDesc("Preview-only never allows scheduled writes. Safe-apply allows conflict-free scheduled creates and updates inside approved roots.")
      .addDropdown(dropdown => dropdown
        .addOption("preview-only", "Preview only")
        .addOption("safe-apply", "Safe apply")
        .setValue(this.plugin.settings.automationPolicy)
        .onChange(async value => {
          await this.plugin.updateSettings({ automationPolicy: value as AutomationPolicy });
        }));

    new Setting(containerEl)
      .setName("Bridge token")
      .setDesc("Use this as OBSIDIAN_BRIDGE_TOKEN for the local MCP bridge. Keep it secret.")
      .addButton(button => button
        .setButtonText("Copy token")
        .onClick(async () => {
          await navigator.clipboard.writeText(this.plugin.settings.token);
          new Notice("Second Brain Updater token copied");
        }))
      .addButton(button => button
        .setButtonText("Rotate")
        .setWarning()
        .onClick(async () => {
          await this.plugin.rotateToken();
          new Notice("Token rotated. Update OBSIDIAN_BRIDGE_TOKEN before restarting the MCP bridge.");
          this.display();
        }));

    const token = containerEl.createDiv({ cls: "obsidian-second-brain-token" });
    const suffix = this.plugin.settings.token.slice(-6);
    token.setText(`Token configured: ••••••${suffix}`);

    new Setting(containerEl)
      .setName("Staged change lifetime")
      .setDesc("Minutes before an unapplied preview expires.")
      .addText(text => text
        .setValue(String(this.plugin.settings.stagedTtlMinutes))
        .onChange(async value => {
          const minutes = Number.parseInt(value, 10);
          if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 10080) {
            await this.plugin.updateSettings({ stagedTtlMinutes: minutes });
          }
        }));

    containerEl.createEl("h3", { text: "Public ChatGPT marketplace connection" });

    new Setting(containerEl)
      .setName("Relay service URL")
      .setDesc("Production HTTPS address supplied by Second Brain Updater.")
      .addText(text => text
        .setPlaceholder("https://notes.example.com")
        .setValue(this.plugin.settings.relayUrl)
        .onChange(async value => {
          await this.plugin.updateSettings({ relayUrl: value.trim().replace(/\/$/, "") }, { restartRelay: true });
        }));

    new Setting(containerEl)
      .setName("Enable public relay")
      .setDesc("Maintains an outbound encrypted connection. No inbound port is opened.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.relayEnabled)
        .onChange(async value => {
          await this.plugin.updateSettings({ relayEnabled: value }, { restartRelay: true });
          this.display();
        }));

    new Setting(containerEl)
      .setName("Pairing code")
      .setDesc("Ask @obsidian to create a pairing code, then enter it here within ten minutes.")
      .addText(text => text
        .setPlaceholder("PAIRING-CODE")
        .onChange(value => { this.pairingCode = value.trim(); }))
      .addButton(button => button
        .setButtonText("Pair")
        .setCta()
        .onClick(async () => {
          try {
            await this.plugin.pairRelay(this.pairingCode);
            this.pairingCode = "";
            new Notice("Second Brain Updater paired successfully");
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Pairing failed");
          }
        }));
  }
}
