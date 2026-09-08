export const MAX_GLB_BYTES = 16 * 1024 * 1024;
export const MAX_GLB_MODELS = 16;
export const MAX_GLB_LIBRARY_BYTES = 64 * 1024 * 1024;
export const MAX_GLB_NODES = 256;
export const MAX_GLB_TRIANGLES = 100_000;
export const MAX_GLB_TEXTURE_EDGE = 4096;
export const MAX_GLB_TEXTURE_PIXELS = 16 * 1024 * 1024;

export type StoredGlb = Readonly<{
  id: string;
  name: string;
  revision: number;
  byteLength: number;
  nodeCount: number;
  triangleCount: number;
}>;

export type GlbModelStats = Readonly<{ nodeCount: number; triangleCount: number }>;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const supportedRequiredExtensions = new Set([
  'KHR_materials_clearcoat',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_texture_transform',
]);
const compressedExtensions = new Set(['EXT_meshopt_compression', 'KHR_draco_mesh_compression', 'KHR_texture_basisu']);

const fail = (message: string): never => {
  throw new Error(message);
};
const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const array = (document: JsonObject, key: string): Json[] => {
  const value = document[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`GLB ${key} 格式无效`);
  return value as Json[];
};
const integer = (value: Json | undefined, message: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(message);
  return value as number;
};
const indexedObject = (values: Json[], index: number, message: string): JsonObject => {
  const value = values[index];
  if (!isObject(value)) fail(message);
  return value as JsonObject;
};

function parseDocument(json: Uint8Array): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    return fail('GLB JSON 内容无效');
  }
  if (!isObject(value as Json)) return fail('GLB 根文档必须是对象');
  return value as JsonObject;
}

function rejectUris(value: Json, path = 'document'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectUris(entry, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'uri' && typeof nested === 'string') fail(`GLB 不允许外部 URI（${path}）`);
    rejectUris(nested, `${path}.${key}`);
  }
}

function validateExtensions(document: JsonObject): void {
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    const extensions = array(document, key);
    for (const extension of extensions) {
      if (typeof extension !== 'string') fail(`GLB ${key} 格式无效`);
      const name = extension as string;
      if (compressedExtensions.has(name)) fail(`GLB 不支持压缩扩展：${name}`);
      if (key === 'extensionsRequired' && !supportedRequiredExtensions.has(name)) fail(`GLB 必需扩展不受支持：${name}`);
    }
  }
}

const componentByteLengths = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);
const typeComponents = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT2', 4],
  ['MAT3', 9],
  ['MAT4', 16],
]);

type Accessor = Readonly<{ count: number; componentType: number; type: string; start: number; stride: number }>;

function validateStaticDocument(document: JsonObject, binary: Uint8Array | null): GlbModelStats {
  const asset = document.asset;
  if (!isObject(asset) || typeof asset.version !== 'string' || !/^2\.\d+$/.test(asset.version))
    fail('GLB 必须是 glTF 2.0 容器');
  rejectUris(document);
  validateExtensions(document);
  const animations = array(document, 'animations');
  if (animations.length) fail('GLB 不支持动画');
  const skins = array(document, 'skins');
  if (skins.length) fail('GLB 不支持骨骼蒙皮');
  const nodes = array(document, 'nodes');
  if (nodes.length > MAX_GLB_NODES) fail(`GLB 节点超过 ${MAX_GLB_NODES} 上限`);
  const binaryBytes = validateBuffers(document, binary);
  const bufferViews = validateBufferViews(document, binaryBytes);
  const accessors = array(document, 'accessors');
  const meshes = array(document, 'meshes');
  const meshTriangles = meshes.map((mesh, index) => validateMesh(mesh, index, accessors, bufferViews, binaryBytes));
  return { nodeCount: nodes.length, triangleCount: countSceneTriangles(document, nodes, meshTriangles) };
}

