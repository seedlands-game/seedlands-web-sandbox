import * as pc from 'playcanvas';
import type { CollisionDebugBatch } from '../client/collision-debug-projection';

/**
 * A single transient debug mesh. The Immediate layer is present on the player camera but excluded
 * from the planar reflection camera, so physics diagnostics cannot contaminate water reflections.
 */
export class CollisionDebugRenderer {
  private entity: pc.Entity | null = null;
  private mesh: pc.Mesh | null = null;
  private material: pc.StandardMaterial | null = null;
  private instance: pc.MeshInstance | null = null;
  private enabled = false;
  private disposed = false;
  private vertexCapacity = 0;

  constructor(private readonly app: pc.Application) {}

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.releaseResources();
  }

  update(batch: CollisionDebugBatch): void {
    if (!this.enabled || this.disposed) return;
    this.ensureResources();
    if (!this.mesh || !this.instance) return;
    const vertexCount = batch.positions.length / 3;
    this.vertexCapacity = Math.max(this.vertexCapacity, vertexCount);
    this.mesh.clear(true, false, this.vertexCapacity);
    this.mesh.setPositions(batch.positions, 3, vertexCount);
    this.mesh.setColors(batch.colors, 3, vertexCount);
    this.mesh.update(pc.PRIMITIVE_LINES);
    this.instance.visible = vertexCount > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.releaseResources();
  }

  private ensureResources(): void {
    if (this.entity || this.disposed) return;
    const entity = new pc.Entity('Collision Debug');
    const material = new pc.StandardMaterial();
    material.name = 'collision-debug-lines';
    material.diffuseVertexColor = true;
    material.emissiveVertexColor = true;
    material.useLighting = false;
    material.emissive = pc.Color.WHITE;
    material.depthWrite = false;
    material.update();

    const mesh = new pc.Mesh(this.app.graphicsDevice);
    const instance = new pc.MeshInstance(mesh, material, entity);
    instance.castShadow = false;
    instance.receiveShadow = false;
    entity.addComponent('render');
    entity.render!.meshInstances = [instance];
    entity.render!.layers = [pc.LAYERID_IMMEDIATE];
    this.app.root.addChild(entity);

    this.entity = entity;
    this.material = material;
    this.mesh = mesh;
    this.instance = instance;
  }

  private releaseResources(): void {
    this.instance = null;
    this.entity?.destroy();
    this.mesh?.destroy();
    this.material?.destroy();
    this.entity = null;
    this.mesh = null;
    this.material = null;
    this.vertexCapacity = 0;
  }
}
