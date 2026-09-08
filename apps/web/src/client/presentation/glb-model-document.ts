import {
  MAX_GLB_JSON_DEPTH,
  MAX_GLB_JSON_VALUES,
  MAX_GLB_JOINTS,
  MAX_GLB_NODES,
  MAX_GLB_SKINS,
  MAX_GLB_TRIANGLES,
} from './glb-model-contract';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
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

export const fail = (message: string): never => {
  throw new Error(message);
};
export const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const array = (document: JsonObject, key: string): Json[] => {
  const value = document[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`GLB ${key} 格式无效`);
  return value as Json[];
};
export const integer = (value: Json | undefined, message: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(message);
  return value as number;
};
export const indexedObject = (values: Json[], index: number, message: string): JsonObject => {
  const value = values[index];
  if (!isObject(value)) fail(message);
  return value as JsonObject;
};

function rejectUris(value: Json): void {
  const pending: Array<Readonly<{ value: Json; depth: number }>> = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop()!;
    visited += 1;
    if (visited > MAX_GLB_JSON_VALUES) fail(`GLB JSON 结构超过 ${MAX_GLB_JSON_VALUES.toLocaleString()} 个值上限`);
    if (current.depth > MAX_GLB_JSON_DEPTH) fail(`GLB JSON 嵌套超过 ${MAX_GLB_JSON_DEPTH} 层上限`);
    if (Array.isArray(current.value)) {
      for (const nested of current.value) pending.push({ value: nested, depth: current.depth + 1 });
      continue;
    }
    if (!isObject(current.value)) continue;
    for (const [key, nested] of Object.entries(current.value)) {
      if (key === 'uri' && typeof nested === 'string') fail('GLB 不允许外部 URI');
      pending.push({ value: nested, depth: current.depth + 1 });
    }
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

export type Accessor = Readonly<{
  count: number;
  componentType: number;
  componentBytes: number;
  components: number;
  type: string;
  start: number;
  stride: number;
}>;

export type AccessorScanCache = {
  finite: Set<number>;
  indexMaximum: Map<number, number>;
  jointMaximum: Map<number, number>;
  timeDuration: Map<number, number>;
  weights: Set<number>;
};

export type GlbDocumentValidation = Readonly<{
  nodeCount: number;
  triangleCount: number;
  skinCount: number;
  animation: Readonly<{
    document: JsonObject;
    nodes: Json[];
    accessors: Json[];
    bufferViews: JsonObject[];
    binary: Uint8Array;
    scans: AccessorScanCache;
  }>;
}>;

export function validateStaticDocument(document: JsonObject, binary: Uint8Array | null): GlbDocumentValidation {
  const asset = document.asset;
  if (!isObject(asset) || typeof asset.version !== 'string' || !/^2\.\d+$/.test(asset.version))
    fail('GLB 必须是 glTF 2.0 容器');
  rejectUris(document);
  validateExtensions(document);
  const nodes = array(document, 'nodes');
  if (nodes.length > MAX_GLB_NODES) fail(`GLB 节点超过 ${MAX_GLB_NODES} 上限`);
  const binaryBytes = validateBuffers(document, binary);
  const bufferViews = validateBufferViews(document, binaryBytes);
  const accessors = array(document, 'accessors');
  const meshes = array(document, 'meshes');
  const scans: AccessorScanCache = {
    finite: new Set(),
    indexMaximum: new Map(),
    jointMaximum: new Map(),
    timeDuration: new Map(),
    weights: new Set(),
  };
  const meshTriangles = meshes.map((mesh, index) =>
    validateMesh(mesh, index, accessors, bufferViews, binaryBytes, scans),
  );
  const skinCount = validateSkins(document, nodes, meshes, accessors, bufferViews, binaryBytes, scans);
  return {
    nodeCount: nodes.length,
    triangleCount: countSceneTriangles(document, nodes, meshTriangles),
    skinCount,
    animation: { document, nodes, accessors, bufferViews, binary: binaryBytes, scans },
  };
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

export function validateAccessor(
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
  return {
    count,
    componentType,
    componentBytes,
    components: components as number,
    type: accessorType,
    start,
    stride,
  };
}

export function validateFiniteAccessor(
  accessorIndex: number,
  accessor: Accessor,
  binary: Uint8Array,
  scans: AccessorScanCache,
  label: string,
): void {
  if (scans.finite.has(accessorIndex)) return;
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  for (let element = 0; element < accessor.count; element++)
    for (let component = 0; component < accessor.components; component++)
      if (
        !Number.isFinite(
          componentValue(
            data,
            accessor.componentType,
            accessor.start + element * accessor.stride + component * accessor.componentBytes,
          ),
        )
      )
        fail(`GLB ${label} 含 NaN 或 Infinity`);
  scans.finite.add(accessorIndex);
}

function validateMesh(
  mesh: Json,
  meshIndex: number,
  accessors: Json[],
  bufferViews: JsonObject[],
  binary: Uint8Array,
  scans: AccessorScanCache,
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
    const positionIndex = integer((item.attributes as JsonObject).POSITION, 'GLB POSITION accessor 无效');
    const position = validateAccessor(accessors, bufferViews, binary, positionIndex, 'POSITION');
    if (position.componentType !== 5126 || position.type !== 'VEC3') fail('GLB POSITION 必须是 FLOAT VEC3');
    validateFiniteAccessor(positionIndex, position, binary, scans, 'POSITION');
    const indexAccessorIndex = integer(item.indices, 'GLB indices 无效');
    const indexAccessor = validateAccessor(accessors, bufferViews, binary, indexAccessorIndex, 'indices');
    if (
      indexAccessor.type !== 'SCALAR' ||
      ![5121, 5123, 5125].includes(indexAccessor.componentType) ||
      indexAccessor.count % 3
    )
      fail('GLB indices 必须是 UNSIGNED 标量且数量为 3 的倍数');
    let maximum = scans.indexMaximum.get(indexAccessorIndex);
    if (maximum === undefined) {
      maximum = 0;
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
        maximum = Math.max(maximum, vertex);
      }
      scans.indexMaximum.set(indexAccessorIndex, maximum);
    }
    if (maximum >= position.count) fail('GLB indices 引用了不存在的 POSITION');
    triangles += indexAccessor.count / 3;
    if (triangles > MAX_GLB_TRIANGLES) fail(`GLB mesh ${meshIndex} 三角形超过上限`);
  }
  return triangles;
}

