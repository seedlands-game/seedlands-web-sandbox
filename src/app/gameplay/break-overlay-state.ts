export type BreakOverlaySnapshot = Readonly<{ position: [number, number, number]; stage: number }>;

export function breakOverlayStage(progress: number): number | null {
  if (!Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(9, Math.floor(Math.max(0, progress) * 10)));
}

export class BreakOverlayState {
  private value: BreakOverlaySnapshot | null = null;

  get current(): BreakOverlaySnapshot | null {
    return this.value ? { position: [...this.value.position], stage: this.value.stage } : null;
  }

  update(position: readonly [number, number, number], progress: number): BreakOverlaySnapshot | null {
    const stage = breakOverlayStage(progress);
    if (stage === null) return this.clear();
    const sameTarget = this.value?.position.every((value, axis) => value === position[axis]) ?? false;
    this.value = {
      position: [position[0], position[1], position[2]],
      stage: sameTarget ? Math.max(this.value!.stage, stage) : stage,
    };
    return this.current;
  }

  clear(): null {
    this.value = null;
    return null;
  }
}
