import type { BaseMessage, StoredMessage } from '@langchain/core/messages';

export const CONTEXT_TOKEN_BUDGET = 128_000;
export const CONTEXT_SOFT_TOKEN_LIMIT = 112_000;
export const MEMORY_TOKEN_LIMIT = 4_000;
export const MEMORY_UTF8_LIMIT = 16 * 1024;
export const JOURNAL_MESSAGE_UTF8_LIMIT = 512 * 1024;
export const JOURNAL_WINDOW_UTF8_LIMIT = 2 * 1024 * 1024;
export const JOURNAL_WINDOW_MESSAGE_LIMIT = 4_096;
export const JOURNAL_READ_UTF8_LIMIT = JOURNAL_WINDOW_UTF8_LIMIT;
export const JOURNAL_READ_ROW_LIMIT = JOURNAL_WINDOW_MESSAGE_LIMIT;

export function assessContextBudget(estimatedTokens: number): 'ready' | 'compact' | 'suspend' {
  if (!Number.isFinite(estimatedTokens) || estimatedTokens < 0) throw new Error('invalid context token estimate');
  if (estimatedTokens >= CONTEXT_TOKEN_BUDGET) return 'suspend';
  if (estimatedTokens >= CONTEXT_SOFT_TOKEN_LIMIT) return 'compact';
  return 'ready';
}

export type WorkspaceBinding = Readonly<{
  worldId: string;
  timelineId: string;
  actorId: string;
  incarnation: string;
}>;

export type WorkspaceFilePath = '/AGENT.md' | '/SOUL.md' | '/MEMORY.md' | '/behavior/current.json';
export type WorkspaceReaderRole = 'resident' | 'memory-editor' | 'system';
export type WorkspaceWriterRole = 'birth-package' | 'authority' | 'pro-memory-editor' | 'system-import';

export type WorkspaceDocument = Readonly<{
  namespace: string;
  path: WorkspaceFilePath;
  revision: number;
  content: string;
  utf8Bytes: number;
  contentHash: string;
  schemaVersion: number;
  templateVersion: string;
  writerRole: WorkspaceWriterRole;
  createdAt: string;
  publishedAt: string;
}>;

export type JournalMessageInput = Readonly<{
  idempotencyKey: string;
  message: BaseMessage;
  worldEventRange?: readonly [number, number];
}>;

export type JournalMessage = Readonly<{
  seq: number;
  messageId: string;
  windowId: string;
  storedMessage: StoredMessage;
  contentHash: string;
  worldEventRange: readonly [number, number] | null;
  createdAt: string;
}>;

export type WorkspaceEvent = Readonly<{
  eventId: string;
  cursor: number;
  payload: Readonly<Record<string, unknown>>;
}>;

export type EventPageCoverage = Readonly<{
  requestedAfter: number;
  through: number;
  returnedThrough: number;
  hasMore: boolean;
  lostRange?: Readonly<{ from: number; to: number }>;
}>;

export type ReceivedEventPage = Readonly<{
  pageId: string;
  coverage: EventPageCoverage;
  events: readonly WorkspaceEvent[];
}>;

export type CognitionRuntimeMetadata = Readonly<{
  revision: number;
  snapshot: Readonly<Record<string, unknown>>;
  logicalRounds: number;
  compactions: number;
  updatedAt: string;
}>;

export type Watermarks = Readonly<{
  receivedThrough: number;
  includedThrough: number;
  compactedThrough: number;
}>;

export type FrozenCompaction = Readonly<{
  windowId: string;
  memoryRevision: number;
  throughJournalSeq: number;
  throughEventCursor: number;
  messages: readonly JournalMessage[];
  memory: WorkspaceDocument;
}>;

export type MemorySource = Readonly<{
  journalSeq: number;
  kind: 'observed' | 'authority-receipt' | 'resident-decision' | 'prior-memory';
}>;

export type MemoryDraft = Readonly<{
  expectedMemoryRevision: number;
  frozenWindowId: string;
  throughJournalSeq: number;
  content: string;
  estimatedTokens: number;
  sources: readonly MemorySource[];
}>;

export type RequestManifestInput = Readonly<{
  requestId: string;
  logicalModel: 'flash' | 'pro';
  throughJournalSeq: number;
  requestPayload: unknown;
  systemPrefix: unknown;
  toolSchema: unknown;
  toolSchemaRevision: string;
  modelConfigurationRevision: string;
  gatewayAuditRef?: string;
}>;

export type PortableWorkspace = Readonly<{
  format: 'seedlands-npc-workspace';
  schemaVersion: 1;
  exportedAt: string;
  binding: WorkspaceBinding;
  state: Readonly<Record<string, unknown>>;
  documents: readonly Readonly<Record<string, unknown>>[];
  journal: readonly Readonly<Record<string, unknown>>[];
  events: readonly Readonly<Record<string, unknown>>[];
  eventPages: readonly Readonly<Record<string, unknown>>[];
  runtimeMetadata: Readonly<Record<string, unknown>>;
  windows: readonly Readonly<Record<string, unknown>>[];
  manifests: readonly Readonly<Record<string, unknown>>[];
  receipts: readonly Readonly<Record<string, unknown>>[];
  compactionCommits: readonly Readonly<Record<string, unknown>>[];
  blobs: readonly Readonly<Record<string, unknown>>[];
}>;

export type InitializeNpcInput = Readonly<{
  agent: string;
  soul: string;
  memory: string;
  memoryEstimatedTokens: number;
  behavior: unknown;
  templateVersion: string;
}>;