function validateBufferViews(document: JsonObject, binary: Uint8Array): JsonObject[] {
  return array(document, 'bufferViews').map((value) => {
    if (!isObject(value)) fail('GLB bufferView 格式无效');
    const view = value as JsonObject;
    if (integer(view.buffer, 'GLB bufferView buffer 无效') !== 0) fail('GLB bufferView 必须引用内嵌二进制缓冲');
    const offset = view.byteOffset === undefined ? 0 : integer(view.byteOffset, 'GLB bufferView byteOffset 无效');
    const length = integer(view.byteLength, 'GLB bufferView byteLength 无效');
    if (!length || offset + length > binary.byteLength) fail('GLB bufferView 超出二进制块');
    if (view.byteStride !== undefined) {
      const stride = integer(view.byteStride, 'GLB bufferView byteStride 无效');
      if (stride < 4 || stride > 252) fail('GLB bufferView byteStride 不受支持');
    }
    return view;
  });
}

function validateAccessor(
  accessors: Json[],
  bufferViews: JsonObject[],
  binary: Uint8Array,
  index: number,
  label: string,
): Accessor {
  const accessor = indexedObject(accessors, index, `GLB ${label} accessor 不存在`);
  if (accessor.sparse !== undefined) fail('GLB 不支持 sparse accessor');
  const count = integer(accessor.count, `GLB ${label} accessor count 无效`);
  const componentType = integer(accessor.componentType, `GLB ${label} componentType 无效`);
  const componentLength = componentByteLengths.get(componentType);
  if (!componentLength || typeof accessor.type !== 'string') fail(`GLB ${label} accessor 格式无效`);
  const accessorType = accessor.type as string;
  const components = typeComponents.get(accessorType);
  if (!components) fail(`GLB ${label} accessor 格式无效`);
  const componentBytes = componentLength as number;
  if (accessor.bufferView === undefined) fail(`GLB ${label} accessor 必须引用 bufferView`);
  const bufferView = bufferViews[integer(accessor.bufferView, `GLB ${label} bufferView 无效`)];
  if (!bufferView) fail(`GLB ${label} bufferView 不存在`);
  const elementLength = componentBytes * (components as number);
  const stride =
    bufferView.byteStride === undefined
      ? elementLength
      : integer(bufferView.byteStride, `GLB ${label} byteStride 无效`);
  const accessorOffset =
    accessor.byteOffset === undefined ? 0 : integer(accessor.byteOffset, `GLB ${label} byteOffset 无效`);
  const viewOffset =
    bufferView.byteOffset === undefined ? 0 : integer(bufferView.byteOffset, 'GLB bufferView byteOffset 无效');
  const viewLength = integer(bufferView.byteLength, 'GLB bufferView byteLength 无效');
  if (
    !count ||
    stride < elementLength ||
    stride % componentBytes ||
    accessorOffset % componentBytes ||
    accessorOffset + (count - 1) * stride + elementLength > viewLength
  )
    fail(`GLB ${label} accessor 超出 bufferView 或布局不受支持`);
  const start = viewOffset + accessorOffset;
  if (start + (count - 1) * stride + elementLength > binary.byteLength) fail(`GLB ${label} accessor 超出二进制块`);
  return { count, componentType, type: accessorType, start, stride };
}

function validateMesh(
  mesh: Json,
  meshIndex: number,
  accessors: Json[],
  bufferViews: JsonObject[],
  binary: Uint8Array,
): number {
  if (!isObject(mesh)) fail('GLB mesh 格式无效');
  const meshObject = mesh as JsonObject;
  if (meshObject.weights !== undefined) fail('GLB 不支持 morph target');
  const primitives = meshObject.primitives;
  if (!Array.isArray(primitives) || !primitives.length) fail('GLB mesh 缺少 primitives');
  let triangles = 0;
  for (const primitive of primitives as Json[]) {
    if (!isObject(primitive)) fail('GLB primitive 格式无效');
    const item = primitive as JsonObject;
    if ((item.mode === undefined ? 4 : integer(item.mode, 'GLB primitive mode 无效')) !== 4)
      fail('GLB 第一阶段仅支持 TRIANGLES primitive');
    if (item.targets !== undefined) fail('GLB 不支持 morph target');
    if (!isObject(item.attributes) || item.attributes.POSITION === undefined)
      fail('GLB TRIANGLES primitive 缺少 POSITION');
    if (item.indices === undefined) fail('GLB 第一阶段仅支持带 indices 的 TRIANGLES primitive');
    const position = validateAccessor(
      accessors,
      bufferViews,
      binary,
      integer((item.attributes as JsonObject).POSITION, 'GLB POSITION accessor 无效'),
      'POSITION',
    );
    if (position.componentType !== 5126 || position.type !== 'VEC3') fail('GLB POSITION 必须是 FLOAT VEC3');
    const indexAccessor = validateAccessor(
      accessors,
      bufferViews,
      binary,
      integer(item.indices, 'GLB indices 无效'),
      'indices',
    );
    if (
      indexAccessor.type !== 'SCALAR' ||
      ![5121, 5123, 5125].includes(indexAccessor.componentType) ||
      indexAccessor.count % 3
    )
      fail('GLB indices 必须是 UNSIGNED 标量且数量为 3 的倍数');
    const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
    for (
      let offset = indexAccessor.start, count = 0;
      count < indexAccessor.count;
      offset += indexAccessor.stride, count++
    ) {
      const vertex =
        indexAccessor.componentType === 5121
          ? view.getUint8(offset)
          : indexAccessor.componentType === 5123
            ? view.getUint16(offset, true)
            : view.getUint32(offset, true);
      if (vertex >= position.count) fail('GLB indices 引用了不存在的 POSITION');
    }
    triangles += indexAccessor.count / 3;
    if (triangles > MAX_GLB_TRIANGLES) fail(`GLB mesh ${meshIndex} 三角形超过上限`);
  }
  return triangles;
}

