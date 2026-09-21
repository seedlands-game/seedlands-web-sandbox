import { BrowserChunkPersistence } from '../../client/persistence/browser-chunk-persistence';

export const latestBrowserWorldSeed = async () => (await BrowserChunkPersistence.latestWorld())?.seedText ?? null;
export const listBrowserWorlds = () => BrowserChunkPersistence.listWorlds();
export const deleteBrowserWorld = (worldId: string) => BrowserChunkPersistence.deleteWorld(worldId);
