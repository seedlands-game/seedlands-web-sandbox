import type {
  CharacterControlResult,
  CharacterObservation,
  CharacterProfile,
  ControlBinding,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type {
  BehaviorCapability,
  BehaviorDefinition,
  BehaviorGoal,
  BehaviorUpdateRequest,
} from '@seedlands/game-core/runtime/behavior-control-protocol';
import type { WorldHarnessResult } from '@seedlands/game-core/server/harness/world-harness-contract';

export const RESIDENT_PROTOCOL_VERSION = 2 as const;
export const RESIDENT_FRAME_MAX_BYTES = 128 * 1024;
export const RESIDENT_MAX_CHARACTERS = 3;
export const RESIDENT_TRANSFER_CHUNK_BYTES = 48 * 1024;
export const RESIDENT_TRANSFER_MAX_BYTES = 64 * 1024 * 1024;

/** Application identity; the core world protocol has no model or workspace concepts. */
export type ResidentWorldBinding = Readonly<{ worldId: string; timelineId: string; epoch: string }>;
export type ResidentDocumentPath = '/AGENT.md' | '/SOUL.md' | '/MEMORY.md' | '/behavior/current.json';
export type ResidentBirthPackage = Readonly<{
  birthId: string;
  profile: CharacterProfile;
  agent: string;
  soul: string;
  memory: string;
  goal: BehaviorGoal;
  definition: BehaviorDefinition;
}>;
type Envelope = Readonly<{ protocolVersion: typeof RESIDENT_PROTOCOL_VERSION; sequence: number }>;
type Channel = Readonly<{ channelId: string }>;
type Request = Readonly<{ requestId: string }>;
export type ResidentClientMessage = Envelope &
  (
    | Readonly<{
        kind: 'hello';
        pairingToken: string;
        world: ResidentWorldBinding;
        capabilities: readonly BehaviorCapability[];
      }>
    | Readonly<{
        kind: 'bind';
        binding: ControlBinding;
        observation: CharacterObservation;
        birth?: ResidentBirthPackage;
        capabilities: readonly BehaviorCapability[];
      }>
    | (Channel & Readonly<{ kind: 'observe'; observation: CharacterObservation }>)
    | (Channel & Request & Readonly<{ kind: 'observation-reply'; observation: CharacterObservation }>)
    | (Channel & Request & Readonly<{ kind: 'receipt'; result: WorldHarnessResult<CharacterControlResult> }>)
    | (Channel & Readonly<{ kind: 'configure'; fallbackSeconds: number }>)
    | (Channel & Readonly<{ kind: 'unbind' }>)
    | Readonly<{ kind: 'clock'; paused: boolean }>
    | (Channel & Request & Readonly<{ kind: 'workspace-read'; path: ResidentDocumentPath }>)
    | (Request & Readonly<{ kind: 'checkpoint-export' }>)
    | (Request & Readonly<{ kind: 'checkpoint-read'; transferId: string; part: number }>)
    | (Request &
        Readonly<{
          kind: 'checkpoint-import';
          transferId: string;
          part: number;
          parts: number;
          content: string;
          sha256: string;
        }>)
    | (Request & Readonly<{ kind: 'birth'; tags: readonly string[] }>)
  );

export type ResidentStatus = Readonly<{
  phase: 'living' | 'thinking' | 'compressing' | 'paused' | 'blocked';
  message: string;
  windowId: string;
  memoryRevision: number;
  receivedThrough: number;
  includedThrough: number;
  compactedThrough: number;
  estimatedContextTokens: number;
  remainingFallbackMs: number;
  logicalRounds: number;
  compactions: number;
}>;

export type ResidentHostMessage = Envelope &
  (
    | Readonly<{ kind: 'ready'; world: ResidentWorldBinding; modelAvailable: boolean }>
    | (Channel & Readonly<{ kind: 'bound'; binding: ControlBinding; status: ResidentStatus }>)
    | (Channel & Readonly<{ kind: 'status'; status: ResidentStatus }>)
    | (Channel &
        Request &
        Readonly<{
          kind: 'behavior-proposal';
          proposal: Omit<BehaviorUpdateRequest, 'kind' | 'entityId' | 'requestId'>;
        }>)
    | (Channel & Request & Readonly<{ kind: 'observation-request' }>)
    | (Channel & Request & Readonly<{ kind: 'speak'; effectRequestId: string; text: string }>)
    | (Channel & Request & Readonly<{ kind: 'workspace-result'; path: ResidentDocumentPath; content: string }>)
    | (Request &
        Readonly<{ kind: 'checkpoint-ready'; transferId: string; parts: number; byteLength: number; sha256: string }>)
    | (Request & Readonly<{ kind: 'checkpoint-part'; transferId: string; part: number; content: string }>)
    | (Request & Readonly<{ kind: 'checkpoint-imported'; transferId: string; complete: boolean }>)
    | (Request & Readonly<{ kind: 'birth-package'; birth: ResidentBirthPackage }>)
    | Readonly<{ kind: 'error'; requestId?: string; channelId?: string; code: string; message: string }>
  );
