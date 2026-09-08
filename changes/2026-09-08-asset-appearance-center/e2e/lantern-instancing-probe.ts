import * as pc from 'playcanvas';
import { Voxel, voxelIndex } from '../../../src/world/voxel';
import { meshChunk } from '../../../src/world/mesh';
import { batchMeshData } from '../../../src/world/mesh-batching';
import { createVoxelMaterials } from '../../../src/app/scene/voxel-materials';
import { QUALITY_PROFILES } from '../../../src/app/scene/quality-profile';
import { builtinTerrainTextures } from '../../../src/client/presentation/terrain-assets';

type Mode = 'baseline' | 'instanced';
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const compile = (data: Uint16Array) =>
  batchMeshData(Object.values(meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => 0 })));
const location = (index: number): [number, number, number] => [
  (index % 8) * 3,
  Math.floor(index / 64) * 3,
  (Math.floor(index / 8) % 8) * 3,
];
const dataFor = (count: number) => {
  const data = new Uint16Array(32 ** 3);
  for (let i = 0; i < count; i++) data[voxelIndex(...location(i))] = Voxel.Lantern;
  return data;
};
const matricesFor = (count: number) => {
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...location(i), 1], i * 16);
  return matrices;
};

async function measure(mode: Mode, count: number, offscreen: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  document.body.append(canvas);
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { deviceTypes: [pc.DEVICETYPE_WEBGL2], preserveDrawingBuffer: true },
  });
  app.scene.ambientLight = new pc.Color(0.5, 0.5, 0.5);
  const camera = new pc.Entity('camera');
  camera.addComponent('camera', { fov: 58, nearClip: 0.1, farClip: 200 });
  camera.setPosition(11, 17, 43);
  camera.lookAt(11, 4, offscreen ? 90 : 11);
  app.root.addChild(camera);
  const light = new pc.Entity('light');
  light.addComponent('light', { type: 'directional', intensity: 1.2 });
  light.setEulerAngles(40, 25, 0);
  app.root.addChild(light);
  const materials = await createVoxelMaterials(app, QUALITY_PROFILES.high, builtinTerrainTextures);
  const root = new pc.Entity('lanterns');
  app.root.addChild(root);
  let instanceBuffer: pc.VertexBuffer | undefined;
  const meshes: pc.Mesh[] = [];
  const instances: pc.MeshInstance[] = [];
  try {
    const data = dataFor(count);
    const start = performance.now();
    const parts = count === 0 ? [] : compile(mode === 'baseline' ? data : dataFor(1));
    if (mode === 'instanced' && count) {
      instanceBuffer = new pc.VertexBuffer(
        app.graphicsDevice,
        pc.VertexFormat.getDefaultInstancingFormat(app.graphicsDevice),
        count,
        { usage: pc.BUFFER_DYNAMIC, data: matricesFor(count).buffer },
      );
    }
    for (const part of parts) {
      const mesh = new pc.Mesh(app.graphicsDevice);
      mesh.setPositions(part.positions);
      mesh.setNormals(part.normals);
      mesh.setUvs(0, part.uvs);
      mesh.setColors32(part.colors);
      mesh.setIndices(part.indices);
      mesh.update();
      meshes.push(mesh);
      const node = new pc.Entity(mode);
      const instance = new pc.MeshInstance(mesh, materials.resolve(part), node);
      if (instanceBuffer) {
        instance.setInstancing(instanceBuffer, true);
        instance.instancingCount = count;
        instance.setCustomAabb(new pc.BoundingBox(new pc.Vec3(16, 16, 16), new pc.Vec3(16, 16, 16)));
      }
      instances.push(instance);
      node.addComponent('render', { meshInstances: [instance] });
      root.addChild(node);
    }
    const initializeCpuMs = performance.now() - start;
    const gpuBufferBytes =
      meshes.reduce(
        (sum, mesh) =>
          sum + mesh.vertexBuffer.numBytes + mesh.indexBuffer.reduce((n, buffer) => n + (buffer?.numBytes ?? 0), 0),
        0,
      ) + (instanceBuffer?.numBytes ?? 0);
    const triangles =
      parts.reduce((sum, part) => sum + part.indices.length / 3, 0) * (mode === 'instanced' ? count : 1);
    app.start();
    for (let i = 0; i < 8; i++) await frame();
    const intervals: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      await frame();
      intervals.push(performance.now() - t);
    }
    const drawCalls = app.stats.drawCalls.total;
    const png = count === 64 && !offscreen ? canvas.toDataURL('image/png') : undefined;
    // Measure only changed CPU preparation. GPU transfer is deferred by the renderer;
    // it is not included in this number and is not presented as edit-to-visible latency.
    const editStart = performance.now();
    if (mode === 'baseline' && count > 0) compile(dataFor(count - 1));
    else if (instanceBuffer) {
      const matrices = matricesFor(count);
      instanceBuffer.setData(matrices.buffer);
      for (const instance of instances) instance.instancingCount = Math.max(0, count - 1);
    }
    const removePrepareCpuMs = performance.now() - editStart;
    const sorted = intervals.sort((a, b) => a - b);
    return {
      mode,
      count,
      offscreen,
      initializeCpuMs,
      removePrepareCpuMs,
      gpuBufferBytes,
      triangles,
      drawCalls,
      rafP50: sorted[15],
      rafP95: sorted[28],
      png,
    };
  } finally {
    root.destroy();
    instanceBuffer?.destroy();
    materials.destroy();
    app.destroy();
    canvas.remove();
  }
}
export async function run() {
  const rows: Awaited<ReturnType<typeof measure>>[] = [];
  for (const count of [0, 1, 64, 256])
    for (const offscreen of [false, true])
      for (const mode of ['baseline', 'instanced'] as const) rows.push(await measure(mode, count, offscreen));
  return rows;
}
