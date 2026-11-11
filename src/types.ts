export type AutomationPolicy = "preview-only" | "safe-apply";
export type ChangeOperation = "create" | "update";

export interface SecondBrainSettings {
  bridgeEnabled: boolean;
  port: number;
  token: string;
  allowedRoots: string[];
  automationPolicy: AutomationPolicy;
  backupRoot: string;
  internalRoot: string;
  maxRequestBytes: number;
  stagedTtlMinutes: number;
  relayEnabled: boolean;
  relayUrl: string;
  relayDeviceId: string;
  relayDeviceSecret: string;
}

export interface ProposedChange {
  operation: ChangeOperation;
  path: string;
  content: string;
  expectedHash?: string;
}

export interface PreviewRequest {
  changes: ProposedChange[];
  reason: string;
  sourceId?: string;
  scheduled?: boolean;
}

export interface PreviewItem {
  operation: ChangeOperation;
  path: string;
  beforeHash: string | null;
  afterHash: string;
  diff: string;
}

export interface StoredChange extends ProposedChange {
  beforeHash: string | null;
  afterHash: string;
}

export interface ChangeSetRecord {
  id: string;
  status: "staged" | "applied" | "expired";
  createdAt: string;
  sourceId?: string;
  scheduled: boolean;
  reason: string;
  requestFingerprint: string;
  changes: StoredChange[];
  items: PreviewItem[];
  warnings: string[];
  appliedAt?: string;
}

export interface AppliedSourceRecord {
  sourceId: string;
  changeSetId: string;
  appliedAt: string;
  paths: string[];
  requestFingerprint: string;
}

export interface SearchEntry {
  path: string;
  title: string;
  content: string;
  normalized: string;
  modified: number;
}
