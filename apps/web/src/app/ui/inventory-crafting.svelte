<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import GameButton from './primitives/game-button.svelte';
  import GameOverlay from './primitives/game-overlay.svelte';
  import GameTextField from './primitives/game-text-field.svelte';
  import ItemIcon from './primitives/item-icon.svelte';
  import InventorySlot from './primitives/inventory-slot.svelte';
  import StationPanel from './station-panel.svelte';
  import CreativeCatalog from './creative-catalog.svelte';
  import { InventoryPointerGestures, inventorySlotKey, type InventoryUiSlot } from './inventory-pointer-gestures';
  import type { ShellState, UiActionPort, ActorMode } from './ui-contracts';

  let { gameplay, actions }: { gameplay: ShellState['gameplay']; actions: UiActionPort } = $props();
  let filter = $state('');
  let hovered = $state<InventoryUiSlot | null>(null);
  let foodSlot = $state<number | null>(null);
  let dragSlots = $state<readonly InventoryUiSlot[]>([]);
  let dragButton = $state<0 | 2>(0);
  let pointer = $state({ x: 0, y: 0 });
  let closing = $state(false);
  const cursor = $derived(gameplay.cursor ?? null);
  const usesInventoryPointer = $derived(gameplay.mode === 'survival' || Boolean(gameplay.station));
  const food = $derived(foodSlot === null ? null : gameplay.inventory[foodSlot]);
  const visibleRecipes = $derived(
    gameplay.recipes.filter((recipe) => recipe.name.toLowerCase().includes(filter.trim().toLowerCase())),
  );
  const gestures = new InventoryPointerGestures(
    () => Boolean(gameplay.cursor?.itemId),
    async (command) => {
      if (closing) return false;
      const filtered = command.kind === 'distribute' ? { ...command, slots: command.slots.filter(accepts) } : command;
      const ok = await actions.inventoryPointer(filtered);
      await tick();
      return ok;
    },
    (slots, button) => {
      dragSlots = [...slots];
      dragButton = button;
    },
  );
  const itemAt = (slot: InventoryUiSlot) =>
    slot.kind === 'inventory' ? gameplay.inventory[slot.slot] : gameplay.station?.slots[slot.slot];
  function accepts(slot: InventoryUiSlot): boolean {
    if (!cursor) return false;
    const limit = cursor.stackLimit ?? 1;
    const item = itemAt(slot);
    if (
      !item ||
      (item.itemId && (item.itemId !== cursor.itemId || item.durability?.current !== cursor.durability?.current))
    )
      return false;
    const accepted = slot.kind === 'station' ? gameplay.station?.acceptedItemIdsBySlot?.[slot.slot] : null;
    return (accepted == null || accepted.includes(cursor.itemId!)) && item.count < limit;
  }
  const previews = $derived.by(() => {
    const result = new SvelteMap<string, number>();
    if (!cursor || !dragSlots.length) return result;
    const limit = cursor.stackLimit ?? 1;
    const targets = dragSlots.filter(accepts);
    const each = dragButton === 2 ? 1 : Math.floor(cursor.count / targets.length);
    let remaining = cursor.count;
    for (const slot of targets) {
      const count = itemAt(slot)!.count;
      const moved = Math.min(each, limit - count, remaining);
      if (moved > 0) {
        result.set(inventorySlotKey(slot), count + moved);
        remaining -= moved;
      }
    }
    return result;
  });
  const cursorCount = $derived(
    cursor
      ? cursor.count -
          [...previews].reduce((sum, [key, count]) => {
            const slot = parseSlot(key)!;
            return sum + count - (itemAt(slot)?.count ?? 0);
          }, 0)
      : 0,
  );

  const contextIdentity = $derived(
    `${gameplay.inventoryOpen}:${gameplay.mode}:${gameplay.inventoryIdentity ?? ''}:${gameplay.station?.id ?? ''}`,
  );
  $effect(() => {
    // Normal inventory updates must not cancel an in-progress gesture.
    void contextIdentity;
    gestures.cancel();
    hovered = null;
    foodSlot = null;
  });
  function parseSlot(value: string | undefined): InventoryUiSlot | null {
    const [kind, index] = (value ?? '').split(':');
    return (kind === 'inventory' || kind === 'station') && /^\d+$/.test(index ?? '')
      ? { kind, slot: Number(index) }
      : null;
  }
  function slotUnderPointer(event: PointerEvent): InventoryUiSlot | null {
    return parseSlot(
      document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-inventory-address]')?.dataset
        .inventoryAddress,
    );
  }
  function press(event: PointerEvent, slot: InventoryUiSlot) {
    if (closing || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    event.stopPropagation();
    pointer = { x: event.clientX, y: event.clientY };
    hovered = slot;
    gestures.begin({ slot, button: event.button, shift: event.shiftKey, time: event.timeStamp });
  }
  function enter(slot: InventoryUiSlot) {
    hovered = slot;
    if (slot.kind === 'inventory') foodSlot = slot.slot;
    gestures.enter(slot);
  }
  function release(event: PointerEvent) {
    if (!gameplay.inventoryOpen || !usesInventoryPointer || (event.button !== 0 && event.button !== 2)) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    gestures.end(slotUnderPointer(event), !element?.closest('.inventory-dialog'));
  }
  function outsidePress(event: PointerEvent) {
    if (
      !gameplay.inventoryOpen ||
      !usesInventoryPointer ||
      closing ||
      !cursor ||
      (event.button !== 0 && event.button !== 2)
    )
      return;
    if (event.target instanceof Element && !event.target.closest('.inventory-dialog')) {
      event.preventDefault();
      gestures.command({ kind: 'drop', button: event.button });
    }
  }
  async function close() {
    if (closing) return;
    closing = true;
    gestures.cancel();
    await gestures.settled();
    await actions.closeInventory();
    closing = false;
  }
  async function mode(value: ActorMode) {
    if (closing) return;
    closing = true;
    gestures.cancel();
    await gestures.settled();
    if (!usesInventoryPointer || (await actions.inventoryPointer({ kind: 'close' }))) await actions.setActorMode(value);
    await tick();
    closing = false;
  }
  function handleKey(event: KeyboardEvent) {
    if (!gameplay.inventoryOpen) return;
    const input = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === 'Escape' || (!input && event.code === 'KeyE')) {
      event.preventDefault();
      event.stopPropagation();
      void close();
    } else if (!input && hovered && !cursor && !dragSlots.length && /^Digit[1-8]$/.test(event.code)) {
      event.preventDefault();
      event.stopPropagation();
      gestures.command({ kind: 'hotbar', slot: { ...hovered }, hotbarSlot: Number(event.code[5]) - 1 });
    }
  }
  $effect(() => {
    // Inventory keys must be handled before the world's window input listener.
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  });
</script>

