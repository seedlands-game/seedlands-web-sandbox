<script lang="ts">
  import type { Asset, PixelModel, PixelTexture } from '../../client/presentation/asset-types';
  let {
    model,
    all,
    texture,
    readonly,
    onedit,
  }: {
    model: PixelModel;
    all: Asset[];
    texture?: PixelTexture;
    readonly: boolean;
    onedit: (change: (model: PixelModel) => void) => void;
  } = $props();
</script>

<label
  >关联贴图 <select
    aria-label="关联贴图"
    disabled={readonly}
    value={model.payload.textureId}
    onchange={(event) =>
      onedit((model) => {
        const next = all.find((a) => a.id === event.currentTarget.value) as PixelTexture;
        model.payload.textureId = next.id;
        model.payload.grip = [
          Math.min(model.payload.grip[0], next.payload.width),
          Math.min(model.payload.grip[1], next.payload.height),
        ];
      })}
    >{#each all.filter((a) => a.type === 'pixel-texture' && (readonly || a.source === 'user')) as t (t.id)}<option
        value={t.id}>{t.name}</option
      >{/each}</select
  ></label
>
<label
  >总厚度（像素）<input
    aria-label="模型厚度"
    type="range"
    min="1"
    max="8"
    step="1"
    disabled={readonly}
    value={model.payload.thicknessPixels}
    oninput={(event) => onedit((model) => (model.payload.thicknessPixels = Number(event.currentTarget.value)))}
  /><output>{model.payload.thicknessPixels}</output></label
>
{#each ['X', 'Y'] as axis, i (axis)}<label
    >握持点 {axis}<input
      aria-label={`握持点 ${axis}`}
      type="number"
      min="0"
      max={texture?.payload.width ?? 64}
      step="0.5"
      disabled={readonly}
      value={model.payload.grip[i]}
      onchange={(event) => {
        const value = Number(event.currentTarget.value);
        if (Number.isFinite(value))
          onedit((model) => (model.payload.grip[i] = Math.max(0, Math.min(texture?.payload.width ?? 64, value))));
      }}
    /></label
  >{/each}
