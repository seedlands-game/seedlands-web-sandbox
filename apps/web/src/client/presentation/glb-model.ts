import { validateAnimations } from './glb-model-animation-validation';
import { fail, isObject, validateStaticDocument, type Json, type JsonObject } from './glb-model-document';
import { validateTextures } from './glb-model-texture-validation';
import { MAX_GLB_BYTES, type GlbModelStats } from './glb-model-contract';

export * from './glb-model-contract';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

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

/** Validates a self-contained glTF 2.0 binary container without allocating GPU resources. */
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
  const checked = validateStaticDocument(document, binary);
  const animationClips = validateAnimations(
    checked.animation.document,
    checked.animation.nodes,
    checked.animation.accessors,
    checked.animation.bufferViews,
    checked.animation.binary,
    checked.animation.scans,
  );
  validateTextures(document, binary);
  return {
    nodeCount: checked.nodeCount,
    triangleCount: checked.triangleCount,
    skinCount: checked.skinCount,
    animationClips,
  };
}

export async function inspectGlbFile(file: File): Promise<GlbModelStats> {
  if (!file.name.toLowerCase().endsWith('.glb')) fail('请选择 .glb 文件');
  if (!file.size || file.size > MAX_GLB_BYTES) fail(`GLB 文件不能超过 ${MAX_GLB_BYTES / 1024 / 1024} MiB`);
  return validateStaticGlb(await file.arrayBuffer());
}
