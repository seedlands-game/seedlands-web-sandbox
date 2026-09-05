<script lang="ts">
  import type { HudState } from './ui-contracts';
  import { publicAssetUrl } from '../../client/public-asset-url';
  let { hud }: { hud: HudState } = $props();
  const rows = $derived([
    { name: '生命', state: hud.health, icon: 'health-heart' },
    { name: '饥饿', state: hud.hunger, icon: 'hunger-drumstick' },
  ]);
</script>

<section id="survival-vitals" aria-label="生存状态">
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
