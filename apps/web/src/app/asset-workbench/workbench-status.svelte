<script lang="ts">
  let {
    status,
    failure,
    dirty,
    count,
    oncopy,
    onexport,
  }: {
    status: string;
    failure: boolean;
    dirty: boolean;
    count: number;
    oncopy: () => void;
    onexport: () => void;
  } = $props();
</script>

<footer class="status-bar" class:error={failure}>
  <span role="status" aria-label="保存状态">{status}</span>
  {#if failure && dirty}<button onclick={onexport}>导出全部草稿</button><button onclick={oncopy}>另存为副本</button
    >{/if}
  <span class="status-right">{dirty ? '未保存' : '本地工作区'} · {count} 项资产</span>
</footer>
