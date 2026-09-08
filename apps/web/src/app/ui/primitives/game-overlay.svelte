<script lang="ts">
  let {
    id,
    label,
    open,
    onkeydown,
    children,
  }: {
    id: string;
    label: string;
    open: boolean;
    onkeydown?: (event: KeyboardEvent) => void;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<dialog {id} class="game-overlay game-panel" aria-label={label} {open} hidden={!open} {onkeydown}>
  {@render children?.()}
</dialog>