function countSceneTriangles(document: JsonObject, nodes: Json[], meshTriangles: number[]): number {
  const scenes = array(document, 'scenes');
  if (scenes.length !== 1 || (document.scene !== undefined && integer(document.scene, 'GLB scene 无效') !== 0))
    fail('GLB 第一阶段仅支持一个静态 scene');
  const scene = indexedObject(scenes, 0, 'GLB scene 不存在');
  const roots = array(scene, 'nodes').map((root) => integer(root, 'GLB scene node 无效'));
  if (!roots.length || new Set(roots).size !== roots.length) fail('GLB scene 必须包含不重复的根节点');
  const parentCounts = new Uint16Array(nodes.length);
  const children = nodes.map((node) => {
    if (!isObject(node)) fail('GLB node 格式无效');
    return array(node as JsonObject, 'children').map((child) => {
      const index = integer(child, 'GLB node child 无效');
      if (index >= nodes.length || ++parentCounts[index] > 1) fail('GLB node 不能有多个父节点');
      return index;
    });
  });
  const visited = new Set<number>();
  const visiting = new Set<number>();
  let triangles = 0;
  const visit = (index: number) => {
    if (index >= nodes.length) fail('GLB scene 引用了不存在的 node');
    if (visiting.has(index)) fail('GLB node 树不能成环');
    if (visited.has(index)) return;
    visiting.add(index);
    const node = indexedObject(nodes, index, 'GLB node 不存在');
    if (node.mesh !== undefined) {
      const mesh = integer(node.mesh, 'GLB node mesh 无效');
      if (mesh >= meshTriangles.length) fail('GLB node 引用了不存在的 mesh');
      triangles += meshTriangles[mesh];
      if (triangles > MAX_GLB_TRIANGLES) fail(`GLB 场景实例三角形超过 ${MAX_GLB_TRIANGLES.toLocaleString()} 上限`);
    }
    for (const child of children[index]) visit(child);
    visiting.delete(index);
    visited.add(index);
  };
  for (const root of roots) {
    if (root >= nodes.length) fail('GLB scene 引用了不存在的 node');
    visit(root);
  }
  if (roots.some((root) => parentCounts[root])) fail('GLB scene 根节点无效');
  if (!triangles) fail('GLB scene 没有可渲染的静态 TRIANGLES');
  return triangles;
}

function readPngSize(bytes: Uint8Array): [number, number] | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function readJpegSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return [width, height];
    }
    offset += length;
  }
  return null;
}

