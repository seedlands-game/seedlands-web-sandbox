export type Rgb = [number, number, number];
export type AssetSource = 'builtin' | 'user';
type AssetRecord<T extends string, P> = {
  id: string;
  name: string;
  revision: number;
  source: AssetSource;
  type: T;
  payload: P;
};
export type PixelTexture = AssetRecord<
  'pixel-texture',
  {
    width: number;
    height: number;
    palette: Rgb[];
    pixels: number[];
  }
>;
export type PixelModel = AssetRecord<
  'extruded-pixel-model',
  {
    textureId: string;
    thicknessPixels: number;
    grip: [number, number];
    generatorVersion: 1;
  }
>;
export type ImageTexture = AssetRecord<'image-texture', { path: string }>;
export type BuiltinModel = AssetRecord<'builtin-item-model', { itemId: string; materialIds: string[] }>;
export type NativeAsset = PixelTexture | PixelModel;
export type Asset =
  | NativeAsset
  | ImageTexture
  | BuiltinModel
  | MaterialAsset
  | VoxelModelAsset
  | ActorModelAsset
  | ArmModelAsset
  | GlbAsset;
export type ItemAssetBinding = { itemId: string; name: string; iconId: string; modelId: string };
export type ToolModel = Readonly<{
  pixels: readonly string[];
  palette: Readonly<Record<string, readonly [number, number, number]>>;
  grip: readonly [number, number];
  thicknessPixels?: number;
}>;

export type MaterialAsset = AssetRecord<
  'material',
  {
    textureId: string;
    renderMode: 'opaque' | 'cutout' | 'transparent';
    roughness: number;
    metalness: number;
    emissive: [number, number, number];
    emissiveIntensity: number;
  }
>;
export type VoxelModelAsset = AssetRecord<'builtin-voxel-model', { voxelId: number; materialIds: string[] }>;
export type ActorModelAsset = AssetRecord<
  'builtin-actor-model',
  { kind: 'grazer' | 'stalker' | 'settler' | 'player'; materialIds: string[] }
>;
export type ArmModelAsset = AssetRecord<'builtin-arm-model', { materialIds: string[] }>;
export type GlbAsset = AssetRecord<
  'glb-model',
  { modelId: string; byteLength: number; nodeCount: number; triangleCount: number }
>;
