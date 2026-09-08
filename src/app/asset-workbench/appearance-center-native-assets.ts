import type {
  Asset,
  MaterialAsset,
  NativeAsset,
  PixelModel,
  PixelTexture,
} from '../../client/presentation/asset-types';
import { copyAssetBundle } from '../../client/presentation/asset-package';
import { EditorState } from './editor-state';
import type { AppearanceEditor } from './appearance-editor';

export function createNativeAssets(size: number, model: boolean): NativeAsset[] {
  const factory = new EditorState();
  factory.create(size, model);
  return factory.assets;
}

export function copyNativeAssets(id: string, assets: readonly Asset[]): NativeAsset[] {
  const copies = copyAssetBundle(id, assets, () => `user:asset/${crypto.randomUUID()}`);
  copies.forEach((asset) => (asset.name += ' 副本'));
  return copies;
}

export function colorFromHex(value: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

export function resizePixelTexture(texture: PixelTexture, size: number): PixelTexture {
  const source = texture.payload;
  return {
    ...texture,
    payload: {
      ...source,
      width: size,
      height: size,
      pixels: Array.from({ length: size * size }, (_, index) => {
        const x = index % size;
        const y = Math.floor(index / size);
        return source.pixels[
          Math.floor((y * source.height) / size) * source.width + Math.floor((x * source.width) / size)
        ];
      }),
    },
  };
}

export function insertNativeAssets(
  editor: AppearanceEditor,
  visible: readonly Asset[],
  assets: readonly NativeAsset[],
): void {
  if (editor.project.assets.length + assets.length > 128)
    throw new Error('外观项目最多保存 128 项可编辑资产，请先导出并整理草稿。');
  const known = new Set(visible.map((asset) => asset.id));
  if (assets.some((asset) => known.has(asset.id)) || new Set(assets.map((asset) => asset.id)).size !== assets.length)
    throw new Error('新资产标识冲突，当前草稿未改变。');
  editor.checkpoint();
  for (const asset of assets) editor.put({ ...asset, revision: 0 });
}

export function createAndInsertNativeAssets(
  editor: AppearanceEditor,
  visible: readonly Asset[],
  size: number,
  model: boolean,
): NativeAsset[] {
  const assets = createNativeAssets(size, model);
  insertNativeAssets(editor, visible, assets);
  return assets;
}

export function copyAndInsertNativeAssets(
  editor: AppearanceEditor,
  focus: Asset | undefined,
  visible: readonly Asset[],
): NativeAsset[] | null {
  if (!focus || (focus.type !== 'pixel-texture' && focus.type !== 'extruded-pixel-model')) return null;
  const assets = copyNativeAssets(focus.id, visible);
  insertNativeAssets(editor, visible, assets);
  return assets;
}

export function nativeReferences(
  asset: NativeAsset,
  visible: readonly Asset[],
  bindings: Record<string, Record<string, string>>,
): string[] {
  const direct = visible
    .filter(
      (candidate) =>
        candidate.id !== asset.id &&
        (candidate.type === 'extruded-pixel-model' || candidate.type === 'material') &&
        candidate.payload.textureId === asset.id,
    )
    .map((candidate) => candidate.name);
  return [
    ...direct,
    ...Object.entries(bindings)
      .filter(([, slots]) => Object.values(slots).includes(asset.id))
      .map(([id]) => id),
  ];
}

export function deleteNativeAsset(
  editor: AppearanceEditor,
  asset: NativeAsset,
  visible: readonly Asset[],
  confirmDelete: (name: string) => boolean,
): string[] | null {
  const references = nativeReferences(asset, visible, editor.project.materialBindings);
  if (references.length || !confirmDelete(asset.name)) return references;
  editor.resetAsset(asset.id);
  return null;
}

export function deleteSelectedNativeAsset(
  editor: AppearanceEditor,
  focus: Asset | undefined,
  visible: readonly Asset[],
  confirmDelete: (name: string) => boolean,
): { deleted: boolean; references: string[] } | null {
  if (!focus || focus.source !== 'user' || (focus.type !== 'pixel-texture' && focus.type !== 'extruded-pixel-model'))
    return null;
  const references = deleteNativeAsset(editor, focus, visible, confirmDelete);
  return { deleted: references === null, references: references ?? [] };
}

export function editAppearanceMaterial(
  editor: AppearanceEditor,
  modelId: string,
  slot: MaterialAsset,
  field: 'roughness' | 'metalness' | 'emissiveIntensity',
  value: number,
): string {
  const source = editor.materialSource(modelId, slot);
  editor.edit(source, (asset) => {
    if (asset.type === 'material') asset.payload[field] = value;
  });
  return source.id;
}

export function makeAppearanceMaterialPrivate(editor: AppearanceEditor, modelId: string, slot: MaterialAsset): string {
  editor.makeMaterialPrivate(modelId, slot);
  return editor.project.materialBindings[modelId][slot.id];
}

export function editAppearancePixelModel(
  editor: AppearanceEditor,
  model: PixelModel,
  change: (model: PixelModel) => void,
): void {
  editor.checkpoint();
  const next = structuredClone(model);
  change(next);
  editor.put(next);
}

export function editFocusedPixelModel(
  editor: AppearanceEditor,
  asset: Asset | undefined,
  change: (model: PixelModel) => void,
): boolean {
  if (asset?.type !== 'extruded-pixel-model') return false;
  editAppearancePixelModel(editor, asset, change);
  return true;
}

export function paintAppearancePixel(
  editor: AppearanceEditor,
  texture: PixelTexture,
  x: number,
  y: number,
  color: number,
): void {
  editor.paint(texture, x, y, Math.min(color, texture.payload.palette.length - 1));
}

export function replaceAppearanceImage(editor: AppearanceEditor, asset: Asset | undefined, path: string): boolean {
  if (asset?.type !== 'image-texture') return false;
  editor.edit(asset, (current) => {
    if (current.type === 'image-texture') current.payload.path = path;
  });
  return true;
}

export function replacePaletteColor(
  editor: AppearanceEditor,
  texture: PixelTexture,
  index: number,
  value: string,
): boolean {
  const rgb = index > 0 && index < texture.payload.palette.length ? colorFromHex(value) : null;
  if (!rgb) return false;
  editor.edit(texture, (asset) => {
    if (asset.type === 'pixel-texture') asset.payload.palette[index] = rgb;
  });
  return true;
}

export function resizeAppearanceTexture(editor: AppearanceEditor, texture: PixelTexture, size: number): number | null {
  const previous = texture.payload.width;
  if (![16, 32, 64].includes(size) || previous === size) return null;
  editor.edit(texture, (asset) => {
    if (asset.type === 'pixel-texture') asset.payload = resizePixelTexture(asset, size).payload;
  });
  return previous;
}
