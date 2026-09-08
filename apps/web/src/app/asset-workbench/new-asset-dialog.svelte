<script lang="ts">
  import { onMount } from 'svelte';
  let { oncreate, onclose }: { oncreate: (size: number, model: boolean) => void; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let kind = $state('model');
  let size = $state(16);
  onMount(() => dialog.showModal());
</script>

<dialog bind:this={dialog} aria-label="新建资产" {onclose}>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      oncreate(size, kind === 'model');
    }}
  >
    <h2>新建资产</h2>
    <p>从一个空白像素源开始。</p>
    <label
      >资产类型 <select aria-label="新建资产类型" bind:value={kind}
        ><option value="model">像素挤出模型 + 贴图</option><option value="texture">像素贴图</option></select
      ></label
    >
    <label
      >画布尺寸 <select aria-label="画布尺寸" bind:value={size}
        ><option value={16}>16 × 16</option><option value={32}>32 × 32</option><option value={64}>64 × 64</option
        ></select
      ></label
    >
    <div class="dialog-actions">
      <button type="button" onclick={() => dialog.close()}>取消</button><button class="primary" type="submit"
        >创建</button
      >
    </div>
  </form>
</dialog>
