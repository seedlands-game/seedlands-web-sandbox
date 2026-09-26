import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TargetCard from '../../../src/app/ui/target-card.svelte';
import type { InteractionState } from '../../../src/app/ui/ui-contracts';

const interaction = (breaking: InteractionState['breaking']): InteractionState => ({
  gesture: null,
  target: { kind: 'voxel', id: '1,2,3', label: '原木', voxel: 4 },
  feedback: null,
  breaking,
  presentedEntities: [],
});

describe('目标方块卡片', () => {
  it('待机只保留无障碍目标，不遮挡普通探索画面', () => {
    const { body } = render(TargetCard, { props: { interaction: interaction(null) } });
    expect(body).toContain('id="target-card"');
    expect(body).toContain('class="sr-only"');
    expect(body).toContain('data-target="1,2,3"');
    expect(body).toContain('目标方块 原木');
  });

  it('采集中显示一次方块名与动作语义进度', () => {
    const { body } = render(TargetCard, {
      props: { interaction: interaction({ progress: 0.5, label: '原木' }) },
    });
    expect(body).toContain('id="target-card"');
    expect(body).toContain('<strong>原木</strong>');
    expect(body).toContain('<small>采集中</small>');
    expect(body).toContain('aria-label="正在采集 原木"');
  });
});
