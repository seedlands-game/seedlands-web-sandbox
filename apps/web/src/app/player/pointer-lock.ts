let requestedRelease = false;
let observedLock = false;

/** 保留主动释放的原因，直到浏览器异步通知实际到达。 */
export function releasePointerLock() {
  if (!document.pointerLockElement) return;
  requestedRelease = true;
  document.exitPointerLock();
}

export function isUserPointerUnlock() {
  const locked = Boolean(document.pointerLockElement);
  const userUnlock = observedLock && !locked && !requestedRelease;
  // 多个已排队事件可能都看到同一个最终状态，只处理真实状态转换。
  observedLock = locked;
  requestedRelease = false;
  return userUnlock;
}
