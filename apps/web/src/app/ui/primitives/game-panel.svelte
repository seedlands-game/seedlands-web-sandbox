<script lang="ts">
  let {
    id,
    label,
    role = 'region',
    kind,
    hidden = false,
    class: className = '',
    children,
  }: {
    id?: string;
    label?: string;
    role?: string;
    kind?: string;
    hidden?: boolean;
    class?: string;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<section {id} data-kind={kind} class={`game-panel ${className}`} {role} aria-label={label} {hidden}>
  {@render children?.()}
</section>
