import * as pc from 'playcanvas';
import type { GameplayEntity } from '../server/gameplay/entity-store';

const createMaterial = (_app: pc.Application, color: pc.Color) => {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color.clone().mulScalar(0.18);
  material.update();
  return material;
};

export class GameplayEntityPresenter {
  private readonly presented = new Map<string, pc.Entity>();
  private readonly itemMaterial: pc.StandardMaterial;
  private readonly creatureMaterial: pc.StandardMaterial;

  constructor(private readonly app: pc.Application) {
    this.itemMaterial = createMaterial(app, new pc.Color(0.72, 0.9, 0.42));
    this.creatureMaterial = createMaterial(app, new pc.Color(0.82, 0.36, 0.28));
  }

  reconcile(entities: readonly GameplayEntity[]): void {
    const current = new Set(entities.map((entity) => entity.id));
    this.presented.forEach((node, id) => {
      if (current.has(id)) return;
      node.destroy();
      this.presented.delete(id);
    });
    entities.forEach((entity) => {
      const node = this.presented.get(entity.id) ?? this.create(entity);
      node.setPosition(
        entity.position[0],
        entity.position[1] + (entity.type === 'world-item' ? 0.35 : 0),
        entity.position[2],
      );
    });
  }

  dispose(): void {
    this.presented.forEach((entity) => entity.destroy());
    this.presented.clear();
    this.itemMaterial.destroy();
    this.creatureMaterial.destroy();
  }

  private create(entity: GameplayEntity): pc.Entity {
    const node = new pc.Entity(`gameplay:${entity.id}`);
    const worldItem = entity.type === 'world-item';
    if (worldItem) {
      node.addComponent('render', { type: 'sphere', material: this.itemMaterial, castShadows: true });
      node.setLocalScale(0.52, 0.52, 0.52);
    } else {
      const body = new pc.Entity(`gameplay:${entity.id}:body`);
      body.addComponent('render', { type: 'capsule', material: this.creatureMaterial, castShadows: true });
      body.setLocalScale(0.62, 0.9, 0.62);
      const head = new pc.Entity(`gameplay:${entity.id}:head`);
      head.addComponent('render', { type: 'sphere', material: this.creatureMaterial, castShadows: true });
      head.setLocalPosition(0, 0.78, 0);
      head.setLocalScale(0.48, 0.48, 0.48);
      node.addChild(body);
      node.addChild(head);
    }
    this.app.root.addChild(node);
    this.presented.set(entity.id, node);
    return node;
  }
}
