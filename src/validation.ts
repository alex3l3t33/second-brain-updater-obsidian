import type { PreviewRequest, ProposedChange } from "./types.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, max: number, trim = false): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const result = trim ? value.trim() : value;
  if (!result) throw new Error(`${label} is required`);
  if (result.length > max) throw new Error(`${label} is too long`);
  return result;
}

function optionalBoundedString(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return boundedString(value, label, max, true);
}

function parseChange(value: unknown, index: number): ProposedChange {
  const input = record(value, `changes[${index}]`);
  if (input.operation !== "create" && input.operation !== "update") {
    throw new Error(`changes[${index}].operation must be create or update`);
  }
  const path = boundedString(input.path, `changes[${index}].path`, 500, true);
  if (typeof input.content !== "string") throw new Error(`changes[${index}].content must be a string`);
  if (input.content.length > 1_000_000) throw new Error(`changes[${index}].content is too long`);

  const expectedHash = optionalBoundedString(input.expectedHash, `changes[${index}].expectedHash`, 64);
  if (expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error(`changes[${index}].expectedHash must be a SHA-256 hex digest`);
  }
  if (input.operation === "update" && expectedHash === undefined) {
    throw new Error(`changes[${index}].expectedHash is required for update`);
  }

  return { operation: input.operation, path, content: input.content, expectedHash };
}

export function parsePreviewRequest(value: unknown): PreviewRequest {
  const input = record(value, "request");
  if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > 25) {
    throw new Error("changes must contain 1 to 25 items");
  }
  if (input.scheduled !== undefined && typeof input.scheduled !== "boolean") {
    throw new Error("scheduled must be a boolean");
  }

  return {
    changes: input.changes.map(parseChange),
    reason: boundedString(input.reason, "reason", 1000, true),
    sourceId: optionalBoundedString(input.sourceId, "sourceId", 200),
    scheduled: input.scheduled === true,
  };
}
