import type { AuthoritySnapshot } from '../../../../packages/game-core/src/server/authority/authority-session-types';
import {
  projectWelcomePresentationReference,
  type WelcomePresentationReferenceV2,
} from '../../../../packages/game-core/src/server/protocol/network-reference-bootstrap-presentation';
import type { ReferenceBootstrapContext } from '../../../../packages/game-core/src/server/protocol/network-reference-bootstrap-types';
import type { AuthorityReady } from '../../../../packages/game-core/src/compute/authority-worker-protocol';

export type BootstrapWelcomeCaptureLabel =
  'new-world-authority-start' | 'same-epoch-current-body' | 'restored-authority-start';

type SnapshotProjectionInput = Readonly<{
  epoch: string;
  protocolVersion: number;
  checkpoint: Readonly<{ physicsTick: number; commitSequence: number; worldRevision: number }>;
  activeTimeMs: number;
  worldTime: number;
  player: Readonly<{
    id: string;
    body: Readonly<{
      position: Readonly<{ x: number; y: number; z: number }>;
      velocity: Readonly<{ x: number; y: number; z: number }>;
    }>;
    grounded: boolean;
  }>;
}>;

export type BootstrapWelcomeProjectionInput = Readonly<{
  ready: Readonly<{
    playerId: string;
    playerBodyPosition: readonly [number, number, number];
    isNew: boolean;
    seed: number;
    seedText: string;
    generatorVersion: number;
    worldTime: number;
    frequencies: AuthorityReady['frequencies'];
    campPosition: readonly [number, number, number] | null;
    snapshot: SnapshotProjectionInput;
  }>;
  currentSnapshot: SnapshotProjectionInput;
  context: ReferenceBootstrapContext;
}>;

export type CapturedBootstrapWelcomeReference = Readonly<{
  label: BootstrapWelcomeCaptureLabel;
  provenance: Readonly<{
    source: 'real-dedicated-host';
    attachDisposition: 'NOT_COLLECTED';
    attachDispositionReason: 'production-session-adapter-not-implemented';
  }>;
  input: BootstrapWelcomeProjectionInput;
  metadata: WelcomePresentationReferenceV2;
}>;

const copySnapshotInput = (snapshot: AuthoritySnapshot): SnapshotProjectionInput => ({
  epoch: snapshot.epoch,
  protocolVersion: snapshot.protocolVersion,
  checkpoint: {
    physicsTick: snapshot.physicsTick,
    commitSequence: snapshot.commitSequence,
    worldRevision: snapshot.worldRevision,
  },
  activeTimeMs: snapshot.activeTimeMs,
  worldTime: snapshot.worldTime,
  player: {
    id: snapshot.player.id,
    body: {
      position: { ...snapshot.player.body.position },
      velocity: { ...snapshot.player.body.velocity },
    },
    grounded: snapshot.player.grounded,
  },
});

const copyInput = (
  ready: AuthorityReady,
  currentSnapshot: AuthoritySnapshot,
  context: ReferenceBootstrapContext,
): BootstrapWelcomeProjectionInput => ({
  ready: {
    playerId: ready.playerId,
    playerBodyPosition: [...ready.playerBodyPosition],
    isNew: ready.isNew,
    seed: ready.seed,
    seedText: ready.seedText,
    generatorVersion: ready.generatorVersion,
    worldTime: ready.worldTime,
    frequencies: { ...ready.frequencies },
    campPosition: ready.campPosition ? [...ready.campPosition] : null,
    snapshot: copySnapshotInput(ready.snapshot),
  },
  currentSnapshot: copySnapshotInput(currentSnapshot),
  context: structuredClone(context),
});

/** Records projection evidence only; hashing and disk publication stay in the Node test writer. */
export function captureBootstrapWelcomeReference(
  options: Readonly<{
    label: BootstrapWelcomeCaptureLabel;
    ready: AuthorityReady;
    currentSnapshot: AuthoritySnapshot;
    context: ReferenceBootstrapContext;
  }>,
): CapturedBootstrapWelcomeReference {
  const input = copyInput(options.ready, options.currentSnapshot, options.context);
  const metadata = projectWelcomePresentationReference(options.ready, options.currentSnapshot, options.context);
  return {
    label: options.label,
    provenance: {
      source: 'real-dedicated-host',
      attachDisposition: 'NOT_COLLECTED',
      attachDispositionReason: 'production-session-adapter-not-implemented',
    },
    input,
    metadata: structuredClone(metadata),
  };
}
