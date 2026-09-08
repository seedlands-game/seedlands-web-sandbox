<script lang="ts">
  import type { PixelTexture } from '../../client/presentation/asset-types';
  import { pixelCanvas } from '../gameplay/asset-image';
  let {
    texture,
    revision,
    readonly = false,
    color,
    onbegin,
    onpaint,
  }: {
    texture: PixelTexture;
    revision: number;
    readonly?: boolean;
    color: number;
    onbegin: () => void;
    onpaint: (x: number, y: number) => void;
  } = $props();
  let canvas: HTMLCanvasElement;
  let drawing = false;
  let cursor = $state([0, 0]);
  $effect(() => {
    revision;
    if (canvas) {
      canvas.width = texture.payload.width;
      canvas.height = texture.payload.height;
      canvas.getContext('2d')?.drawImage(pixelCanvas(texture), 0, 0);
    }
  });
  function paint(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        texture.payload.width - 1,
        Math.floor(((event.clientX - rect.left) / rect.width) * texture.payload.width),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        texture.payload.height - 1,
        Math.floor(((event.clientY - rect.top) / rect.height) * texture.payload.height),
      ),
    );
    cursor = [x, y];
    if (drawing && !readonly) onpaint(x, y);
  }
</script>

<div class="pixel-stage">
  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label="像素画布，方向键移动，空格绘制"
    onpointerdown={(event) => {
      if (readonly) return;
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      onbegin();
      paint(event);
    }}
    onpointermove={paint}
    onpointerup={() => (drawing = false)}
    onpointercancel={() => (drawing = false)}
    onkeydown={(event) => {
      if (readonly) return;
      const [x, y] = cursor;
      if (event.key.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
      if (event.key === 'ArrowRight') cursor = [Math.min(texture.payload.width - 1, x + 1), y];
      if (event.key === 'ArrowLeft') cursor = [Math.max(0, x - 1), y];
      if (event.key === 'ArrowDown') cursor = [x, Math.min(texture.payload.height - 1, y + 1)];
      if (event.key === 'ArrowUp') cursor = [x, Math.max(0, y - 1)];
      if (event.code === 'Space') {
        onbegin();
        onpaint(x, y);
      }
    }}
  ></canvas>
</div>
<div class="canvas-caption">
  <span
    >{texture.payload.width} × {texture.payload.height} · {readonly
      ? '只读原图'
      : color === 0
        ? '橡皮'
        : '像素画笔'}</span
  ><span>坐标 {cursor[0]}, {cursor[1]}</span>
</div>

<style>
  .pixel-stage {
    display: grid;
    place-items: center;
    min-height: 280px;
    padding: 24px;
    background: #101718;
    border: 1px solid #34403b;
    border-radius: 10px;
  }
  canvas {
    width: min(100%, 384px);
    aspect-ratio: 1;
    image-rendering: pixelated;
    touch-action: none;
    cursor: crosshair;
    background: conic-gradient(#293432 25%, #1d2827 0 50%, #293432 0 75%, #1d2827 0) 0 0 / 24px 24px;
  }
  canvas:focus-visible {
    outline: 2px solid #d9ba76;
    outline-offset: 5px;
  }
  .canvas-caption {
    display: flex;
    justify-content: space-between;
    margin: 12px 0;
    color: #a6b6ac;
    font-size: 11px;
  }
  @media (min-width: 851px) {
    .pixel-stage {
      min-height: 0;
      padding: 16px;
    }
    canvas {
      width: min(100%, clamp(192px, calc(100dvh - 500px), 384px));
    }
  }
</style>
