<script lang="ts">
  import GameButton from './primitives/game-button.svelte';
  import ItemIcon from './primitives/item-icon.svelte';
  import type { GameplayItemPresentation } from './gameplay-ui-projector';
  import type { TransportStorageUiPresentation } from './transport-storage-ui-projector';
  import type { ShellState, UiActionPort } from './ui-contracts';
  import type { TransportStorageUiCommand } from '../gameplay/browser-transport-storage';
  let {
    site,
    inventory,
    actions,
  }: {
    site: TransportStorageUiPresentation;
    inventory: ShellState['gameplay']['inventory'];
    actions: UiActionPort;
  } = $props();
  let selected = $state<{ side: 'actor' | 'cargo'; slot: number; count: number; identity: string } | null>(null);
  let pending = $state(false);
  $effect(() => {
    if (selected && selected.identity !== site.identity) selected = null;
  });
  const label = (item: GameplayItemPresentation) => `${item.name}${item.count ? ` × ${item.count}` : ''}`;
  async function send(command: TransportStorageUiCommand) {
    if (pending || !actions.transportStorage) return;
    pending = true;
    try {
      await actions.transportStorage({
        command,
        expectedInventoryRevision: site.inventoryRevision,
        expectedTransportRevision: site.revision,
      });
      selected = null;
    } finally {
      pending = false;
    }
  }
  async function choose(side: 'actor' | 'cargo', item: GameplayItemPresentation, shift: boolean) {
    if (pending) return;
    if (!selected || selected.side === side) {
      selected =
        item.itemId && item.count > 0 ? { side, slot: item.slot, count: item.count, identity: site.identity } : null;
      return;
    }
    if (selected.identity !== site.identity) {
      selected = null;
      return;
    }
    const source = selected;
    await send({
      kind: 'transfer',
      direction: source.side === 'actor' ? 'deposit' : 'withdraw',
      actorSlot: side === 'actor' ? item.slot : source.slot,
      transportSlot: side === 'cargo' ? item.slot : source.slot,
      count: shift ? source.count : 1,
    });
  }
</script>

<section class="storage-dialog" aria-label={site.name} aria-busy={pending}>
  <header>
    <h2>{site.name}</h2>
    <GameButton id="transport-storage-close" label="关闭载具面板" onclick={() => actions.closeInventory()}
      >关闭</GameButton
    >
  </header>
  {#if site.fuel !== null && site.fuelCapacity !== null}
    <div class="fuel-status">
      <label for="transport-fuel-level">燃料余量</label><progress
        id="transport-fuel-level"
        value={site.fuel}
        max={site.fuelCapacity}
      ></progress><span>{Math.round((site.fuel / site.fuelCapacity) * 100)}%</span>
    </div>
  {/if}
  {#if site.slots.length}
    <h3>载具货箱</h3>
    <div class="storage-grid" role="grid" aria-label="载具货箱槽位">
      {#each site.slots as item (item.slot)}
        <button
          id={`transport-cargo-slot-${item.slot}`}
          type="button"
          role="gridcell"
          aria-label={label(item)}
          aria-selected={selected?.side === 'cargo' && selected.slot === item.slot}
          disabled={pending}
          onclick={(event) => choose('cargo', item, event.shiftKey)}
          ><ItemIcon itemId={item.itemId} />{#if item.count}<span>{item.count}</span>{/if}</button
        >
      {/each}
    </div>
  {/if}
  <h3>我的背包</h3>
  <div class="storage-grid" role="grid" aria-label="背包槽位">
    {#each inventory as item (item.slot)}
      <button
        id={`transport-actor-slot-${item.slot}`}
        type="button"
        role="gridcell"
        aria-label={label(item)}
        aria-selected={selected?.side === 'actor' && selected.slot === item.slot}
        disabled={pending || (!site.slots.length && (!item.itemId || !site.fuelItemIds.includes(item.itemId)))}
        onclick={(event) =>
          site.slots.length
            ? choose('actor', item, event.shiftKey)
            : send({ kind: 'refuel', actorSlot: item.slot, count: event.shiftKey ? item.count : 1 })}
        ><ItemIcon itemId={item.itemId} />{#if item.count}<span>{item.count}</span>{/if}</button
      >
    {/each}
  </div>
  <p>
    {site.slots.length
      ? '先选择有物品的槽，再选择另一侧的目标槽。每次转移 1 个，选择目标时按住 Shift 转移整组。'
      : '点击燃料物品添加 1 个，按住 Shift 添加整组。'}
  </p>
</section>

<style>
  .storage-dialog {
    width: min(42rem, 94vw);
    max-height: 90vh;
    overflow: auto;
    padding: 1.25rem;
    background: var(--panel, #181b20);
    color: var(--text, #eee);
    border: 1px solid #687078;
    border-radius: 0.6rem;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  h2,
  h3 {
    margin: 0.5rem 0;
  }
  header h2 {
    flex: 1;
    white-space: nowrap;
  }
  header :global(#transport-storage-close) {
    width: auto;
    flex-shrink: 0;
  }
  .fuel-status {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin: 1rem 0;
  }
  progress {
    flex: 1;
  }
  .storage-grid {
    display: grid;
    grid-template-columns: repeat(9, minmax(0, 1fr));
    gap: 0.3rem;
  }
  .storage-grid button {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    min-width: 0;
    padding: 0.2rem;
    border: 1px solid #78828b;
    background: #343940;
    color: #fff;
    cursor: pointer;
  }
  .storage-grid button[aria-selected='true'] {
    outline: 3px solid #e7bd5a;
  }
  .storage-grid button:focus-visible {
    outline: 3px solid #8bd4f4;
  }
  .storage-grid button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .storage-grid button :global(img) {
    width: 80%;
    height: 80%;
    image-rendering: pixelated;
  }
  .storage-grid button span {
    position: absolute;
    right: 0.15rem;
    bottom: 0.05rem;
    font-size: 0.75rem;
    text-shadow: 1px 1px #000;
  }
  p {
    font-size: 0.85rem;
    line-height: 1.5;
  }
</style>
