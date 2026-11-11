import { createHash, randomBytes } from "crypto";

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sanitizeVaultPath(input: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("Path is required");
  }
  const raw = input.trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) || raw.includes("\0")) {
    throw new Error("Absolute paths are not allowed");
  }
  const segments = raw.split("/");
  if (segments.some(segment => segment === "..")) {
    throw new Error("Path traversal is not allowed");
  }
  const normalized = raw.split("/").filter(segment => segment.length > 0 && segment !== ".").join("/");
  if (!normalized || normalized === ".") {
    throw new Error("Invalid vault path");
  }
  return normalized;
}

export function normalizeAllowedRoots(roots: string[], internalRoot: string): string[] {
  const internal = sanitizeVaultPath(internalRoot);
  const normalized = [...new Set(roots.map(root => sanitizeVaultPath(root).replace(/\/$/, "")))];
  for (const root of normalized) {
    if (root === internal || root.startsWith(`${internal}/`) || internal.startsWith(`${root}/`)) {
      throw new Error(`Allowed root overlaps internal plugin storage: ${root}`);
    }
  }
  return normalized;
}

export function isPathAllowed(path: string, allowedRoots: string[], internalRoot: string): boolean {
  const normalized = sanitizeVaultPath(path);
  const internal = sanitizeVaultPath(internalRoot);
  if (normalized === internal || normalized.startsWith(`${internal}/`)) return false;
  return allowedRoots.some(root => {
    const normalizedRoot = sanitizeVaultPath(root).replace(/\/$/, "");
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
  });
}

export function assertMarkdownPath(path: string): void {
  if (!path.toLowerCase().endsWith(".md")) {
    throw new Error("Only Markdown .md files are supported");
  }
}

export function assertAllowedPath(path: string, allowedRoots: string[], internalRoot: string): string {
  const normalized = sanitizeVaultPath(path);
  assertMarkdownPath(normalized);
  if (!isPathAllowed(normalized, allowedRoots, internalRoot)) {
    throw new Error(`Path is outside allowed roots: ${normalized}`);
  }
  return normalized;
}
