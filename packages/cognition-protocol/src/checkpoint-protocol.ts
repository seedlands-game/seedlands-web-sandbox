import type { ResidentWorldBinding } from './resident-protocol';

export const RESIDENT_CHECKPOINT_FORMAT = 'seedlands-resident-cognition' as const;
export const RESIDENT_CHECKPOINT_VERSION = 1 as const;
export const RESIDENT_HISTORY_MAX = 1024;

/** Portable cognition envelope. Workspace rows remain owned and validated by the Agent host. */
export type ResidentCheckpointManifest = Readonly<{
  format: typeof RESIDENT_CHECKPOINT_FORMAT;
  version: typeof RESIDENT_CHECKPOINT_VERSION;
  source: ResidentWorldBinding;
  workspaces: readonly unknown[];
}>;
