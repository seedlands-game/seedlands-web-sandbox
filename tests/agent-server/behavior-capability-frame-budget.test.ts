import { describe, expect, it } from 'vitest';
import {
  RESIDENT_FRAME_MAX_BYTES,
  RESIDENT_PROTOCOL_VERSION,
  type ResidentBirthPackage,
  type ResidentClientMessage,
  type ResidentWorldBinding,
} from '@seedlands/cognition-protocol';
import { BEHAVIOR_REGISTRY_CAPABILITY, type BehaviorCapabilityRegistry } from '@seedlands/game-core/mod-api';
import { behaviorJsonBytes } from '@seedlands/game-core/runtime/behavior-json';
import { assembleProductPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack as campWork } from '../../changes/2026-09-10-npc-composable-baseline/examples/camp-work';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import {
  observationMatches,
  validBinding,
  validBirth,
  validCapabilities,
  validWorld,
} from '../../apps/agent-server/src/node/resident-host-validation';
import { verifiedBehaviorPack } from '../support/behavior-capability-fixtures';
import { createMaximumBehaviorCatalog } from '../support/behavior-capability-catalog';
import { baselineObservation, behaviorCatalog, binding, maximumIntendedChineseObservation } from './fixtures';

const frameBytes = (value: unknown): number => {
  const json = JSON.stringify(value);
  const bytes = behaviorJsonBytes(value);
  expect(bytes).toBe(Buffer.byteLength(json, 'utf8'));
  return bytes;
};

const campCatalog = () => {
  const base = verifiedBehaviorPack(overworld);
  const extension = verifiedBehaviorPack(campWork);
  const composition = assembleProductPacks([base, extension], {
    approvedExtensions: [
      {
        id: extension.manifest.id,
        version: extension.manifest.version,
        integrity: extension.integrity,
        permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
      },
    ],
  });
  return composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY).catalog();
};

describe('resident capability frame budgets', () => {
  it('keeps a maximum-width hello envelope with an exact-limit catalog below 128 KiB', () => {
    const authoringCapabilities = createMaximumBehaviorCatalog();
    const world: ResidentWorldBinding = {
      worldId: 'w'.repeat(160),
      timelineId: 't'.repeat(160),
      epoch: 'e'.repeat(160),
    };
    const message = {
      kind: 'hello',
      protocolVersion: RESIDENT_PROTOCOL_VERSION,
      // The first live hello is sequence zero; this safe-integer maximum conservatively budgets envelope width.
      sequence: Number.MAX_SAFE_INTEGER,
      pairingToken: 'p'.repeat(512),
      world,
      authoringCapabilities,
    } satisfies ResidentClientMessage;
    expect(validWorld(world)).toBe(true);
    expect(validCapabilities(authoringCapabilities)).toBe(true);
    expect(frameBytes(message)).toBeLessThan(RESIDENT_FRAME_MAX_BYTES);
    expect(frameBytes({ ...message, sequence: 0 } satisfies ResidentClientMessage)).toBeLessThan(
      RESIDENT_FRAME_MAX_BYTES,
    );
  });

  it('keeps the real Overworld plus camp catalog and maximum intended Chinese observation below 128 KiB', () => {
    const actorBinding = binding();
    const observation = maximumIntendedChineseObservation();
    const capabilities = campCatalog();
    const message = {
      kind: 'bind',
      protocolVersion: RESIDENT_PROTOCOL_VERSION,
      sequence: Number.MAX_SAFE_INTEGER,
      binding: actorBinding,
      observation,
      capabilities,
    } satisfies ResidentClientMessage;
    expect(
      validBinding(actorBinding, { worldId: actorBinding.worldId, timelineId: 'timeline', epoch: actorBinding.epoch }),
    ).toBe(true);
    expect(observationMatches(observation, actorBinding)).toBe(true);
    expect(validCapabilities(capabilities)).toBe(true);
    expect(frameBytes(message)).toBeLessThan(RESIDENT_FRAME_MAX_BYTES);
  });

  it('keeps a real default birth, initial observation, and Overworld actor catalog below 128 KiB', () => {
    const actorBinding = binding();
    const observation = baselineObservation();
    const birth: ResidentBirthPackage = {
      birthId: 'default-birth',
      profile: observation.character.profile,
      agent: 'Observe the current world before choosing an action.',
      soul: 'Respect the world and the people living in it.',
      memory: 'I have just arrived in this world.',
      goal: observation.character.behaviorTree.goal,
      definition: observation.character.behaviorTree.definition,
    };
    const message = {
      kind: 'bind',
      protocolVersion: RESIDENT_PROTOCOL_VERSION,
      sequence: 1,
      binding: actorBinding,
      observation,
      birth,
      capabilities: behaviorCatalog,
    } satisfies ResidentClientMessage;
    expect(observationMatches(observation, actorBinding)).toBe(true);
    expect(validBirth(birth, observation)).toBe(true);
    expect(validCapabilities(behaviorCatalog)).toBe(true);
    expect(frameBytes(message)).toBeLessThan(RESIDENT_FRAME_MAX_BYTES);
  });
});
