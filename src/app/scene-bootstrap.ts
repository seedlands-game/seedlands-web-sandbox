import * as pc from 'playcanvas';

export function createSceneApplication(canvas: HTMLCanvasElement) {
  const app = new pc.Application(canvas, {
    mouse: new pc.Mouse(canvas),
    keyboard: new pc.Keyboard(window),
    graphicsDeviceOptions: { alpha: true },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.start();
  return app;
}

export function createSun(app: pc.Application, castShadows: boolean) {
  const light = new pc.Entity('Sun');
  light.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.9, 0.72),
    intensity: 1,
    castShadows,
    shadowResolution: 512,
  });
  app.root.addChild(light);
  return light;
}

export function createCamera(app: pc.Application, farClip: number) {
  const camera = new pc.Entity('Player');
  camera.addComponent('camera', {
    clearColor: new pc.Color(0, 0, 0, 0),
    fov: 72,
    nearClip: 0.05,
    farClip,
  });
  app.root.addChild(camera);
  return camera;
}
