import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ResidentClientMessage, ResidentHostMessage, ResidentWorldBinding } from '@seedlands/cognition-protocol';
import type { ControlBinding } from '@seedlands/game-core/runtime/character-control-protocol';
import type { ResidentChannel } from '../resident-channel.js';
import type { ResidentFactory } from '../resident-factory.js';
import type { FrameworkPersistence, PersistentNpcWorkspace } from '../workspace/index.js';

export type HostPayload = ResidentHostMessage extends infer Message
  ? Message extends ResidentHostMessage
    ? Omit<Message, 'protocolVersion' | 'sequence'>
    : never
  : never;
export type ChannelState = { binding: ControlBinding; resident: ResidentChannel; ready: boolean };
export type Pending = {
  channelId: string;
  resolve(message: ResidentClientMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
export type ExportTransfer = { expiresAt: number; chunks: readonly string[]; byteLength: number; sha256: string };
export type ImportTransfer = {
  expiresAt: number;
  parts: number;
  sha256: string;
  chunks: Map<number, Buffer>;
  byteLength: number;
};

/**
 * closed revokes channel and birth execution eligibility synchronously.
 * retired covers this socket's queued inbound work and channel shutdowns, not shared Factory/provider work.
 */
export type ResidentConnectionLifecycle = Readonly<{
  phase: 'authenticated' | 'closed' | 'retired' | 'retirement-failed';
  connectionId: string;
  world: ResidentWorldBinding | null;
}>;

export type ResidentServerOptions = Readonly<{
  workspace: PersistentNpcWorkspace;
  framework: FrameworkPersistence;
  flash: BaseChatModel | null;
  pro: BaseChatModel | null;
  factory?: ResidentFactory;
  allowedOrigins: readonly string[];
  port?: number;
  pairingToken?: string;
  transferTtlMs?: number;
  onConnectionLifecycle?(event: ResidentConnectionLifecycle): void;
}>;
