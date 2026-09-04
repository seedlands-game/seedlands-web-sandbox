<script lang="ts">
  let {
    id,
    label,
    open,
    children,
  }: {
    id: string;
    label: string;
    open: boolean;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<dialog {id} class="game-overlay game-panel" aria-label={label} {open} hidden={!open}>
  {@render children?.()}
</dialog>