export function componentValue(view: DataView, componentType: number, offset: number): number {
  if (componentType === 5120) return view.getInt8(offset);
  if (componentType === 5121) return view.getUint8(offset);
  if (componentType === 5122) return view.getInt16(offset, true);
  if (componentType === 5123) return view.getUint16(offset, true);
  if (componentType === 5125) return view.getUint32(offset, true);
  if (componentType === 5126) return view.getFloat32(offset, true);
  return fail('GLB accessor componentType 不受支持');
}

function validateWeights(
  accessorIndex: number,
  accessor: Accessor,
  binary: Uint8Array,
  scans: AccessorScanCache,
): void {
  if (scans.weights.has(accessorIndex)) return;
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    let total = 0;
    for (let component = 0; component < 4; component++) {
      const value = componentValue(
        data,
        accessor.componentType,
        accessor.start + vertex * accessor.stride + component * accessor.componentBytes,
      );
      if (!Number.isFinite(value) || value < 0) fail('GLB WEIGHTS_0 必须是有限非负数');
      total += value;
    }
    if (total <= 0) fail('GLB WEIGHTS_0 每个顶点至少需要一个正权重');
  }
  scans.weights.add(accessorIndex);
  scans.finite.add(accessorIndex);
}

function validateSkins(
  document: JsonObject,
  nodes: Json[],
  meshes: Json[],
  accessors: Json[],
  bufferViews: JsonObject[],
  binary: Uint8Array,
  scans: AccessorScanCache,
): number {
  const skins = array(document, 'skins');
  if (skins.length > MAX_GLB_SKINS) fail(`GLB 骨骼蒙皮超过 ${MAX_GLB_SKINS} 上限`);
  const nodeNames = nodes.map((node, nodeIndex) => {
    const nodeObject = isObject(node) ? node : fail('GLB node 格式无效');
    return typeof nodeObject.name === 'string' && nodeObject.name ? nodeObject.name : `node_${nodeIndex}`;
  });
  const nodeNameCounts = new Map<string, number>();
  for (const name of nodeNames) nodeNameCounts.set(name, (nodeNameCounts.get(name) ?? 0) + 1);
  const jointCounts = skins.map((skin, skinIndex) => {
    const skinObject = isObject(skin) ? skin : fail(`GLB skin ${skinIndex} 格式无效`);
    const joints = array(skinObject, 'joints').map((joint) => integer(joint, 'GLB skin joint 无效'));
    if (!joints.length || joints.length > MAX_GLB_JOINTS || new Set(joints).size !== joints.length)
      fail(`GLB skin joint 数量无效或超过 ${MAX_GLB_JOINTS} 上限`);
    for (const joint of joints) {
      indexedObject(nodes, joint, 'GLB skin joint 引用了不存在的 node');
      if (nodeNameCounts.get(nodeNames[joint]) !== 1) fail('GLB skin joint 名称必须在节点树中唯一');
    }
    if (skinObject.skeleton !== undefined)
      indexedObject(nodes, integer(skinObject.skeleton, 'GLB skin skeleton 无效'), 'GLB skin skeleton 不存在');
    if (skinObject.inverseBindMatrices !== undefined) {
      const inverseIndex = integer(skinObject.inverseBindMatrices, 'GLB skin inverseBindMatrices 无效');
      const inverse = validateAccessor(accessors, bufferViews, binary, inverseIndex, 'skin inverseBindMatrices');
      if (inverse.componentType !== 5126 || inverse.type !== 'MAT4' || inverse.count !== joints.length)
        fail('GLB skin inverseBindMatrices 必须是与 joints 等长的 FLOAT MAT4');
      validateFiniteAccessor(inverseIndex, inverse, binary, scans, 'skin inverseBindMatrices');
    }
    return joints.length;
  });

  nodes.forEach((node, nodeIndex) => {
    const nodeObject = isObject(node) ? node : fail('GLB node 格式无效');
    if (nodeObject.skin === undefined) return;
    if (nodeObject.mesh === undefined) fail('GLB 蒙皮 node 必须引用 mesh');
    const skinIndex = integer(nodeObject.skin, 'GLB node skin 无效');
    const jointCount = jointCounts[skinIndex];
    if (jointCount === undefined) fail('GLB node skin 引用了不存在的 skin');
    const meshIndex = integer(nodeObject.mesh, 'GLB 蒙皮 node mesh 无效');
    const mesh = indexedObject(meshes, meshIndex, 'GLB 蒙皮 node mesh 不存在');
    const primitives = array(mesh, 'primitives');
    for (const primitive of primitives) {
      const primitiveObject = isObject(primitive) ? primitive : fail('GLB 蒙皮 primitive 格式无效');
      const attributes = isObject(primitiveObject.attributes)
        ? primitiveObject.attributes
        : fail('GLB 蒙皮 primitive attributes 格式无效');
      if (attributes.JOINTS_0 === undefined || attributes.WEIGHTS_0 === undefined)
        fail('GLB 蒙皮 primitive 必须同时包含 JOINTS_0 和 WEIGHTS_0');
      const jointsIndex = integer(attributes.JOINTS_0, 'GLB JOINTS_0 accessor 无效');
      const joints = validateAccessor(accessors, bufferViews, binary, jointsIndex, 'JOINTS_0');
      const weightsIndex = integer(attributes.WEIGHTS_0, 'GLB WEIGHTS_0 accessor 无效');
      const weights = validateAccessor(accessors, bufferViews, binary, weightsIndex, 'WEIGHTS_0');
      const position = validateAccessor(
        accessors,
        bufferViews,
        binary,
        integer(attributes.POSITION, 'GLB POSITION accessor 无效'),
        'POSITION',
      );
      const jointsObject = indexedObject(
        accessors,
        integer(attributes.JOINTS_0, 'GLB JOINTS_0 accessor 无效'),
        'GLB JOINTS_0 accessor 不存在',
      );
      const weightsObject = indexedObject(
        accessors,
        integer(attributes.WEIGHTS_0, 'GLB WEIGHTS_0 accessor 无效'),
        'GLB WEIGHTS_0 accessor 不存在',
      );
      if (joints.type !== 'VEC4' || ![5121, 5123].includes(joints.componentType) || jointsObject.normalized === true)
        fail('GLB JOINTS_0 必须是未归一化 UNSIGNED VEC4');
      if (
        weights.type !== 'VEC4' ||
        ![5121, 5123, 5126].includes(weights.componentType) ||
        (weights.componentType !== 5126 && weightsObject.normalized !== true)
      )
        fail('GLB WEIGHTS_0 必须是 FLOAT VEC4 或归一化 UNSIGNED VEC4');
      if (joints.count !== position.count || weights.count !== position.count)
        fail('GLB 蒙皮 attributes 顶点数量不一致');
      validateWeights(weightsIndex, weights, binary, scans);
      let maximum = scans.jointMaximum.get(jointsIndex);
      if (maximum === undefined) {
        maximum = 0;
        const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
        for (let vertex = 0; vertex < joints.count; vertex++)
          for (let component = 0; component < 4; component++)
            maximum = Math.max(
              maximum,
              componentValue(
                data,
                joints.componentType,
                joints.start + vertex * joints.stride + component * joints.componentBytes,
              ),
            );
        scans.jointMaximum.set(jointsIndex, maximum);
      }
      if (maximum >= jointCount) fail(`GLB node ${nodeIndex} JOINTS_0 引用了 skin 中不存在的 joint`);
    }
  });
  return skins.length;
}

function countSceneTriangles(document: JsonObject, nodes: Json[], meshTriangles: number[]): number {
  const scenes = array(document, 'scenes');
  if (scenes.length !== 1 || (document.scene !== undefined && integer(document.scene, 'GLB scene 无效') !== 0))
    fail('GLB 第一阶段仅支持一个 scene');
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
  if (!triangles) fail('GLB scene 没有可渲染的 TRIANGLES');
  return triangles;
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
