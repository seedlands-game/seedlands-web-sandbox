import { matchesGameplaySnapshotPredecessorV1, type GameplaySnapshotMigration } from '@seedlands/stdlib/mod-api';
import { classicGameplaySnapshotPredecessors } from './legacy-composition-identities';

const RETIRED_ARCHETYPES = new Set(['grazer', 'night-stalker', 'settler']);
const RETIRED_MELEE_DEFINITIONS = new Set(['night-stalker-claw']);
const REPORT_ID = 'seedlands:classic-retired-actors-v1';
// Rebuilt from the published pre-change source at 0759202 with
// scripts/build-gameplay-packs.mjs. These are intentionally not the older
// 6c7124a fixture digests, whose graph is only retained for fixture coverage.
const PRE_MEDIA_MANIFEST_DIGEST = '8c85965878299e56d918bdc89302789d38a26d3a04a1d924fe4e885daca3fae4';
const PRE_MEDIA_ENTRY_DIGEST = '9a22f2d679b8a00bba8a66658457de477c1b05500cf353fb7ed368c6d69bf12a';
const PRESENTATION_DIGEST = 'a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b';
const MEDIA_MODULE_ID = 'seedlands:overworld-media';
const MEDIA_CAPABILITY_ID = 'seedlands:media-playback';
const MEDIA_RESOURCE_ID = 'seedlands.media-playback';
const MEDIA_STATE_ID = 'seedlands:media-playback-device';
const MEDIA_OPERATION_IDS = new Set([
  'seedlands:media-activate',
  'seedlands:media-eject',
  'seedlands:media-insert',
  'seedlands:media-insert-and-activate',
  'seedlands:media-stop',
  'seedlands:media-switch',
]);
type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
const rows = (value: unknown): RecordValue[] | null =>
  Array.isArray(value) && value.every((entry) => record(entry) !== null) ? (value as RecordValue[]) : null;
const idOf = (value: RecordValue) => (typeof value.id === 'string' ? value.id : null);
const actorIdOf = (value: RecordValue) => (typeof value.entityId === 'string' ? value.entityId : null);

