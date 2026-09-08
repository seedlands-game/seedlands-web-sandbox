import {
  loadAppearanceProject,
  saveAppearanceProject,
  loadAppearanceModelBlobs,
} from '../../../src/client/persistence/appearance-project-store';
import { listGlbModels, loadGlbBlob, reimportGlbModel } from '../../../src/client/persistence/glb-model-store';
export { listGlbModels };

export async function modelBytes(id: string) {
  return Array.from(new Uint8Array(await (await loadGlbBlob(id)).arrayBuffer()));
}

export async function atomicStorageCases() {
  const initial = await loadAppearanceProject();
  const writes = await Promise.allSettled([
    saveAppearanceProject(initial.draft, initial.revision),
    saveAppearanceProject(initial.draft, initial.revision),
  ]);
  const before = await loadAppearanceProject();
  const models = await loadAppearanceModelBlobs();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === 'models') throw new DOMException('injected model store quota', 'QuotaExceededError');
    return put.apply(this, args);
  };
  let rejected = false;
  try {
    await saveAppearanceProject(before.draft, before.revision, true, models);
  } catch {
    rejected = true;
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  return {
    successfulWrites: writes.filter((write) => write.status === 'fulfilled').length,
    rejected,
    unchanged: JSON.stringify(before) === JSON.stringify(await loadAppearanceProject()),
  };
}

export async function glbSaveConflict() {
  const state = await loadAppearanceProject();
  const models = await loadAppearanceModelBlobs();
  const model = models[0];
  if (!model) throw new Error('Expected project GLB');
  await reimportGlbModel(model.id, new File([model.blob], model.name), model.revision);
  let rejected = false;
  try {
    await saveAppearanceProject(state.draft, state.revision, false, models);
  } catch {
    rejected = true;
  }
  const after = await loadAppearanceModelBlobs();
  return { rejected, revision: after[0].revision, expectedRevision: model.revision + 1 };
}