<svelte:window
  onpointerup={release}
  onpointerdown={outsidePress}
  onpointermove={(event) => {
    if (gameplay.inventoryOpen) {
      pointer = { x: event.clientX, y: event.clientY };
      hovered = slotUnderPointer(event);
    }
  }}
  onpointercancel={() => gestures.cancel()}
  onblur={() => gestures.cancel()}
  oncontextmenu={(event) => {
    if (gameplay.inventoryOpen) event.preventDefault();
  }}
/>

<GameOverlay
  id="inventory-crafting"
  label={gameplay.station?.name ?? (gameplay.mode === 'creative' ? '创造内容目录' : '背包与合成')}
  open={gameplay.inventoryOpen}
>
  <div class="inventory-dialog" class:holding={Boolean(cursor)} aria-busy={closing}>
    <header>
      <div>
        <small id="actor-mode-status" role="status">{gameplay.mode === 'creative' ? '创造模式' : '生存模式'}</small>
        <h2>{gameplay.station?.name ?? (gameplay.mode === 'creative' ? '创造内容目录' : '背包')}</h2>
      </div>
      <div class="mode-actions">
        {#if gameplay.mode === 'creative'}
          <GameButton
            label={gameplay.flightEnabled ? '关闭飞行' : '开启飞行'}
            onclick={() => actions.setFlight(!gameplay.flightEnabled)}
            >{gameplay.flightEnabled ? '关闭飞行' : '开启飞行'}</GameButton
          >
          <GameButton label="切换生存模式" disabled={closing} onclick={() => mode('survival')}>切换生存</GameButton>
        {:else}<GameButton label="切换创造模式" disabled={closing} onclick={() => mode('creative')}>切换创造</GameButton
          >{/if}
        <GameButton label="关闭背包" disabled={closing} onclick={close}>关闭 <kbd>E</kbd></GameButton>
      </div>
    </header>
    {#if gameplay.mode === 'creative' && !gameplay.station}
      <CreativeCatalog {gameplay} {actions} />
    {:else}
      <div class="survival-layout" class:with-recipes={!gameplay.station}>
        <main class="inventory-main">
          {#if gameplay.station}
            <StationPanel
              station={gameplay.station}
              {cursor}
              {previews}
              onpress={press}
              onenter={enter}
              onactivate={(slot) => gestures.command({ kind: 'click', slot, button: 0 })}
              oncraft={(batch) => gestures.command({ kind: 'craft', batch })}
            />
          {:else}<div class="bag-intro">
              <h3>随身物品</h3>
              <span>整理材料，准备下一次探索</span>
            </div>{/if}
          <div role="grid" aria-label="背包槽位" class="bag-slots">
            <h3>背包</h3>
            <div class="slot-grid">
              {#each gameplay.inventory.slice(8) as item (item.slot)}
                <InventorySlot
                  {item}
                  address={{ kind: 'inventory', slot: item.slot }}
                  preview={previews.get(`inventory:${item.slot}`)}
                  previewItem={cursor}
                  onpress={press}
                  onenter={enter}
                  onactivate={(slot) => gestures.command({ kind: 'click', slot, button: 0 })}
                />
              {/each}
            </div>
            <h3 class="hotbar-label">快捷栏 <span>悬停格子按 1–8 交换</span></h3>
            <div class="slot-grid hotbar-grid">
              {#each gameplay.inventory.slice(0, 8) as item (item.slot)}
                <InventorySlot
                  {item}
                  address={{ kind: 'inventory', slot: item.slot }}
                  active={item.slot === gameplay.selectedHotbarSlot}
                  shortcut={item.slot + 1}
                  preview={previews.get(`inventory:${item.slot}`)}
                  previewItem={cursor}
                  onpress={press}
                  onenter={enter}
                  onactivate={(slot) => gestures.command({ kind: 'click', slot, button: 0 })}
                />
              {/each}
            </div>
          </div>
          <div class="item-description" role="status" aria-label="背包操作提示">
            <span
              >{cursor
                ? `手持 ${cursor.name} × ${cursor.count}`
                : hovered
                  ? (itemAt(hovered)?.name ?? '空槽位')
                  : '鼠标悬停查看物品，点击拿起'}{!cursor && hovered && itemAt(hovered)?.durability
                ? ` · 耐久 ${itemAt(hovered)!.durability!.current}/${itemAt(hovered)!.durability!.max}`
                : ''}</span
            >
            {#if food?.edible}<GameButton
                label={`食用${food.name}`}
                disabled={Boolean(cursor)}
                onclick={() => {
                  if (foodSlot !== null) actions.useInventoryItem(foodSlot);
                }}>食用</GameButton
              >{/if}
          </div>
        </main>
        {#if !gameplay.station}
          <aside class="personal-recipes" aria-label="合成配方">
            <h3>快捷合成</h3>
            <GameTextField id="recipe-filter" label="筛选配方" bind:value={filter} placeholder="搜索配方" />
            <div role="list" aria-label="合成配方">
              {#each visibleRecipes as recipe (recipe.id)}
                <div role="listitem" class:available={recipe.craftable}>
                  <strong>{recipe.name}</strong><small>{recipe.requirements} → {recipe.result}</small>
                  <GameButton
                    label={`${recipe.craftable ? '合成' : '缺少材料'} ${recipe.name}`}
                    disabled={!recipe.craftable || Boolean(cursor)}
                    onclick={() => actions.craftRecipe(recipe.id)}>{recipe.craftable ? '合成' : '缺材料'}</GameButton
                  >
                </div>
              {:else}<p>没有符合条件的配方。</p>{/each}
            </div>
          </aside>
        {/if}
      </div>
      <footer class="inventory-help">
        <span><b>左键</b> 整组拿放 / 拖拽均分</span><span><b>右键</b> 拆半 / 拖拽单放</span><span
          ><b>Shift + 点击</b> 快速转移</span
        ><span><b>双击</b> 收集同类</span><small>持物点击窗口外丢弃 · 关闭时自动归还</small>
      </footer>
    {/if}
  </div>
</GameOverlay>
{#if gameplay.inventoryOpen && usesInventoryPointer && cursor}
  <div
    class="inventory-cursor"
    data-inventory-cursor
    data-item={cursor.itemId}
    data-count={cursor.count}
    style:left={`${pointer.x + 8}px`}
    style:top={`${pointer.y + 8}px`}
    aria-hidden="true"
  >
    <ItemIcon itemId={cursor.itemId} /><strong>{cursorCount}</strong>
  </div>
{/if}

<style>
  :global(#ui #inventory-crafting .inventory-dialog) {
    width: min(860px, calc(100vw - 32px));
    padding: 18px 22px;
  }
  :global(#ui #inventory-crafting .inventory-dialog:has(.station-panel)) {
    width: min(650px, calc(100vw - 32px));
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
  }
  header h2 {
    margin: 3px 0 0;
    font-size: 21px;
    letter-spacing: 2px;
  }
  header small {
    color: #b4a687;
    font-size: 10px;
    letter-spacing: 2px;
  }
  .mode-actions {
    display: flex;
    gap: 8px;
  }
  :global(#ui #inventory-crafting .mode-actions .game-button) {
    width: auto;
    min-height: 30px;
    padding: 5px 10px;
    font-size: 11px;
  }
  .survival-layout {
    display: grid;
    gap: 22px;
  }
  .survival-layout.with-recipes {
    grid-template-columns: minmax(0, 1fr) 200px;
  }
  .inventory-main {
    min-width: 0;
  }
  .bag-intro {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #79633f60;
    padding-bottom: 12px;
  }
  .bag-intro span {
    font-size: 10px;
    color: #a49f8e;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    color: #d9c7a4;
  }
  .bag-slots > h3 {
    margin: 14px 0 8px;
    font-size: 11px;
    color: #a89f89;
  }
  .slot-grid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 5px;
  }
  .bag-slots > .hotbar-label {
    margin-top: 17px;
    display: flex;
    justify-content: space-between;
  }
  .hotbar-label span {
    font-size: 10px;
    color: #8b9184;
  }
  .item-description {
    height: 31px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    color: #c7d1b7;
    font-size: 11px;
  }
  .item-description :global(.game-button) {
    width: auto;
    min-height: 25px;
    padding: 3px 10px;
    font-size: 10px;
  }
  .personal-recipes {
    border-left: 1px solid #79633f60;
    padding-left: 18px;
  }
  .personal-recipes h3 {
    margin-bottom: 12px;
  }
  .personal-recipes :global(input) {
    width: 100%;
    box-sizing: border-box;
  }
  .personal-recipes [role='list'] {
    max-height: 267px;
    overflow: auto;
    margin-top: 10px;
  }
  .personal-recipes [role='listitem'] {
    padding: 9px 0;
    border-bottom: 1px solid #ffffff10;
    display: grid;
    gap: 6px;
  }
  .personal-recipes strong {
    font-size: 12px;
  }
  .personal-recipes small {
    font-size: 10px;
    color: #a9a794;
  }
  .personal-recipes :global(.game-button) {
    width: 100%;
    padding: 4px;
    min-height: 25px;
    font-size: 11px;
  }
  .inventory-help {
    margin-top: 10px;
    padding-top: 13px;
    border-top: 1px solid #79633f60;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    font-size: 10px;
    color: #aaa38f;
  }
  .inventory-help b {
    font-weight: 500;
    color: #e0d4b8;
  }
  .inventory-help small {
    flex-basis: 100%;
    color: #898f82;
    font-size: 9px;
  }
  .inventory-cursor {
    position: fixed;
    z-index: 10000;
    width: 40px;
    height: 40px;
    pointer-events: none;
  }
  .inventory-cursor :global(.item-icon) {
    width: 38px;
    height: 38px;
    image-rendering: pixelated;
    filter: drop-shadow(2px 3px 1px #000b);
  }
  .inventory-cursor strong {
    position: absolute;
    right: 0;
    bottom: -2px;
    color: #fff0ca;
    font: 700 14px monospace;
    text-shadow: 1px 2px 0 #000;
  }
  @media (max-width: 720px) {
    .survival-layout.with-recipes {
      grid-template-columns: 1fr;
    }
    .personal-recipes {
      border: 0;
      padding: 0;
    }
    .personal-recipes [role='list'] {
      max-height: 120px;
    }
  }
</style>
