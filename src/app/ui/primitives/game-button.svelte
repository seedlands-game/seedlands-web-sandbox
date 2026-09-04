<script lang="ts">
  let {
    id,
    label,
    disabled = false,
    pressed,
    class: className = '',
    onclick,
    children,
  }: {
    id?: string;
    label: string;
    disabled?: boolean;
    pressed?: boolean;
    class?: string;
    onclick?: (event: MouseEvent) => void;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<button {id} type="button" class={className} aria-label={label} aria-pressed={pressed} {disabled} {onclick}>
  {@render children?.()}
</button>
