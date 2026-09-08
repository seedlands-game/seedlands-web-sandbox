import type { Asset } from '../../client/presentation/asset-types';
import type { StoredGlb } from '../../client/presentation/glb-model';
import { deleteGlbModel, loadGlbBlob } from '../../client/persistence/glb-model-store';
import { reimportAppearanceGlb } from './appearance-center-io';

type GlbActionsConfig = {
  asset: () => Asset | undefined;
  models: () => readonly StoredGlb[];
  projectModelIds: () => readonly string[];
  bumpProjectRevision: () => void;
  refreshModels: () => Promise<void>;
  refresh: () => void;
  notify: (message: string, failed?: boolean) => void;
  message: (error: unknown) => string;
  download: (blob: Blob, name: string) => void;
  clearSelection: () => void;
  confirmDelete: (name: string) => boolean;
};

const currentModel = (asset: Asset | undefined, models: readonly StoredGlb[]): StoredGlb | null => {
  if (asset?.type !== 'glb-model') return null;
  return models.find((model) => model.id === asset.id) ?? null;
};

export function createAppearanceGlbActions(config: GlbActionsConfig) {
  return {
    async reimport(file: File): Promise<void> {
      const model = currentModel(config.asset(), config.models());
      if (!model) return;
      try {
        const projectModel = config.projectModelIds().includes(model.id);
        await reimportAppearanceGlb(model, file);
        if (projectModel) config.bumpProjectRevision();
        await config.refreshModels();
        config.refresh();
        config.notify(`已重导入 ${file.name}，预览将使用新 revision。`);
      } catch (error) {
        config.notify(`重导入失败，原模型仍保留：${config.message(error)}`, true);
      }
    },
    async export(): Promise<void> {
      const model = currentModel(config.asset(), config.models());
      if (!model) return;
      try {
        const blob = await loadGlbBlob(model.id);
        config.download(blob, model.name.endsWith('.glb') ? model.name : `${model.name}.glb`);
        config.notify(`已导出原始 GLB（${(blob.size / 1024).toFixed(1)} KiB）。`);
      } catch (error) {
        config.notify(`GLB 导出失败：${config.message(error)}`, true);
      }
    },
    async delete(): Promise<void> {
      const model = currentModel(config.asset(), config.models());
      if (!model || !config.confirmDelete(model.name)) return;
      try {
        if ((await deleteGlbModel(model.id, model.revision)) === 'project') config.bumpProjectRevision();
        await config.refreshModels();
        config.clearSelection();
        config.refresh();
        config.notify('模型已删除。');
      } catch (error) {
        config.notify(`删除模型失败：${config.message(error)}`, true);
      }
    },
  };
}
