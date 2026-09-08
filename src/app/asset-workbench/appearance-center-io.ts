import type { StoredGlb } from '../../client/presentation/glb-model';
import { loadGlbBlob, reimportGlbModel } from '../../client/persistence/glb-model-store';

export async function collectAppearanceModels(models: readonly StoredGlb[]) {
  return await Promise.all(
    models.map(async (model) => ({
      id: model.id,
      name: model.name,
      revision: model.revision,
      blob: await loadGlbBlob(model.id),
    })),
  );
}

export async function readAppearanceImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('只支持 PNG 或 JPEG 图片。');
  if (file.size > 2 * 1024 * 1024) throw new Error('图片不能超过 2 MiB。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('图片边长不能超过 4096 像素。');
    if (image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) throw new Error('图片像素总数不能超过 16 Mi。');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('图片')) throw error;
    throw new Error('图片无法解码，请选择有效的 PNG 或 JPEG 文件。', { cause: error });
  } finally {
    URL.revokeObjectURL(url);
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export const reimportAppearanceGlb = (model: StoredGlb, file: File) => reimportGlbModel(model.id, file, model.revision);
