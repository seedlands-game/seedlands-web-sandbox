export type CameraDamageOffset = Readonly<{ pitch: number; yaw: number; roll: number; active: boolean }>;

const REST: CameraDamageOffset = Object.freeze({ pitch: 0, yaw: 0, roll: 0, active: false });

/** 短促的纯表现相机冲击；调用方只叠加到渲染角度，不写回玩家朝向。 */
export function playerDamageCameraOffset(elapsedSeconds: number, damage: number): CameraDamageOffset {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds >= 0.28) return REST;
  const t = elapsedSeconds / 0.28;
  const envelope = (1 - t) ** 2;
  const strength = Math.min(1.35, 0.72 + Math.max(0, Number.isFinite(damage) ? damage : 0) * 0.08);
  return {
    pitch: Math.sin(t * Math.PI * 3) * 2.8 * envelope * strength,
    yaw: Math.sin(t * Math.PI * 4 + 0.65) * 1.8 * envelope * strength,
    roll: Math.sin(t * Math.PI * 2 + 0.35) * 3.2 * envelope * strength,
    active: true,
  };
}
