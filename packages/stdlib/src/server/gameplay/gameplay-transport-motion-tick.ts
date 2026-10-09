import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { AuthorityPhysicsFrame } from '../authority/authority-physics-frame';
import type { GameplayCallbacks } from './gameplay-runtime-contracts';
import type { EntityStore } from './entity-store';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import type { RegisteredTransportMotionRuntime } from './modules/registered-transport-motion-runtime';
import { commitGameplayDynamicBatch } from './gameplay-dynamic-batch';

/** The product Host invokes this manual system only inside its synchronous physics frontier. */
export function commitGameplayTransportMotionTick(
  motion: RegisteredTransportMotionRuntime | null,
  modules: GameplayModuleRuntime,
  callbacks: GameplayCallbacks,
  entities: EntityStore,
  kernel: KernelStateOwner,
  frame: AuthorityPhysicsFrame,
) {
  const authority = callbacks.moduleSystemAuthority;
  if (!motion || !authority) return null;
  let binding: ReturnType<GameplayModuleRuntime['bindSystem']> | undefined;
  let fallback: boolean;
  let attempted = false;
  let result: ReturnType<RegisteredTransportMotionRuntime['end']>;
  try {
    if (motion.begin(frame)) {
      attempted = true;
      binding = modules.bindSystem(authority.authorizer, {
        kind: 'system',
        moduleId: motion.config.moduleId,
        principalId: authority.principalId,
        systemId: motion.config.systemId,
      });
      binding.invoke({ operationId: motion.config.operationId, target: { kind: 'world' } });
    }
    fallback = !motion.isFresh();
  } finally {
    binding?.dispose();
    result = motion.end();
  }
  if (result || !attempted) return result;
  // Registered rules can change owners before rejecting. Preserve those accepted changes;
  // the next tick recomputes physics from the current owner instead of restoring stale bodies.
  const current = motion.currentFallback(frame, !fallback);
  const held = new Map(current.map((entry) => [entry.id, entry]));
  const updates = fallback ? current : frame.updates.map((entry) => held.get(entry.id) ?? entry);
  if (updates.length) commitGameplayDynamicBatch(entities, kernel, updates);
  return current;
}
