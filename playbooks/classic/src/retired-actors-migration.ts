import type { GameplaySnapshotMigration } from '@seedlands/stdlib/mod-api';

const RETIRED_ARCHETYPES = new Set(['grazer', 'night-stalker', 'settler']);
const RETIRED_MELEE_DEFINITIONS = new Set(['night-stalker-claw']);
const REPORT_ID = 'seedlands:classic-retired-actors-v1';
// Rebuilt from the published pre-change source at 0759202 with
// scripts/build-gameplay-packs.mjs. These are intentionally not the older
// 6c7124a fixture digests, whose graph is only retained for fixture coverage.
const PRECHANGE_MANIFEST_DIGEST = '74d0a1a50d2812053fa442ae00137d285dd6b80954c3e21d788053eb2ec243f2';
const PRECHANGE_ENTRY_DIGEST = 'a0822ae7e3ae985c47db22deee54d77f788a0cd72eece3f4a4c46a4c6037eee6';
const LEGACY_OPERATION_IDS = [
  'seedlands:advance-combat',
  'seedlands:advance-needs',
  'seedlands:block-advance',
  'seedlands:block-begin',
  'seedlands:block-cancel',
  'seedlands:block-finish',
  'seedlands:block-place',
  'seedlands:consume-world-item',
  'seedlands:forage-advance',
  'seedlands:furnace-advance',
  'seedlands:inventory-consume',
  'seedlands:inventory-craft',
  'seedlands:inventory-drop',
  'seedlands:inventory-move',
  'seedlands:inventory-pickup',
  'seedlands:inventory-select',
  'seedlands:inventory-transfer',
  'seedlands:request-combat',
  'seedlands:resolve-combat',
  'seedlands:set-creative-catalog',
  'seedlands:set-flight',
  'seedlands:set-mode',
  'seedlands:station-craft',
  'seedlands:station-transfer',
];

type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
const rows = (value: unknown): RecordValue[] | null =>
  Array.isArray(value) && value.every((entry) => record(entry) !== null) ? (value as RecordValue[]) : null;
const idOf = (value: RecordValue) => (typeof value.id === 'string' ? value.id : null);
const actorIdOf = (value: RecordValue) => (typeof value.entityId === 'string' ? value.entityId : null);

const isRetiredEntity = (value: RecordValue) =>
  (value.type === 'creature' || value.type === 'npc') &&
  typeof value.archetype === 'string' &&
  RETIRED_ARCHETYPES.has(value.archetype);

const isClassicOverworldSource = (snapshot: RecordValue) => {
  const composition = record(snapshot.composition);
  const packLock = rows(composition?.packLock);
  const integrity = record(packLock?.[0]?.integrity);
  const definitionMap = record(composition?.definitionMap);
  const operations = rows(definitionMap?.operations);
  return (
    composition?.playbookId === 'seedlands:overworld' &&
    packLock?.length === 1 &&
    packLock[0]?.id === 'seedlands:overworld' &&
    packLock[0]?.version === '1.0.0' &&
    integrity?.algorithm === 'sha256' &&
    integrity.manifestDigest === PRECHANGE_MANIFEST_DIGEST &&
    integrity.entryDigest === PRECHANGE_ENTRY_DIGEST &&
    operations?.length === LEGACY_OPERATION_IDS.length &&
    operations.every((operation, index) => operation.id === LEGACY_OPERATION_IDS[index])
  );
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
  migrate(raw, context) {
    const snapshot = record(raw);
    if (
      !snapshot ||
      (snapshot.version !== 1 && snapshot.version !== 2 && snapshot.version !== 3 && snapshot.version !== 4)
    )
      return { snapshot: raw, reports: [] };
    if (snapshot.version === 4 && (!context.targetComposition || !isClassicOverworldSource(snapshot)))
      return { snapshot: raw, reports: [] };

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
