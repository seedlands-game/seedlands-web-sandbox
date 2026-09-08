import type { Asset, MaterialAsset, PixelTexture } from '../../client/presentation/asset-types';
import {
  createEmptyAppearanceProject,
  resolveAppearanceAssets,
  type AppearanceProject,
} from '../../client/presentation/appearance-project';
import { dependencyUsers } from '../../client/presentation/appearance-catalog';

export class AppearanceEditor {
  project = createEmptyAppearanceProject();
  private past: AppearanceProject[] = [];
  private future: AppearanceProject[] = [];
  private saved = JSON.stringify(this.project);
  get dirty() {
    return JSON.stringify(this.project) !== this.saved;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  load(project: AppearanceProject) {
    this.project = structuredClone(project);
    this.saved = JSON.stringify(project);
    this.past = [];
    this.future = [];
  }
  markSaved() {
    this.saved = JSON.stringify(this.project);
  }
  checkpoint() {
    this.past.push(structuredClone(this.project));
    if (this.past.length > 20) this.past.shift();
    this.future = [];
  }
  undo() {
    const project = this.past.pop();
    if (project) {
      this.future.push(this.project);
      this.project = project;
    }
  }
  redo() {
    const project = this.future.pop();
    if (project) {
      this.past.push(this.project);
      this.project = project;
    }
  }
  put(asset: Asset) {
    const next = structuredClone(asset);
    next.source = 'user';
    next.revision++;
    this.project.assets = [...this.project.assets.filter((candidate) => candidate.id !== next.id), next];
    this.project.thumbnails = {};
  }
  edit(asset: Asset, change: (asset: Asset) => void) {
    this.checkpoint();
    const next = structuredClone(asset);
    change(next);
    this.put(next);
  }
  paint(texture: PixelTexture, x: number, y: number, color: number) {
    const next = structuredClone(texture);
    next.payload.pixels[y * next.payload.width + x] = color;
    this.put(next);
  }
  makeMaterialPrivate(modelId: string, slot: MaterialAsset) {
    this.checkpoint();
    const all = resolveAppearanceAssets(this.project, modelId);
    const texture = all.find((asset) => asset.id === slot.payload.textureId);
    if (texture?.type !== 'pixel-texture') throw new Error('此材质没有可复制的像素源');
    const textureCopy = structuredClone(texture);
    textureCopy.id = `user:texture/${crypto.randomUUID()}`;
    textureCopy.name += ' · 专用';
    this.put(textureCopy);
    const material = structuredClone(slot);
    material.id = `user:material/${crypto.randomUUID()}`;
    material.name += ' · 专用';
    material.payload.textureId = textureCopy.id;
    this.put(material);
    this.project.materialBindings[modelId] = { ...this.project.materialBindings[modelId], [slot.id]: material.id };
  }
  materialSource(modelId: string, slot: MaterialAsset): MaterialAsset {
    const id = this.project.materialBindings[modelId]?.[slot.id] ?? slot.id;
    return (
      resolveAppearanceAssets(this.project).find(
        (asset): asset is MaterialAsset => asset.id === id && asset.type === 'material',
      ) ?? slot
    );
  }
  users(id: string) {
    const all = resolveAppearanceAssets(this.project);
    const users = dependencyUsers(id, all);
    const referenced = new Set([id, ...users.map((asset) => asset.id)]);
    for (const [modelId, slots] of Object.entries(this.project.materialBindings)) {
      if (!Object.values(slots).some((materialId) => referenced.has(materialId))) continue;
      const model = all.find((asset) => asset.id === modelId);
      if (model && !users.some((asset) => asset.id === modelId)) users.push(model);
    }
    return users;
  }
  resetAsset(id: string) {
    this.checkpoint();
    this.project.assets = this.project.assets.filter((asset) => asset.id !== id);
    delete this.project.materialBindings[id];
    this.project.thumbnails = {};
  }
}
