import { describe, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { createGraphicsDeviceForRenderer } from '../../apps/web/src/app/scene/scene-bootstrap';

describe('scene graphics backend', () => {
  const canvas = {} as HTMLCanvasElement;

  it('WebGL2 默认只把 WebGL2 放在请求首位', async () => {
    const device = { deviceType: pc.DEVICETYPE_WEBGL2 } as pc.GraphicsDevice;
    const create = vi.fn(async () => device);
    await expect(createGraphicsDeviceForRenderer(canvas, 'webgl2', create)).resolves.toBe(device);
    expect(create).toHaveBeenCalledWith(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2] });
  });

  it('WebGPU 请求允许定向回退 WebGL2并拒绝 Null device', async () => {
    const webgl = { deviceType: pc.DEVICETYPE_WEBGL2 } as pc.GraphicsDevice;
    const create = vi.fn(async () => webgl);
    await expect(createGraphicsDeviceForRenderer(canvas, 'webgpu', create)).resolves.toBe(webgl);
    expect(create).toHaveBeenCalledWith(canvas, {
      deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
    });

    const destroy = vi.fn();
    await expect(
      createGraphicsDeviceForRenderer(
        canvas,
        'webgpu',
        vi.fn(async () => ({ deviceType: pc.DEVICETYPE_NULL, destroy }) as unknown as pc.GraphicsDevice),
      ),
    ).rejects.toThrow(/No playable graphics device/);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
