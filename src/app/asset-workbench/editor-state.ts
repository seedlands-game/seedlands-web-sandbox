import type { Asset, NativeAsset, PixelTexture, PixelModel } from '../../client/presentation/asset-types';
import { assetDependencies } from '../../client/presentation/asset-adapters';
import { assetBundle, copyAssetBundle, remapAssetBundle } from '../../client/presentation/asset-package';
import { builtinAssets } from '../../client/presentation/asset-catalog';

export class EditorState {
  assets: NativeAsset[] = [];
  selectedId = 'builtin:model:stone-pickaxe';
  editRevision = 0;
  private saved = '[]';
  private undoStack: NativeAsset[][] = [];
  private redoStack: NativeAsset[][] = [];
  get all(): Asset[] {
    return [...builtinAssets, ...this.assets];
  }
  get selected() {
    return this.all.find((a) => a.id === this.selectedId);
  }
  get dirty() {
    return JSON.stringify(this.assets) !== this.saved;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  load(assets: NativeAsset[]) {
    this.assets = structuredClone(assets);
    this.saved = JSON.stringify(this.assets);
    this.undoStack = [];
    this.redoStack = [];
    this.editRevision++;
    if (!this.selected) this.selectedId = 'builtin:model:stone-pickaxe';
  }
  markSaved(assets: NativeAsset[]) {
    this.saved = JSON.stringify(assets);
  }
  checkpoint() {
    this.undoStack.push(structuredClone(this.assets));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }
  changed() {
    this.editRevision++;
  }
  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(structuredClone(this.assets));
    this.assets = previous;
    this.changed();
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.assets));
    this.assets = next;
    this.changed();
  }
  copy() {
    const bundle = copyAssetBundle(this.selectedId, this.all, () => crypto.randomUUID());
    bundle.forEach((a) => (a.name += ' 副本'));
    this.checkCapacity(bundle.length);
    this.checkpoint();
    this.assets.push(...bundle);
    this.selectedId = bundle.at(-1)!.id;
    this.changed();
  }
  create(size: number, model: boolean) {
    this.checkCapacity(model ? 2 : 1);
    this.checkpoint();
    const texture: PixelTexture = {
      id: crypto.randomUUID(),
      name: '新像素贴图',
      type: 'pixel-texture',
      source: 'user',
      revision: 1,
      payload: {
        width: size,
        height: size,
        palette: [
          [0, 0, 0],
          [68, 49, 39],
          [163, 106, 58],
          [225, 179, 102],
          [87, 115, 124],
          [172, 201, 202],
        ],
        pixels: Array<number>(size * size).fill(0),
      },
    };
    this.assets.push(texture);
    this.selectedId = texture.id;
    if (model) {
      const asset: PixelModel = {
        id: crypto.randomUUID(),
        name: '新物品模型',
        type: 'extruded-pixel-model',
        source: 'user',
        revision: 1,
        payload: { textureId: texture.id, thicknessPixels: 2, grip: [size / 2, size * 0.7], generatorVersion: 1 },
      };
      this.assets.push(asset);
      this.selectedId = asset.id;
    }
    this.changed();
  }
  deleteSelected() {
    const current = this.selected;
    if (!current || current.source !== 'user') throw new Error('内置资产不可删除');
    const users = this.all.filter((a) => assetDependencies(a).includes(current.id));
    if (users.length) throw new Error(`仍被引用：${users.map((a) => a.name).join('、')}`);
    this.checkpoint();
    this.assets = this.assets.filter((a) => a.id !== current.id);
    this.selectedId = 'builtin:model:stone-pickaxe';
    this.changed();
  }
  import(assets: NativeAsset[]) {
    const copies = remapAssetBundle(assets, () => crypto.randomUUID());
    this.checkCapacity(copies.length);
    this.checkpoint();
    this.assets.push(...copies);
    this.selectedId = copies.at(-1)?.id ?? this.selectedId;
    this.changed();
  }
  rebaseAsCopy(latest: NativeAsset[]) {
    const copies = remapAssetBundle(this.assets, () => crypto.randomUUID());
    if (latest.length + copies.length > 128) throw new Error('另存后超过128项，当前草稿已保留，请先导出备份');
    this.load(latest);
    this.checkpoint();
    this.assets.push(...copies);
    this.selectedId = copies.at(-1)?.id ?? this.selectedId;
    this.changed();
  }
  private checkCapacity(additional: number) {
    if (this.assets.length + additional > 128) throw new Error('本地资产库最多128项，请导出并整理已有草稿');
  }
  exportSelected() {
    return JSON.stringify(
      { schemaVersion: 1, assets: assetBundle(this.selectedId, this.all).map((a) => ({ ...a, source: 'user' })) },
      null,
      2,
    );
  }
}
