import { describe, expect, it } from 'vitest';
import { readBrowserSessionConfig } from '../../../src/app/browser-session-config';

describe('浏览器会话频率与受控传输配置', () => {
  it('普通产品会话忽略频率和故障注入参数', () => {
    expect(
      readBrowserSessionConfig('?physicsHz=120&authorityLatencyMs=150&authorityDuplicate=1&authorityReorder=1'),
    ).toMatchObject({
      harnessEnabled: false,
      physicsHz: 60,
      authorityTransportFaults: {
        harnessEnabled: false,
        latencyMs: 0,
        duplicateOutbound: false,
        duplicateInbound: false,
        reorderInbound: false,
      },
    });
  });

  it.each([30, 60, 120] as const)('Harness 明确允许 %iHz 与受控传输故障', (physicsHz) => {
    expect(
      readBrowserSessionConfig(
        `?harness=1&physicsHz=${physicsHz}&authorityLatencyMs=150&authorityDuplicate=1&authorityReorder=1`,
      ),
    ).toMatchObject({
      harnessEnabled: true,
      physicsHz,
      authorityTransportFaults: {
        harnessEnabled: true,
        latencyMs: 150,
        duplicateOutbound: true,
        duplicateInbound: true,
        reorderInbound: true,
      },
    });
  });
});
