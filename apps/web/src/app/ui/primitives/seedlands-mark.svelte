<script lang="ts">
  import { publicAssetUrl } from '../../../client/presentation/public-asset-url';

  let { assetBase = import.meta.env.BASE_URL }: { assetBase?: string } = $props();
</script>

<img class="seedlands-mark" src={publicAssetUrl(assetBase, 'assets/ui/classic-crest.png')} alt="" />
