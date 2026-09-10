import type { WorldComposition } from '../../composition/contracts';
import type { ActorModuleExecutionContext } from '../../composition/authorized-execution';
import type { WorldResourceAuthorizer } from '../../harness/world-authorization';
import type { EntityStore } from '../entity-store';
import type { GameplayContent } from '../gameplay-content';
import type { PreparedEntityMutationInput, PreparedWorldItemSpawn } from '../prepared-entity-mutation';
import type { BlockVoxelEditV1 } from './block-action-model';
import { STATION_RESOURCE } from './station-action-model';

/** Extends the existing Block owner plan; station contents never commit independently of voxel destruction. */
export function prepareBlockStationEffects(
  options: Readonly<{
    entities: EntityStore;
    content: GameplayContent;
    composition: WorldComposition;
    authorizer: WorldResourceAuthorizer;
    context: ActorModuleExecutionContext;
  }>,
  edit: BlockVoxelEditV1 | undefined,
) {
  const empty: PreparedEntityMutationInput = {};
  if (!edit) return { input: empty, drops: [] as PreparedWorldItemSpawn[], validate() {} };
  const codec = options.content.stations?.codec;
  const before = codec?.kindForVoxel(edit.fromVoxel),
    after = codec?.kindForVoxel(edit.toVoxel);
  const existing = options.entities.stationAt(edit.position);
  if (
    (!before && existing) ||
    (before && (!existing || options.entities.stationSnapshot(existing.id)?.kind !== before))
  )
    throw new Error('station-voxel-mismatch');
  if (!before && !after) return { input: empty, drops: [] as PreparedWorldItemSpawn[], validate() {} };
  if (before && after) throw new Error('station-replacement-requires-remove');
  const reference = existing ? options.entities.createReference(existing.id)! : null;
  const component = existing ? options.entities.stationSnapshot(existing.id)! : null;
  const drops: PreparedWorldItemSpawn[] = [];
  if (component) {
    const slots =
      component.kind === 'chest'
        ? component.slots
        : component.kind === 'workbench'
          ? component.grid
          : [component.furnace.input, component.furnace.fuel, component.furnace.output];
    for (const stack of slots)
      if (stack)
        drops.push({
          position: edit.position.map((v) => v + 0.5) as [number, number, number],
          stack: options.content.items.normalizeStack(stack),
        });
  }
  const validate = () => {
    const target = reference
      ? { kind: 'entity' as const, entityId: reference.entityId }
      : { kind: 'voxel' as const, position: edit.position };
    if (
      !options.authorizer.authorize(options.context.principal.id, {
        resource: STATION_RESOURCE,
        operation: 'execute',
        target,
      }).allowed
    )
      throw new TypeError('Station Block execution permission denied.');
    if (
      !options.composition.moduleBindings[options.context.provenance.moduleId]?.permissions.some(
        (permission) => permission.resource === STATION_RESOURCE && permission.operations.includes('execute'),
      )
    )
      throw new TypeError('Block module station execution permission denied.');
    const current = options.entities.stationAt(edit.position);
    if (
      reference ? !options.entities.resolveReference(reference) || current?.id !== reference.entityId : current !== null
    )
      throw new Error('stale-station-position');
  };
  validate();
  return {
    input: {
      ...(reference ? { despawns: [reference] } : {}),
      ...(after ? { stationSpawns: [{ position: edit.position, kind: after }] } : {}),
    } satisfies PreparedEntityMutationInput,
    drops,
    validate,
  };
}
