<script lang="ts">
  let {
    id,
    label,
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    maxlength,
    oninput,
  }: {
    id: string;
    label: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    maxlength?: number;
    oninput?: (event: Event) => void;
  } = $props();
</script>

<label for={id}>
  {label}
  <input {id} bind:value {placeholder} {disabled} {maxlength} {oninput} />
</label>
