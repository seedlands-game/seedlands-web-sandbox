import type { GameServer } from '../game-server';
import type { StructureTargetPortV1 } from '../gameplay/modules/structure-target-dispatch';
import { STRUCTURE_ACTIONS_CAPABILITY } from '../gameplay/modules/structure-actions-module';

export function createAuthorityStructureTargetPort(server: GameServer): StructureTargetPortV1 | undefined {
  const enabled = server.options.composition?.definitionMap.capabilities.some(
    ({ id }) => id === STRUCTURE_ACTIONS_CAPABILITY,
  );
  if (!enabled) return undefined;
  const current = () => {
    const runtime = server.structureTargets;
    if (!runtime) throw new Error('Registered Structure runtime is unavailable.');
    return runtime;
  };
  return Object.freeze({
    prepare: (action, actorId) => current().prepare(action, actorId),
    prepareBreak: (actorId, hit) => current().prepareBreak(actorId, hit),
    resolve: (input) => current().resolve(input),
    invoke: (input) => current().invoke(input),
    breakFromMining: (actorId, hit) => current().breakFromMining(actorId, hit),
    completeBreakFromMining: (actorId, hit) => current().completeBreakFromMining(actorId, hit),
  });
}
