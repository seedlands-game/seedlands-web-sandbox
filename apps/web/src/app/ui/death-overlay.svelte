<script lang="ts">
  import GameButton from './primitives/game-button.svelte';
  import GameOverlay from './primitives/game-overlay.svelte';
  import type { UiActionPort } from './ui-contracts';

  let { dead, actions }: { dead: boolean; actions: UiActionPort } = $props();
</script>

<GameOverlay id="death-overlay" label="你倒下了" open={dead}>
  <div class="death-card">
    <small>旅程尚未结束</small>
    <h2>你倒下了</h2>
    <p>背包物品已掉落在倒下的位置。复活后可以重新找回。</p>
    <GameButton label="复活" onclick={actions.respawn}>复活</GameButton>
  </div>
</GameOverlay>
