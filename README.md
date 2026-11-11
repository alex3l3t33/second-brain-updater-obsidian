# Second Brain Updater

Second Brain Updater connects the `@Obsidian` ChatGPT plugin to user-approved folders in a local Obsidian vault.

It can search and read approved notes, analyze relationships among them, preview proposed changes, and apply authorized updates with backups and conflict checks. Note deletion is intentionally unsupported.

## Requirements

- Obsidian desktop 1.6.0 or later.
- The `@Obsidian` plugin installed in ChatGPT.
- A free MyPlusApps account connection through Auth0.
- Obsidian must be running and connected when ChatGPT accesses the local vault.

This plugin is desktop-only because it runs a loopback-only local bridge and uses desktop networking APIs.

## Setup

1. Install and enable Second Brain Updater in Obsidian.
2. Open **Settings → Second Brain Updater**.
3. Add one vault-relative folder per line under **Allowed folder roots**. Access is denied when no roots are approved.
4. Keep **Automation policy** set to **Preview only** unless you explicitly want conflict-free scheduled updates inside approved roots.
5. In ChatGPT, install and connect `@Obsidian`.
6. Ask `@Obsidian` to create a pairing code, enter it in the Obsidian settings, and select **Pair**.

## Privacy and network disclosure

Second Brain Updater accesses only folders explicitly approved in its settings. It does not expose the local bridge to the public internet and does not support deleting notes.

When public relay is enabled, the plugin makes an outbound encrypted connection to `https://obsidian.myplusapps.fr`. Authentication is provided by Auth0 and hosting by Cloudflare. The relay carries authorized tool requests and the minimum note data needed to complete them. See the [privacy policy](https://obsidian.myplusapps.fr/privacy), [terms](https://obsidian.myplusapps.fr/terms), and [security documentation](./SECURITY.md).

The plugin contains no advertising, client-side telemetry, analytics, or payment flow. It does not require an OpenAI API key.

## Safety model

- Every read and write is checked against the approved folder roots.
- Writes are previewed and staged before application.
- Source hashes prevent overwriting newer edits.
- Existing files are backed up before mutation.
- Internal change-set and backup folders cannot be exposed as approved note roots.
- Deletion is not available.

## Development

```bash
npm install
npm run build
npm test
```

The release assets expected by Obsidian are `main.js`, `manifest.json`, and `styles.css`.

## License

MIT