const canonicalData = (input: unknown): string | null => {
  let budget = 262_144;
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): string => {
    if (--budget < 0 || depth > 24) throw new TypeError('Classic migration identity exceeds limits.');
    if (value === null || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'string') {
      budget -= value.length;
      return JSON.stringify(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (!value || typeof value !== 'object' || active.has(value))
      throw new TypeError('Classic migration identity is invalid.');
    const keys = Object.keys(value).sort();
    if (Array.isArray(value) && (keys.length !== value.length || Reflect.ownKeys(value).length !== value.length + 1))
      throw new TypeError('Classic migration identity array is invalid.');
    active.add(value);
    const result = Array.isArray(value)
      ? `[${value.map((entry) => visit(entry, depth + 1)).join(',')}]`
      : `{${keys.map((key) => `${JSON.stringify(key)}:${visit((value as RecordValue)[key], depth + 1)}`).join(',')}}`;
    active.delete(value);
    return result;
  };
  try {
    return visit(input, 0);
  } catch {
    return null;
  }
};

const isRetiredEntity = (value: RecordValue) =>
  (value.type === 'creature' || value.type === 'npc') &&
  typeof value.archetype === 'string' &&
  RETIRED_ARCHETYPES.has(value.archetype);

const isPreMediaClassicSource = (snapshot: RecordValue, targetComposition: unknown) => {
  const source = record(snapshot.composition);
  const target = record(targetComposition);
  const definitionMap = record(target?.definitionMap);
  const packLock = rows(target?.packLock);
  const modules = rows(definitionMap?.modules);
  const capabilities = rows(definitionMap?.capabilities);
  const resources = rows(definitionMap?.resources);
  const stateCodecs = rows(definitionMap?.stateCodecs);
  const operations = rows(definitionMap?.operations);
  if (
    !source ||
    !target ||
    target.playbookId !== 'seedlands:overworld' ||
    packLock?.length !== 1 ||
    packLock[0]?.id !== 'seedlands:overworld' ||
    packLock[0]?.version !== '1.0.0' ||
    !definitionMap ||
    !modules ||
    !capabilities ||
    !resources ||
    !stateCodecs ||
    !operations
  )
    return false;
  const expected = {
    ...target,
    packLock: [
      {
        ...packLock[0],
        integrity: {
          algorithm: 'sha256',
          manifestDigest: PRE_MEDIA_MANIFEST_DIGEST,
          entryDigest: PRE_MEDIA_ENTRY_DIGEST,
          resources: [{ path: 'playbooks/classic/presentation.json', digest: PRESENTATION_DIGEST }],
        },
      },
    ],
    definitionMap: {
      ...definitionMap,
      modules: modules.filter(({ id }) => id !== MEDIA_MODULE_ID),
      capabilities: capabilities.filter(({ id }) => id !== MEDIA_CAPABILITY_ID),
      resources: resources.filter(({ id }) => id !== MEDIA_RESOURCE_ID),
      stateCodecs: stateCodecs.filter(({ id }) => id !== MEDIA_STATE_ID),
      operations: operations.filter(({ id }) => !MEDIA_OPERATION_IDS.has(String(id))),
    },
  };
  const sourceIdentity = canonicalData(source);
  return sourceIdentity !== null && sourceIdentity === canonicalData(expected);
};

const referencesRetiredActor = (value: RecordValue, retiredIds: ReadonlySet<string>) =>
  (typeof value.actorId === 'string' && retiredIds.has(value.actorId)) ||
  (typeof value.targetEntityId === 'string' && retiredIds.has(value.targetEntityId)) ||
  (record(value.actorIdentity) !== null && retiredIds.has(record(value.actorIdentity)!.entityId as string)) ||
  (record(value.targetIdentity) !== null && retiredIds.has(record(value.targetIdentity)!.entityId as string));

const cleanCharacter = (value: RecordValue, retiredIds: ReadonlySet<string>, retiredActionIds: ReadonlySet<string>) => {
  const next = { ...value };
  const targets = rows(value.targets);
  if (targets) next.targets = targets.filter((target) => !retiredIds.has(String(target.targetId)));
  if (typeof value.executionTargetId === 'string' && retiredIds.has(value.executionTargetId))
    delete next.executionTargetId;
  if (typeof value.lastThreatEntityId === 'string' && retiredIds.has(value.lastThreatEntityId))
    delete next.lastThreatEntityId;
  if (typeof value.actionId === 'string' && retiredActionIds.has(value.actionId)) delete next.actionId;
  return next;
};

/** Removes the retired Classic-only ecology without admitting arbitrary Pack snapshots. */
export const classicRetiredActorsMigration: GameplaySnapshotMigration = Object.freeze({
  predecessors: classicGameplaySnapshotPredecessors,
  migrate(raw, context) {
    const snapshot = record(raw);
    if (
      !snapshot ||
      (snapshot.version !== 1 && snapshot.version !== 2 && snapshot.version !== 3 && snapshot.version !== 4)
    )
      return { snapshot: raw, reports: [] };
    if (snapshot.version === 4) {
      if (!context.targetComposition) return { snapshot: raw, reports: [] };
      if (
        !matchesGameplaySnapshotPredecessorV1(classicGameplaySnapshotPredecessors, 4, snapshot.composition) &&
        !isPreMediaClassicSource(snapshot, context.targetComposition)
      )
        return { snapshot: raw, reports: [] };
    }
    const entityStore = snapshot.version === 4 ? record(snapshot.entityStore) : null;
    const entities = rows(snapshot.version === 4 ? entityStore?.entities : snapshot.entities);
    const simulation = record(snapshot.simulation);
    const autonomous = rows(simulation?.actors);
    const retiredIds = new Set<string>();
    entities?.forEach((entity) => {
      const id = idOf(entity);
      if (id && isRetiredEntity(entity)) retiredIds.add(id);
    });
    autonomous?.forEach((actor) => {
      const id = actorIdOf(actor);
      if (id && typeof actor.archetype === 'string' && RETIRED_ARCHETYPES.has(actor.archetype)) retiredIds.add(id);
    });
    if (snapshot.version === 4) snapshot.composition = context.targetComposition;
    if (entities) {
      const retained = entities.filter((entity) => !retiredIds.has(idOf(entity) ?? ''));
      if (snapshot.version === 4 && entityStore) entityStore.entities = retained;
      else snapshot.entities = retained;
    }
    if (entityStore) {
      const identities = rows(entityStore.identities);
      if (identities)
        entityStore.identities = identities.filter((identity) => !retiredIds.has(String(identity.entityId)));
      const components = rows(entityStore.actors);
      if (components) {
        entityStore.actors = components
          .filter((actor) => !retiredIds.has(String(actor.entityId)))
          .map((actor) => ({
            ...actor,
            ...(record(actor.character)
              ? { character: cleanCharacter(record(actor.character)!, retiredIds, new Set()) }
              : {}),
          }));
      }
    }
    if (simulation) {
      if (autonomous) {
        simulation.actors = autonomous
          .filter((actor) => !retiredIds.has(String(actor.entityId)))
          .map((actor) =>
            typeof actor.targetEntityId === 'string' && retiredIds.has(actor.targetEntityId)
              ? { ...actor, targetEntityId: null }
              : actor,
          );
      }
      const actions = record(simulation.actions);
      const actionRows = rows(actions?.actions);
      const retiredActionIds = new Set<string>();
      if (actions && actionRows) {
        for (const action of actionRows)
          if (referencesRetiredActor(action, retiredIds) && typeof action.id === 'string')
            retiredActionIds.add(action.id);
        actions.actions = actionRows.filter((action) => !retiredActionIds.has(String(action.id)));
      }
      const combat = record(simulation.combat);
      const combatants = rows(combat?.combatants);
      if (combat && combatants) {
        combat.combatants = combatants.filter((entry) => {
          if (referencesRetiredActor(entry, retiredIds)) return false;
          const state = record(entry.combat);
          const active = record(state?.active);
          const result = record(state?.lastResult);
          return !(
            (active &&
              (retiredIds.has(String(active.targetId)) ||
                RETIRED_MELEE_DEFINITIONS.has(String(active.definitionId)))) ||
            (result &&
              (retiredIds.has(String(result.targetId)) || RETIRED_MELEE_DEFINITIONS.has(String(result.definitionId))))
          );
        });
      }
      for (const key of ['characters', 'characterTombstones']) {
        const characters = record(simulation[key]);
        const characterRows = rows(characters?.characters);
        if (characters && characterRows)
          characters.characters = characterRows
            .filter((character) => !retiredIds.has(String(character.entityId)))
            .map((character) => cleanCharacter(character, retiredIds, retiredActionIds));
      }
      if (entityStore) {
        const components = rows(entityStore.actors);
        if (components)
          entityStore.actors = components.map((actor) => ({
            ...actor,
            ...(record(actor.character)
              ? { character: cleanCharacter(record(actor.character)!, retiredIds, retiredActionIds) }
              : {}),
          }));
      }
    }
    return {
      snapshot,
      reports: retiredIds.size === 0 ? [] : [{ id: REPORT_ID, removedActorIds: [...retiredIds].sort() }],
    };
  },
});
