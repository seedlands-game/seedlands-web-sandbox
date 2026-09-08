import { describe, expect, it } from 'vitest';
import { EditorState } from '../../apps/web/src/app/asset-workbench/editor-state';

describe('资产草稿的关系与历史', () => {
  it('复制隔离内置源、阻止依赖删除、支持整体撤销与恢复', () => {
    const editor = new EditorState();
    const original = JSON.stringify(editor.selected);
    editor.copy();
    expect(editor.assets).toHaveLength(2);
    const model = editor.selected!;
    expect(model.type).toBe('extruded-pixel-model');
    editor.selectedId = editor.assets.find((a) => a.type === 'pixel-texture')!.id;
    expect(() => editor.deleteSelected()).toThrow('仍被引用');
    editor.selectedId = model.id;
    editor.deleteSelected();
    expect(editor.assets).toHaveLength(1);
    editor.undo();
    expect(editor.assets).toHaveLength(2);
    editor.redo();
    expect(editor.assets).toHaveLength(1);
    expect(JSON.stringify(editor.all.find((a) => a.id === 'builtin:model:stone-pickaxe'))).toBe(original);
  });
  it('异步保存的旧快照不能把后续编辑误标为已保存', () => {
    const editor = new EditorState();
    editor.copy();
    const saved = structuredClone(editor.assets);
    editor.assets[0].name = '新名字';
    editor.markSaved(saved);
    expect(editor.dirty).toBe(true);
    editor.markSaved(editor.assets);
    expect(editor.dirty).toBe(false);
  });
});
