<script lang="ts">
  import { publicAssetUrl } from '../../../client/public-asset-url';
  let { itemId }: { itemId: string | null } = $props();
  const tiles: Record<string, string> = {
    'dirt-block': '100% 0%',
    'stone-block': '0% 50%',
    'wood-block': '100% 50%',
    'sand-block': '50% 50%',
  };
  const atlas = publicAssetUrl(import.meta.env.BASE_URL, 'assets/voxel-atlas.webp');
</script>

{#if itemId && tiles[itemId]}
  <span
    class="item-icon block-icon"
    style:background-image={`url(${atlas})`}
    style:background-position={tiles[itemId]}
    aria-hidden="true"
  ></span>
{:else if itemId}
  <svg class="item-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    {#if itemId === 'wood-axe'}
      <path d="M9 28 21 5 24 7 13 30Z" fill="#876041" stroke="#c89b62" stroke-width="1" />
      <path d="m9 5 10-2 9 7-4 8-8-8-7 3Z" fill="#b99560" stroke="#e4c58d" stroke-width="1.5" />
    {:else if itemId === 'stone-pickaxe'}
      <path d="M11 29 16 7 20 8 15 30Z" fill="#906644" stroke="#d0a675" />
      <path d="m3 12 8-9 12 1 7 9-10-5-8 1Z" fill="#899aa0" stroke="#d4e2dc" stroke-width="1.5" />
    {:else if itemId === 'berry'}
      <path d="m16 11 2-8 6 1-5 5-3 6Z" fill="#80ac69" />
      <circle cx="10" cy="17" r="6" fill="#954c7a" stroke="#dba0bf" /><circle
        cx="22"
        cy="17"
        r="6"
        fill="#b15a8d"
        stroke="#eab3ca"
      /><circle cx="16" cy="25" r="5" fill="#813c75" stroke="#c68db8" />
      <path d="m8 15 2-2m10 2 2-2m-8 11 2-2" stroke="#ffe1e9" stroke-width="2" />
    {:else if itemId === 'plank'}
      <path d="m3 8 22-3 4 7-22 4Zm0 12 22-3 4 7-22 4Z" fill="#aa7950" stroke="#dfb879" stroke-width="1.5" />
      <path d="m8 11 15-2M8 23l15-2" stroke="#644736" />
    {:else if itemId.includes('lantern')}
      <path d="M12 7V4h8v3M8 10h16v17H8Z" fill="none" stroke="#b99a61" stroke-width="2" />
      <path d="M11 12h10v12H11Z" fill="#ffd98b" /><path d="M7 8h18M6 29h20" stroke="#cfaf72" stroke-width="3" />
    {:else}
      <path d="m16 3 12 13-12 13L4 16Z" fill="#7ac2c2" stroke="#dabf84" stroke-width="2" />
    {/if}
  </svg>
{/if}
