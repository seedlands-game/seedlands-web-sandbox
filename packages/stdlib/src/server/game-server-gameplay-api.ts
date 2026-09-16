import { GameServerGameplayHost } from './game-server-gameplay-host';

export const GAME_SERVER_GAMEPLAY_API = [
  'createEntity',
  'spawnEntity',
  'spawnPlayer',
  'spawnWorldItem',
  'spawnAutonomousActor',
  'character',
  'getEntity',
  'createEntityReference',
  'resolveEntityReference',
  'updateEntity',
  'updateEntityWithoutSnapshot',
  'updateEntitiesWithoutSnapshot',
  'despawnEntity',
  'queryEntities',
  'queryNearbyEntities',
  'getActorModeState',
  'acknowledgeBlockCommit',
  'bindModuleOperations',
  'invokeModuleOperation',
  'invokeActorModuleOperation',
  'getNearbyStations',
  'listStationRecipes',
  'hasGameplayComposition',
  'gameplayResources',
  'disposeGameplay',
  'getPlayerState',
  'getInventory',
  'getInventoryPointerView',
  'itemDefinitions',
  'gameplayContent',
  'giveItem',
  'removeItem',
  'selectHotbarSlot',
  'moveInventorySlot',
  'inventoryPointer',
  'useInventoryItem',
  'craft',
  'listCraftableRecipes',
  'listRecipes',
  'beginBreak',
  'cancelBreak',
  'pickupItem',
  'dropItem',
  'placeVoxel',
  'useSelectedItem',
  'attackEntity',
  'getCombatState',
  'applyDamage',
  'healPlayer',
  'setHungerForDebug',
  'respawnPlayer',
  'advanceGameplayRules',
  'gameplayAdvanceCommitUpperBound',
  'applyActorAuthorityAction',
  'gameplayTime',
  'gameplayRevision',
  'persistedGameplayRevision',
  'gameplayMetrics',
  'getActorState',
  'getActorControlSource',
  'startActorAction',
  'interruptActorAction',
  'getActorAction',
  'getAction',
  'observeActor',
  'registerPoi',
  'removePoi',
  'getPoi',
  'queryPois',
  'queryNavigationPath',
  'simulationSnapshot',
  'updateStarterEcologyVersion',
  'simulationMetrics',
  'restoredGameplayVersion',
] as const satisfies readonly (keyof GameServerGameplayHost)[];

export type GameServerGameplayApi = Pick<GameServerGameplayHost, (typeof GAME_SERVER_GAMEPLAY_API)[number]>;

export function installGameServerGameplayApi(target: object, host: GameServerGameplayHost): void {
  const prototype = GameServerGameplayHost.prototype;
  for (const name of GAME_SERVER_GAMEPLAY_API) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor) throw new Error(`Gameplay host API descriptor is missing: ${name}`);
    Object.defineProperty(
      target,
      name,
      descriptor.get
        ? { configurable: true, enumerable: false, get: descriptor.get.bind(host) }
        : {
            configurable: true,
            enumerable: false,
            value: (...args: unknown[]) =>
              Reflect.apply(descriptor.value as (...values: unknown[]) => unknown, host, args),
          },
    );
  }
}
