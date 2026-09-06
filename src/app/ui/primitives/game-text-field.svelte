<script lang="ts">
  let {
    id,
    label,
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    maxlength,
  }: {
    id: string;
    label: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    maxlength?: number;
  } = $props();
</script>

<label for={id}>
  {label}
  <input {id} bind:value {placeholder} {disabled} {maxlength} />
</label>
