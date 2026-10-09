import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { transportBodyConfig } from '../gameplay/transport-body-config';
import type { GameServer } from '../game-server';

/** Physics and geometry recovery resolve the same current world-local definition. */
export function authorityBodyConfig(
  server: Pick<GameServer, 'createEntityReference' | 'transportState' | 'gameplayContent'>,
  entity: Readonly<{ id: string; type: string; archetype?: string }>,
) {
  if (entity.type !== 'transport') return bodyConfigFor(bodyKindForEntity(entity));
  const reference = server.createEntityReference(entity.id);
  const state = reference && server.transportState(reference);
  const definition = state && server.gameplayContent.transportDefinitions?.require(state.definitionId);
  if (!definition) throw new Error('Authority transport body requires its current configured definition.');
  return transportBodyConfig(definition);
}
