<script lang="ts">
  import type { HudState } from './ui-contracts';
  let { navigation }: { navigation: HudState['navigation'] } = $props();
  const colors = [
    '#00000000',
    '#4389c6',
    '#73a84c',
    '#d2bc78',
    '#936c43',
    '#da663b',
    '#96918a',
    '#b29a79',
    '#b5ca89',
    '#806ca3',
    '#bd718e',
    '#799ca3',
    '#d9d1bd',
    '#5c5552',
    '#ededdf',
    '#bdc4cb',
  ];
  const clockLabel = (worldTime: number) => {
    const minutes = Math.floor((((worldTime % 24) + 24) % 24) * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };
</script>

{#if navigation}
  <aside
    id="navigation-item-hud"
    class="game-panel"
    aria-label="手持导航物品"
    data-kind={navigation.kind}
    data-item={navigation.itemId}
    data-slot={navigation.slot}
  >
    {#if navigation.kind === 'map'}
      <strong>地图</strong>
      {#if navigation.map}
        <svg
          aria-label="已探索地图"
          viewBox="-4.5 -4.5 9 9"
          role="img"
          data-map-id={navigation.map.id}
          data-pixel-count={navigation.map.pixels.length}
          data-navigation-revision={navigation.revision}
        >
          <title>已探索 {navigation.map.pixels.length} 格 · 缩放 {navigation.map.scale}</title>
          {#each navigation.map.pixels as pixel (`${pixel.x},${pixel.z}`)}
            <rect
              x={pixel.x - 0.5}
              y={pixel.z - 0.5}
              width="1"
              height="1"
              fill={colors[pixel.color]}
              data-color={pixel.color}
            />
          {/each}
        </svg>
        <small>中心 {navigation.map.center.join(', ')} · 北 ↑</small>
      {:else}<p>尚未探索</p>{/if}
      <small>右键更新已加载区域</small>
    {:else if navigation.kind === 'compass'}
      <strong>指南针</strong>
      <svg aria-label="出生点方向" viewBox="-1 -1 2 2" role="img" data-turns={navigation.turns}>
        <title>指向出生点 {navigation.target.join(', ')}</title>
        <circle r="0.85" fill="none" stroke="currentColor" stroke-width="0.07" />
        <path
          d="M -.65 0 L .65 0 L .3 -.2 M .65 0 L .3 .2"
          fill="none"
          stroke="#dc7a62"
          stroke-width="0.09"
          transform={`rotate(${navigation.turns * 360})`}
        />
      </svg>
      <small>出生点 {navigation.target.join(', ')}</small>
    {:else}
      <strong>时钟</strong>
      <svg aria-label="世界时钟" viewBox="-1 -1 2 2" role="img" data-phase={navigation.phase}>
        <title>{clockLabel(navigation.worldTime)}</title>
        <circle r="0.85" fill="none" stroke="currentColor" stroke-width="0.07" />
        <path d="M 0 0 L 0 -.65" stroke="#e1c782" stroke-width="0.1" transform={`rotate(${navigation.phase * 360})`} />
      </svg>
      <small>{clockLabel(navigation.worldTime)}</small>
    {/if}
  </aside>
{/if}

<style>
  aside {
    position: fixed;
    right: 18px;
    bottom: 94px;
    width: 136px;
    padding: 10px;
    display: grid;
    gap: 6px;
    pointer-events: none;
    color: #ede7d6;
  }
  strong {
    font-size: 13px;
  }
  small {
    font-size: 11px;
  }
  svg {
    width: 108px;
    height: 108px;
    justify-self: center;
    background: #262923;
  }
  p {
    margin: 4px 0;
    font-size: 12px;
  }
</style>
