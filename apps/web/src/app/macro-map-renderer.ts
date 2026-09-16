import { macroAt, type MacroBiome } from '@seedlands/stdlib/world/macro-world';
import type { MapLayer } from './ui/ui-contracts';

type RenderOptions = {
  seed: number;
  player: readonly [number, number];
  layer: MapLayer;
  onReady?: () => void;
};

export function renderMacroMap(canvas: HTMLCanvasElement, options: RenderOptions) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Macro 地图 Canvas 2D context 不可用。');
  const size = canvas.width;
  const image = context.createImageData(size, size);
  let active = true;
  let index = 0;
  const paint = () => {
    if (!active) return;
    const deadline = performance.now() + 4;
    while (index < size * size && performance.now() < deadline) {
      const px = index % size;
      const pz = Math.floor(index / size);
      const macro = macroAt(options.seed, (px - size / 2) * 24, (pz - size / 2) * 24);
      const [red, green, blue] = mapColor(
        macro.biome,
        macro.terrainHeight,
        macro.temperature,
        macro.humidity,
        macro.hydrology.kind,
        macro.hydrology.water,
        options.layer,
      );
      const offset = index * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = 255;
      index += 1;
    }
    context.putImageData(image, 0, 0);
    if (index < size * size) requestAnimationFrame(paint);
    else {
      paintPlayer(context, size, options.player);
      canvas.dataset.renderedLayer = options.layer;
      options.onReady?.();
    }
  };
  requestAnimationFrame(paint);
  return () => {
    active = false;
  };
}

function paintPlayer(context: CanvasRenderingContext2D, size: number, player: readonly [number, number]) {
  const x = Math.round(player[0] / 24 + size / 2);
  const z = Math.round(player[1] / 24 + size / 2);
  if (x < 0 || z < 0 || x >= size || z >= size) return;
  context.fillStyle = '#fff';
  context.fillRect(x - 1, z - 1, 3, 3);
  context.strokeStyle = '#07101a';
  context.strokeRect(x - 2, z - 2, 5, 5);
}

function mapColor(
  biome: MacroBiome,
  elevation: number,
  temperature: number,
  humidity: number,
  hydrology: string,
  water: boolean,
  layer: MapLayer,
): [number, number, number] {
  if (layer === 'biome')
    return (
      {
        plains: [86, 154, 82],
        forest: [30, 106, 55],
        mountain: [112, 118, 122],
        dry: [196, 161, 89],
        cold: [215, 231, 239],
        wet: [47, 137, 91],
      } as Record<MacroBiome, [number, number, number]>
    )[biome];
  if (layer === 'temperature')
    return [
      Math.round(52 + temperature * 203),
      Math.round(112 + (1 - temperature) * 105),
      Math.round(220 - temperature * 170),
    ];
  if (layer === 'humidity')
    return [Math.round(175 - humidity * 130), Math.round(92 + humidity * 132), Math.round(54 + humidity * 138)];
  if (layer === 'hydrology')
    return water
      ? hydrology === 'lake'
        ? [48, 131, 213]
        : [75, 177, 229]
      : hydrology !== 'dry'
        ? [53, 103, 122]
        : [32, 50, 42];
  if (water) return [56, 132, 194];
  const light = Math.round(Math.max(0, Math.min(1, (elevation - 8) / 32)) * 170 + 42);
  return [Math.round(light * 0.72), Math.round(light * 0.9), Math.round(light * 0.62)];
}