function validateTextures(document: JsonObject, binary: Uint8Array | null): void {
  const images = array(document, 'images');
  if (!images.length) return;
  const bufferViews = array(document, 'bufferViews');
  const buffers = array(document, 'buffers');
  if (!binary || buffers.length !== 1) fail('GLB 内嵌纹理缺少二进制缓冲');
  const binaryBytes = binary as Uint8Array;
  const buffer = indexedObject(buffers, 0, 'GLB buffer 格式无效');
  if (integer(buffer.byteLength, 'GLB buffer byteLength 无效') > binaryBytes.byteLength)
    fail('GLB buffer 超出二进制块');
  for (const image of images) {
    if (!isObject(image) || image.bufferView === undefined) fail('GLB 纹理必须嵌入 bufferView');
    const imageObject = image as JsonObject;
    if (
      imageObject.mimeType !== undefined &&
      imageObject.mimeType !== 'image/png' &&
      imageObject.mimeType !== 'image/jpeg'
    )
      fail('GLB 仅支持 PNG 或 JPEG 内嵌纹理');
    const bufferView = indexedObject(
      bufferViews,
      integer(imageObject.bufferView, 'GLB image bufferView 无效'),
      'GLB image bufferView 不存在',
    );
    if (integer(bufferView.buffer, 'GLB image buffer 无效') !== 0) fail('GLB 图像必须位于内嵌二进制缓冲');
    const offset =
      bufferView.byteOffset === undefined ? 0 : integer(bufferView.byteOffset, 'GLB image byteOffset 无效');
    const length = integer(bufferView.byteLength, 'GLB image byteLength 无效');
    if (offset + length > binaryBytes.byteLength) fail('GLB 图像超出二进制块');
    const bytes = binaryBytes.subarray(offset, offset + length);
    const dimensions = readPngSize(bytes) ?? readJpegSize(bytes);
    if (!dimensions) fail('GLB 仅支持尺寸可验证的 PNG 或 JPEG 内嵌纹理');
    const [width, height] = dimensions as [number, number];
    if (
      !width ||
      !height ||
      width > MAX_GLB_TEXTURE_EDGE ||
      height > MAX_GLB_TEXTURE_EDGE ||
      width * height > MAX_GLB_TEXTURE_PIXELS
    )
      fail(`GLB 纹理解码尺寸超过 ${MAX_GLB_TEXTURE_EDGE} px / ${MAX_GLB_TEXTURE_PIXELS.toLocaleString()} 像素上限`);
  }
}

function validateBuffers(document: JsonObject, binary: Uint8Array | null): Uint8Array {
  const buffers = array(document, 'buffers');
  if (buffers.length !== 1) fail('GLB 必须包含一个内嵌二进制缓冲');
  if (!binary) fail('GLB buffer 缺少内嵌二进制 chunk');
  const buffer = indexedObject(buffers, 0, 'GLB buffer 格式无效');
  if (integer(buffer.byteLength, 'GLB buffer byteLength 无效') > (binary as Uint8Array).byteLength)
    fail('GLB buffer 超出二进制块');
  return binary as Uint8Array;
}

/** Validates a self-contained, static glTF 2.0 binary container without allocating GPU resources. */
export function validateStaticGlb(bytes: ArrayBuffer): GlbModelStats {
  if (bytes.byteLength < 20 || bytes.byteLength > MAX_GLB_BYTES)
    fail(`GLB 文件大小必须在 1 B 到 ${MAX_GLB_BYTES / 1024 / 1024} MiB 之间`);
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) fail('文件不是 GLB v2 容器');
  if (view.getUint32(8, true) !== bytes.byteLength) fail('GLB 文件长度与容器头不一致');
  let offset = 12;
  let json: Uint8Array | null = null;
  let binary: Uint8Array | null = null;
  let chunk = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail('GLB chunk 头不完整');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 || length > bytes.byteLength - offset) fail('GLB chunk 长度无效');
    const payload = new Uint8Array(bytes, offset, length);
    offset += length;
    if (chunk === 0 && type === JSON_CHUNK) json = payload;
    else if (chunk === 1 && type === BIN_CHUNK) binary = payload;
    else fail('GLB 只能包含一个 JSON chunk 和一个内嵌二进制 chunk');
    chunk++;
  }
  if (!json) fail('GLB 缺少 JSON chunk');
  const document = parseDocument(json as Uint8Array);
  const stats = validateStaticDocument(document, binary);
  validateTextures(document, binary);
  return stats;
}

export async function inspectGlbFile(file: File): Promise<GlbModelStats> {
  if (!file.name.toLowerCase().endsWith('.glb')) fail('请选择 .glb 文件');
  if (!file.size || file.size > MAX_GLB_BYTES) fail(`GLB 文件不能超过 ${MAX_GLB_BYTES / 1024 / 1024} MiB`);
  return validateStaticGlb(await file.arrayBuffer());
}
