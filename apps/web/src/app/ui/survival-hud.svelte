<script lang="ts">
  import type { HudState } from './ui-contracts';
  import { publicAssetUrl } from '../../client/presentation/public-asset-url';
  let {
    hud,
    damage,
  }: {
    hud: HudState;
    damage: Readonly<{ sequence: number; amount?: number }> | null;
  } = $props();
  let damaged = $state(false);
  $effect(() => {
    if (!damage) return;
    damage.sequence;
    damaged = true;
    const timer = setTimeout(() => (damaged = false), 420);
    return () => clearTimeout(timer);
  });
  const rows = $derived([
    { name: '生命', state: hud.health, icon: 'health-heart' },
    { name: '饥饿', state: hud.hunger, icon: 'hunger-drumstick' },
  ]);
</script>

<section id="survival-vitals" aria-label="生存状态" class:damaged data-damage={damage?.amount ?? 0}>
  {#each rows as row (row.name)}
    <div
      class="vital-row"
      role="meter"
      aria-label={row.name}
      aria-valuemin={0}
      aria-valuemax={row.state.max}
      aria-valuenow={row.state.value}
      title={`${row.name} ${row.state.value}/${row.state.max}`}
    >
      {#each Array.from({ length: 10 }, (_, i) => i) as i (i)}
        <span class="vital-icon" aria-hidden="true">
          <img class="vital-empty" src={publicAssetUrl(import.meta.env.BASE_URL, `assets/ui/${row.icon}.png`)} alt="" />
          <img
            class="vital-fill"
            style:clip-path={`inset(0 ${100 - Math.max(0, Math.min(1, row.state.value / 2 - i)) * 100}% 0 0)`}
            src={publicAssetUrl(import.meta.env.BASE_URL, `assets/ui/${row.icon}.png`)}
            alt=""
          />
        </span>
      {/each}
    </div>
  {/each}
</section>

<style>
  #survival-vitals.damaged .vital-row:first-child {
    animation: player-health-hit 420ms ease-out;
  }
  @keyframes player-health-hit {
    0%,
    35% {
      filter: brightness(1.9) saturate(1.8) drop-shadow(0 0 8px #ff3028);
      transform: scale(1.06);
    }
    100% {
      filter: none;
      transform: scale(1);
    }
  }
</style>
