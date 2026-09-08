<script lang="ts">
  import { renderMacroMap } from '../macro-map-renderer';
  import type { ShellState, UiActionPort } from './ui-contracts';
  import GameButton from './primitives/game-button.svelte';

  let { shell, actions }: { shell: ShellState; actions: UiActionPort } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let status = $state<'sampling' | 'ready'>('sampling');

  $effect(() => {
    void shell.mapRevision;
    if (!shell.mapOpen || !canvas) return;
    status = 'sampling';
    const cancel = renderMacroMap(canvas, {
      seed: shell.mapSeed,
      player: shell.mapCenter,
      layer: shell.mapLayer,
      onReady: () => (status = 'ready'),
    });
    return cancel;
  });
</script>

<section
  id="macro-map-panel"
  class="game-panel"
  aria-label="Macro 世界地图总览"
  hidden={!shell.mapOpen}
  data-status={status}
>
  <div class="map-header">
    <strong>Macro 世界总览</strong>
    <GameButton label="关闭" onclick={actions.closeMap}>关闭</GameButton>
  </div>
  <label for="map-layer">
    图层
    <select
      id="map-layer"
      value={shell.mapLayer}
      onchange={(event) => actions.setMapLayer(event.currentTarget.value as ShellState['mapLayer'])}
    >
      <option value="elevation">Elevation</option>
      <option value="biome">Biome</option>
      <option value="temperature">Temperature</option>
      <option value="humidity">Humidity</option>
      <option value="hydrology">River / Lake</option>
    </select>
  </label>
  <canvas id="macro-map" width="96" height="96" bind:this={canvas}></canvas>
  <small>以世界原点为中心的 6.1 km Macro 采样；不生成 Chunk。</small>
</section>
