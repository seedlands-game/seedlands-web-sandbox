import { MAX_GLB_IMAGES, MAX_GLB_TEXTURE_EDGE, MAX_GLB_TEXTURE_PIXELS, MAX_GLB_TEXTURES } from './glb-model-contract';
import { array, fail, indexedObject, integer, isObject, type Json, type JsonObject } from './glb-model-document';

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

export function validateTextures(document: JsonObject, binary: Uint8Array | null): void {
  const images = array(document, 'images');
  const textures = array(document, 'textures');
  if (images.length > MAX_GLB_IMAGES || textures.length > MAX_GLB_TEXTURES)
    fail(`GLB 图片或纹理数量超过 ${MAX_GLB_IMAGES} 上限`);
  if (!images.length && !textures.length) return;
  if (!images.length) fail('GLB texture 引用了不存在的 image');
  const bufferViews = array(document, 'bufferViews');
  const buffers = array(document, 'buffers');
  if (!binary || buffers.length !== 1) fail('GLB 内嵌纹理缺少二进制缓冲');
  const binaryBytes = binary as Uint8Array;
  const buffer = indexedObject(buffers, 0, 'GLB buffer 格式无效');
  if (integer(buffer.byteLength, 'GLB buffer byteLength 无效') > binaryBytes.byteLength)
    fail('GLB buffer 超出二进制块');
  let totalPixels = 0;
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
    totalPixels += width * height;
    if (
      !width ||
      !height ||
      width > MAX_GLB_TEXTURE_EDGE ||
      height > MAX_GLB_TEXTURE_EDGE ||
      totalPixels > MAX_GLB_TEXTURE_PIXELS
    )
      fail(
        `GLB 纹理解码尺寸或合计像素超过 ${MAX_GLB_TEXTURE_EDGE} px / ${MAX_GLB_TEXTURE_PIXELS.toLocaleString()} 像素上限`,
      );
  }
  textures.forEach((texture, textureIndex) => {
    const textureObject = isObject(texture) ? texture : fail(`GLB texture ${textureIndex} 格式无效`);
    if (textureObject.source === undefined) fail(`GLB texture ${textureIndex} 缺少 source`);
    indexedObject(images, integer(textureObject.source, 'GLB texture source 无效'), 'GLB texture source 不存在');
  });
  const pending: Json[] = [...array(document, 'materials')];
  while (pending.length) {
    const current = pending.pop()!;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isObject(current)) continue;
    for (const [key, value] of Object.entries(current)) {
      if (key.endsWith('Texture')) {
        const textureInfo = isObject(value) ? value : fail(`GLB material ${key} 格式无效`);
        indexedObject(
          textures,
          integer(textureInfo.index, `GLB material ${key} index 无效`),
          `GLB material ${key} 引用了不存在的 texture`,
        );
      } else pending.push(value);
    }
  }
}
