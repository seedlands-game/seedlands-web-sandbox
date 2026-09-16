import { describe, expect, it } from 'vitest';
import { AppearanceEditor } from '../../../src/app/asset-workbench/appearance-editor';
import { builtinAssets } from '../../../src/client/presentation/asset-catalog';
import {
  resolveAppearanceAssets,
  validateAppearanceProject,
} from '../../../src/client/presentation/appearance-project';

describe('外观编辑历史和引用', () => {
  it('专用材质同时复制像素源，撤销/重做不会修改共享来源', () => {
    const editor = new AppearanceEditor();
    const model = builtinAssets.find((asset) => asset.type === 'builtin-actor-model')!;
    const original = builtinAssets.find((asset) => asset.id === model.payload.materialIds[0])!;
    if (original.type !== 'material') throw new Error('Missing material fixture');
    const before = JSON.stringify(builtinAssets);
    editor.makeMaterialPrivate(model.id, original);
    const privateMaterial = editor.materialSource(model.id, original);
    expect(privateMaterial.id).not.toBe(original.id);
    expect(privateMaterial.payload.textureId).not.toBe(original.payload.textureId);
    expect(editor.users(privateMaterial.payload.textureId).map((asset) => asset.id)).toContain(model.id);
    expect(editor.dirty).toBe(true);
    validateAppearanceProject(editor.project);
    editor.undo();
    expect(editor.dirty).toBe(false);
    editor.redo();
    expect(editor.materialSource(model.id, original).id).toBe(privateMaterial.id);
    expect(JSON.stringify(builtinAssets)).toBe(before);
  });
  it('像素编辑使旧缩略图失效，保存标记与撤销历史独立', () => {
    const editor = new AppearanceEditor();
    const texture = builtinAssets.find((asset) => asset.type === 'pixel-texture')!;
    editor.project.thumbnails = { 'builtin:model:lantern': 'data:image/png;base64,AAAA' };
    editor.markSaved();
    editor.checkpoint();
    editor.paint(texture, 0, 0, 1);
    expect(editor.project.thumbnails).toEqual({});
    editor.markSaved();
    expect(editor.dirty).toBe(false);
    editor.undo();
    expect(editor.dirty).toBe(true);
    expect(editor.project.thumbnails).toHaveProperty('builtin:model:lantern');
    expect(resolveAppearanceAssets(editor.project).find((asset) => asset.id === texture.id)).toEqual(texture);
  });
});
