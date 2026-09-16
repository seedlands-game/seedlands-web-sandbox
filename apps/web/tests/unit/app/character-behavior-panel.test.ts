import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import { createLifeBehavior } from '@seedlands/stdlib/runtime/character-control-protocol';
import type { CharacterBehaviorState } from '@seedlands/stdlib/runtime/behavior-control-protocol';
import CharacterBehaviorPanel from '../../../src/app/ui/character-behavior-panel.svelte';

it('distinguishes a failed milestone provider from an unmet goal and escapes its diagnostic', () => {
  const policy = createLifeBehavior({ homePosition: [1, 2, 3], patrolPositions: [[2, 2, 3]] });
  const milestone = policy.goal.milestones![0];
  const failure = 'condition-provider-failed: <script>alert(1)</script>';
  const behavior: CharacterBehaviorState = {
    ...policy,
    revision: 1,
    runtime: {
      cycle: 1,
      activeNodeIds: [],
      skills: [],
      monitors: [],
      milestones: [{ id: milestone.id, satisfied: false, failure }],
    },
  };
  const html = render(CharacterBehaviorPanel, { props: { behavior } }).body;
  expect(html).toContain('条件计算失败');
  expect(html).toContain('condition-provider-failed:');
  expect(html).toContain('&lt;script>');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain(milestone.description);
});
