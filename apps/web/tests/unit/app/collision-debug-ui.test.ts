import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectCollisionDebugDetails } from '../../../src/app/game-ui-projection';

describe('碰撞调试面板', () => {
  it('用明确颜色图例区分权威、预测、接触与真实球形传感器', () => {
    const text = projectCollisionDebugDetails({
      enabled: true,
      includeContacts: true,
      includeSensors: true,
      authorityTick: 40,
      predictionTick: 43,
      visibleBodyCount: 7,
      truncatedBodyCount: 2,
      contactCount: 3,
      sensorCount: 4,
    });

    expect(text).toContain('权威橙');
    expect(text).toContain('预测青');
    expect(text).toContain('接触红');
    expect(text).toContain('球形传感器');
    expect(text).toContain('权威 tick 40');
    expect(text).toContain('预测 tick 43');
  });

  it('在普通调试面板提供碰撞箱、接触和传感器的等价控件', () => {
    const source = readFileSync(new URL('../../../src/app/ui/runtime-diagnostics.svelte', import.meta.url), 'utf8');

    expect(source).toContain('id="collision-debug-toggle"');
    expect(source).toContain('id="collision-debug-contacts"');
    expect(source).toContain('id="collision-debug-sensors"');
    expect(source).toContain('actions.toggleCollisionDebug');
    expect(source).toContain('actions.setCollisionDebugContacts');
    expect(source).toContain('actions.setCollisionDebugSensors');
  });
});
