<script lang="ts">
  let {
    id,
    label,
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
  }: {
    id: string;
    label: string;
    value?: number;
    min?: number;
    max?: number;
    step?: number;
  } = $props();
</script>

<label for={id}>
  {label}
  <input {id} type="range" bind:value {min} {max} {step} />
</label>
