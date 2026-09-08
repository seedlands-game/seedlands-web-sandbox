import * as pc from 'playcanvas';

export type GraphicsIdentitySnapshot = Readonly<{
  deviceType: string;
  renderer: string;
  vendor: string;
  version: string;
}>;

export function readGraphicsIdentity(): GraphicsIdentitySnapshot | null {
  const app = pc.Application.getApplication();
  if (!app) return null;
  const device = app.graphicsDevice as unknown as {
    deviceType?: string;
    gl?: WebGL2RenderingContext;
  };
  const gl = device.gl;
  if (!gl) return null;
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    deviceType: String(device.deviceType ?? 'UNAVAILABLE'),
    renderer: String(gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    vendor: String(gl.getParameter(extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
    version: String(gl.getParameter(gl.VERSION)),
  };
}
