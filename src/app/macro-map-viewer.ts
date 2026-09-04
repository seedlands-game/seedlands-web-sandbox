import { macroAt, type MacroBiome } from '../world/macro-world';
import type { AppElements } from './app-elements';

type MapLayer = 'elevation' | 'biome' | 'temperature' | 'humidity' | 'hydrology';

export class MacroMapViewer {
  private readonly context: CanvasRenderingContext2D;
  private seed = 0;
  private renderId = 0;
  private active = false;
  private player: readonly [number, number] = [0, 0];

  constructor(private readonly elements: Pick<AppElements, 'mapCanvas' | 'mapLayer' | 'mapPanel'>) {
    const context = elements.mapCanvas.getContext('2d');
    if (!context) throw new Error('Macro 地图 Canvas 2D context 不可用。');
    this.context = context;
    elements.mapLayer.onchange = () => this.active && this.render();
  }

  open(seed: number, player: readonly [number, number]) {
    this.seed = seed;
    this.player = player;
    this.active = true;
    this.elements.mapPanel.hidden = false;
    this.render();
  }

  close() {
    this.active = false;
    this.renderId += 1;
    this.elements.mapPanel.hidden = true;
  }

  get isOpen() {
    return this.active;
  }

  private render() {
    const id = ++this.renderId;
    const size = this.elements.mapCanvas.width;
    const image = this.context.createImageData(size, size);
    this.elements.mapPanel.dataset.status = 'sampling';
    const layer = this.elements.mapLayer.value as MapLayer;
    let index = 0;
    const paint = () => {
      if (!this.active || this.renderId !== id) return;
      const deadline = performance.now() + 4;
      while (index < size * size && performance.now() < deadline) {
        const px = index % size,
          pz = Math.floor(index / size);
        const context = macroAt(this.seed, (px - size / 2) * 24, (pz - size / 2) * 24);
        const [r, g, b] = this.color(
          context.biome,
          context.terrainHeight,
          context.temperature,
          context.humidity,
          context.hydrology.kind,
          context.hydrology.water,
          layer,
        );
        const offset = index * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
        index += 1;
      }
      this.context.putImageData(image, 0, 0);
      if (index < size * size) requestAnimationFrame(paint);
      else {
        this.paintPlayer();
        this.elements.mapPanel.dataset.status = 'ready';
      }
    };
    requestAnimationFrame(paint);
  }

  private paintPlayer() {
    const size = this.elements.mapCanvas.width;
    const x = Math.round(this.player[0] / 24 + size / 2),
      z = Math.round(this.player[1] / 24 + size / 2);
    if (x < 0 || z < 0 || x >= size || z >= size) return;
    this.context.fillStyle = '#fff';
    this.context.fillRect(x - 1, z - 1, 3, 3);
    this.context.strokeStyle = '#07101a';
    this.context.strokeRect(x - 2, z - 2, 5, 5);
  }

  private color(
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
}
