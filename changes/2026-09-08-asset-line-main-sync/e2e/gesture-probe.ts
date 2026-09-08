import * as pc from 'playcanvas';

let release: (() => void) | undefined;
let result = { emptyFrames: 0, movingEmptyFrames: 0, settled: false };
export function begin() {
  release?.();
  result = { emptyFrames: 0, movingEmptyFrames: 0, settled: false };
  const app = pc.Application.getApplication()!;
  const held = app.root.findByName('viewmodel replaceable item')!;
  const pivot = app.root.findByName('viewmodel hand pivot')!;
  let emptiedAt = 0;
  const observe = () => {
    if (held.children.length) return;
    const now = performance.now();
    if (!emptiedAt) emptiedAt = now;
    result.emptyFrames++;
    const moving = pivot.getLocalEulerAngles().length() > 1;
    if (moving) {
      result.movingEmptyFrames++;
    }
    if (now - emptiedAt > 550 && !moving) {
      result.settled = true;
      release?.();
    }
  };
  app.on('postrender', observe);
  release = () => app.off('postrender', observe);
}
export function read() {
  return result;
}
