import type { CharacterGoal, ControlBinding } from '@seedlands/game-core/runtime/character-control-protocol';
import type { ControllerHostMessage } from '@seedlands/cognition-protocol';
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
export function validateControllerUrl(value: string): string {
  const url = new URL(value);
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError('请输入本机 WebSocket 地址，例如 ws://127.0.0.1:8787');
  return url.href;
}
export function isCharacterGoal(value: unknown): value is CharacterGoal {
  if (!object(value)) return false;
  if (['idle', 'forage', 'return-home'].includes(String(value.kind))) return keys(value, ['kind']);
  if (value.kind === 'move-to')
    return (
      keys(value, ['kind', 'position']) &&
      Array.isArray(value.position) &&
      value.position.length === 3 &&
      value.position.every((n) => typeof n === 'number' && Number.isFinite(n))
    );
  if (value.kind !== 'follow' || !keys(value, ['kind', 'target']) || !object(value.target)) return false;
  return (
    keys(value.target, ['kind', 'ref', 'revision']) &&
    ['entity', 'poi'].includes(String(value.target.kind)) &&
    text(value.target.ref, 256) &&
    integer(value.target.revision)
  );
}
export function validateControllerHostMessage(
  value: unknown,
  binding: ControlBinding,
  lastSequence: number,
): ControllerHostMessage | null {
  if (
    !object(value) ||
    value.protocolVersion !== 1 ||
    !integer(value.sequence) ||
    (value.sequence as number) <= lastSequence
  )
    return null;
  if (value.kind === 'error') {
    return [
      'BAD_FRAME',
      'PAIRING_REJECTED',
      'ORIGIN_REJECTED',
      'BINDING_MISMATCH',
      'STALE_SEQUENCE',
      'FRAME_TOO_LARGE',
    ].includes(String(value.code)) && text(value.message, 512)
      ? (value as ControllerHostMessage)
      : null;
  }
  if (
    !object(value.binding) ||
    !Object.entries(binding).every(([key, item]) => (value.binding as Record<string, unknown>)[key] === item)
  )
    return null;
  if (value.kind === 'ready')
    return typeof value.fallbackSeconds === 'number' &&
      value.fallbackSeconds >= 60 &&
      value.fallbackSeconds <= 600 &&
      ['available', 'missing-key', 'unavailable'].includes(String(value.modelAvailability))
      ? (value as ControllerHostMessage)
      : null;
  if (value.kind === 'status') {
    if (!['ready', 'thinking', 'compressing', 'awaiting-receipt', 'fallback', 'paused'].includes(String(value.state)))
      return null;
    if (
      value.usage !== undefined &&
      (!object(value.usage) ||
        !['calls', 'inputTokens', 'cachedTokens', 'outputTokens', 'compressionCalls', 'estimatedCostUsd'].every(
          (key) =>
            typeof (value.usage as Record<string, unknown>)[key] === 'number' &&
            Number.isFinite((value.usage as Record<string, unknown>)[key]) &&
            (value.usage as Record<string, number>)[key] >= 0,
        ))
    )
      return null;
    return value as ControllerHostMessage;
  }
  if (!text(value.requestId, 256)) return null;
  if (value.kind === 'intent')
    return integer(value.observedRevision) &&
      integer(value.observedCursor) &&
      object(value.intent) &&
      keys(value.intent, ['goal', 'say']) &&
      isCharacterGoal(value.intent.goal) &&
      (value.intent.say === undefined || text(value.intent.say, 280))
      ? (value as ControllerHostMessage)
      : null;
  if (value.kind === 'memory')
    return integer(value.throughCursor) &&
      integer(value.expectedMemoryRevision) &&
      typeof value.summary === 'string' &&
      value.summary.length <= 16000
      ? (value as ControllerHostMessage)
      : null;
  return null;
}
