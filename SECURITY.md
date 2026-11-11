# Security

The vault is authoritative and local. Do not expose the Obsidian bridge directly to the public internet.

## Trust boundaries

- ChatGPT sees only data returned by explicit MCP tool calls.
- The MCP bridge cannot read the vault filesystem directly. It talks to the Obsidian plugin over localhost, and both local servers reject non-loopback binding by default.
- The Obsidian plugin enforces allowed roots for every read and write.
- Write previews are staged under the plugin-owned `.second-brain/change-sets/` area and revalidated immediately before apply. That internal area is never exposed as an allowed note root.
- Existing files are backed up before mutation.
- Deletes are intentionally not supported.

## Secrets

`OBSIDIAN_BRIDGE_TOKEN` is a local bearer token. Never commit it. Rotate it from Obsidian settings if exposed.

## Reporting

Open a private security report to the maintainer rather than posting credentials, vault content, or exploit details in a public issue.
