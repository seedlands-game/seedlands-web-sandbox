import type { Page, WebSocket as PlaywrightWebSocket } from '@playwright/test';
import type { RemotePlayableEvidence } from '../../../apps/web/src/app/world/remote-playable-evidence';
import { driveSettledKeyboardPulse } from './settled-keyboard-pulse';

type AttemptSummary = Readonly<{
  attempt: number;
  distance: number;
  key: string;
  movementSequence: number;
  neutralSequence: number;
  correctionPhysicsTick: number;
  correctionPosition: readonly [number, number, number];
}>;

export async function alignWithAimedColumn(
  options: Readonly<{
    page: Page;
    socket: PlaywrightWebSocket;
    nodeUrl: string;
    evidence(page: Page): Promise<RemotePlayableEvidence>;
  }>,
): Promise<void> {
  const attempts: AttemptSummary[] = [];
  const closed = new AbortController();
  const onPageClose = () => closed.abort();
  options.page.on('close', onPageClose);
  try {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const current = await options.evidence(options.page);
      if (!current.aimedVoxel) throw new Error('脚下目标在移动对齐期间丢失。');
      const dx = current.aimedVoxel[0] + 0.5 - current.authoritativePlayer[0];
      const dz = current.aimedVoxel[2] + 0.5 - current.authoritativePlayer[2];
      const distance = Math.hypot(dx, dz);
      if (distance < 0.25) return;
      const yaw = (current.viewAngles[0] * Math.PI) / 180;
      const forwardVector = { moveX: -Math.sin(yaw), moveZ: -Math.cos(yaw) };
      const rightVector = { moveX: Math.cos(yaw), moveZ: -Math.sin(yaw) };
      const forward = dx * forwardVector.moveX + dz * forwardVector.moveZ;
      const right = dx * rightVector.moveX + dz * rightVector.moveZ;
      const key =
        Math.abs(forward) >= Math.abs(right) ? (forward >= 0 ? 'KeyW' : 'KeyS') : right >= 0 ? 'KeyD' : 'KeyA';
      const selectedVector = key === 'KeyW' || key === 'KeyS' ? forwardVector : rightVector;
      const direction = key === 'KeyS' || key === 'KeyA' ? -1 : 1;
      const settled = await driveSettledKeyboardPulse({
        socket: options.socket,
        expectedUrl: options.nodeUrl,
        keyboard: options.page.keyboard,
        keys: [key],
        expectedMovement: {
          moveX: selectedVector.moveX * direction,
          moveZ: selectedVector.moveZ * direction,
        },
        signal: closed.signal,
        readEvidence: async () => {
          const observed = await options.evidence(options.page);
          return { physicsTick: observed.physicsTick, authoritativePlayer: observed.authoritativePlayer };
        },
      });
      attempts.push({
        attempt: attempt + 1,
        distance,
        key,
        movementSequence: settled.movementSequence,
        neutralSequence: settled.neutralSequence,
        correctionPhysicsTick: settled.correction.physicsTick,
        correctionPosition: settled.correction.position,
      });
    }
  } finally {
    options.page.off('close', onPageClose);
  }
  throw new Error(`真实 WASD 未能将玩家对齐到脚下目标格：${JSON.stringify(attempts)}`);
}
