import * as pc from 'playcanvas';
import type { CollisionDebugBatch } from '../../client/presentation/collision-debug-projection';

export type CollisionDebugRendererDiagnostics = Readonly<{
  enabled: boolean;
  entityCount: number;
  meshCount: number;
  materialCount: number;
  visibleBatchCount: number;
  vertexCapacity: number;
  buildCount: number;
}>;

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
  private buildCount = 0;

  constructor(private readonly app: pc.Application) {}

  get diagnostics(): CollisionDebugRendererDiagnostics {
    return {
      enabled: this.enabled && !this.disposed,
      entityCount: this.entity ? 1 : 0,
      meshCount: this.mesh ? 1 : 0,
      materialCount: this.material ? 1 : 0,
      visibleBatchCount: this.instance?.visible ? 1 : 0,
      vertexCapacity: this.vertexCapacity,
      buildCount: this.buildCount,
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.releaseResources();
  }

  update(batch: CollisionDebugBatch): void {
    if (!this.enabled || this.disposed) return;
    if (!this.mesh) {
      if (batch.positions.length > 0) this.ensureResources(batch);
      return;
    }
    this.writeBatch(this.mesh, batch);
    if (this.instance) this.instance.visible = batch.positions.length > 0;
  }

  private writeBatch(mesh: pc.Mesh, batch: CollisionDebugBatch): void {
    const vertexCount = batch.positions.length / 3;
    this.vertexCapacity = Math.max(this.vertexCapacity, vertexCount);
    mesh.clear(true, false, this.vertexCapacity);
    mesh.setPositions(batch.positions, 3, vertexCount);
    mesh.setColors(batch.colors, 3, vertexCount);
    mesh.update(pc.PRIMITIVE_LINES);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.releaseResources();
  }

  private ensureResources(batch: CollisionDebugBatch): void {
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
    // MeshInstance captures vertex format flags at construction; upload colors first.
    this.writeBatch(mesh, batch);
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
    this.buildCount += 1;
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
