import * as pc from 'playcanvas';

export const celestialDirection = (worldTime: number) => {
  const angle = (((((worldTime % 24) + 24) % 24) - 6) / 24) * Math.PI * 2;
  const elevation = Math.sin(angle);
  const azimuth = ((((worldTime % 24) + 24) % 24) / 24) * Math.PI * 2 - (35 * Math.PI) / 180;
  const horizontal = Math.cos(Math.asin(Math.max(-1, Math.min(1, elevation))));
  return new pc.Vec3(Math.sin(azimuth) * horizontal, elevation, Math.cos(azimuth) * horizontal).normalize();
};

export class SkySun {
  private readonly entity: pc.Entity;
  private readonly material: pc.StandardMaterial;
  constructor(app: pc.Application) {
    this.material = new pc.StandardMaterial();
    this.material.name = 'world-space-sun';
    this.material.useLighting = false;
    this.material.emissive = new pc.Color(1, 0.72, 0.32);
    this.material.emissiveIntensity = 3;
    this.material.update();
    this.entity = new pc.Entity('World Space Sun');
    this.entity.addComponent('render', {
      type: 'sphere',
      material: this.material,
      castShadows: false,
      receiveShadows: false,
    });
    app.root.addChild(this.entity);
  }
  update(camera: pc.Entity, direction: pc.Vec3, color: pc.Color): void {
    const distance = Math.max(24, (camera.camera?.farClip ?? 120) * 0.78);
    this.entity.setPosition(camera.getPosition().clone().add(direction.clone().mulScalar(distance)));
    this.entity.setLocalScale(distance * 0.07, distance * 0.07, distance * 0.07);
    this.material.emissive.copy(color);
    this.material.update();
  }
  snapshot(camera: pc.Entity) {
    const position = this.entity.getPosition();
    const projected = camera.camera?.worldToScreen(position);
    const toSun = position.clone().sub(camera.getPosition()).normalize();
    return {
      direction: [toSun.x, toSun.y, toSun.z] as [number, number, number],
      screen: projected ? ([projected.x, projected.y] as [number, number]) : null,
      facing: camera.forward.dot(toSun) > 0,
    };
  }
  destroy(): void {
    this.entity.destroy();
    this.material.destroy();
  }
}
