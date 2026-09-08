<script lang="ts">
  import type { UiActionPort } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';
  import GamePanel from './primitives/game-panel.svelte';

  let { actions }: { actions: UiActionPort } = $props();
</script>

<GamePanel id="melee-showcase-guide" label="木剑动作体验场">
  <strong>木剑动作体验场</strong>
  <ol>
    <li>准星已对准中央训练目标，按住左键观察第一击斜劈。</li>
    <li>继续按住左键，第二击会沿相反方向回扫并造成 5 + 7 伤害。</li>
    <li>右侧夜行兽会在夜间近身攻击；也可点按钮立即检查 HUD、视角冲击和受击音。</li>
  </ol>
  <GameButton label="立即触发玩家受击反馈" onclick={() => void actions.triggerMeleeShowcaseDamage()}>
    测试玩家受击
  </GameButton>
  <GameButton label="重新布置体验场" onclick={() => void actions.resetMeleeShowcase()}>重新布置目标</GameButton>
</GamePanel>
