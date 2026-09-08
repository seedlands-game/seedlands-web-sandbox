import * as pc from 'playcanvas';

export type GraphicsIdentitySnapshot = Readonly<{
  deviceType: string;
  renderer: string;
  vendor: string;
  version: string;
}>;

let cachedIdentity: GraphicsIdentitySnapshot | null = null;
let pendingFrame: number | null = null;
let armed = false;

function capture(app: pc.Application): GraphicsIdentitySnapshot | null {
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

export function armGraphicsIdentity(): void {
  releaseGraphicsIdentity();
  cachedIdentity = null;
  armed = true;
  const observeApplication = () => {
    if (!armed) return;
    const app = pc.Application.getApplication();
    const identity = app ? capture(app) : null;
    if (identity) {
      cachedIdentity = identity;
      armed = false;
      pendingFrame = null;
      return;
    }
    pendingFrame = requestAnimationFrame(observeApplication);
  };
  observeApplication();
}

export function readGraphicsIdentity(): GraphicsIdentitySnapshot | null {
  return cachedIdentity;
}

export function hasCurrentApplication(): boolean {
  return pc.Application.getApplication() !== null;
}

export function releaseGraphicsIdentity(): void {
  armed = false;
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
}
