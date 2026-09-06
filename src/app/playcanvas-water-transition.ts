import * as pc from 'playcanvas';
import type { WaterSurfaceTransitionGeometry } from './water-surface-transition';

export type PlayCanvasWaterTransition = {
  instance: pc.MeshInstance;
  setProgress: (progress: number) => void;
  destroy: () => void;
};

export type PlayCanvasWaterTransitionFactory = (
  app: pc.Application,
  geometry: WaterSurfaceTransitionGeometry,
  material: pc.Material,
  node: pc.GraphNode,
) => PlayCanvasWaterTransition;

export const createPlayCanvasWaterTransition: PlayCanvasWaterTransitionFactory = (app, geometry, material, node) => {
  const mesh = new pc.Mesh(app.graphicsDevice);
  let instance: pc.MeshInstance | null = null;
  try {
    mesh.setPositions(geometry.startPositions);
    mesh.setNormals(geometry.normals);
    mesh.setUvs(0, geometry.uvs);
    mesh.setColors32(geometry.colors);
    mesh.setIndices(geometry.indices);
    mesh.update();

    const target = new pc.MorphTarget({
      name: 'committed-water-surface',
      // PlayCanvas' declaration says ArrayBuffer, while its Morph implementation
      // indexes this value as a typed numeric array (the built-in parsers do the same).
      deltaPositions: geometry.deltaPositions as unknown as ArrayBuffer,
    });
    const morph = new pc.Morph([target], app.graphicsDevice);
    mesh.morph = morph;
    instance = new pc.MeshInstance(mesh, material, node);
    instance.drawOrder = 1000;
    instance.castShadow = false;
    instance.morphInstance = new pc.MorphInstance(morph);
    let destroyed = false;

    return {
      instance,
      setProgress: (progress) => {
        if (destroyed) return;
        instance?.morphInstance?.setWeight(0, Math.max(0, Math.min(1, progress)));
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        instance?.destroy();
        instance = null;
      },
    };
  } catch (error) {
    if (instance) instance.destroy();
    else mesh.destroy();
    throw error;
  }
};
