<script lang="ts">
  let {
    id,
    label,
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    maxlength,
    type = 'text',
    oninput,
  }: {
    id: string;
    label: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    maxlength?: number;
    type?: 'text' | 'password';
    oninput?: (event: Event) => void;
  } = $props();
</script>

<label for={id}>
  {label}
  <input {id} {type} bind:value {placeholder} {disabled} {maxlength} {oninput} />
</label>
