import type { BehaviorProviderContext } from '../composition/behavior-capability-registry';

type CombatRequestResult = Readonly<{ success: true; actionId: string }> | Readonly<{ success: false; reason: string }>;

export function requestBehaviorCombat(
  port: Pick<BehaviorProviderContext, 'invoke'>,
  targetId: string,
): CombatRequestResult {
  const result = port.invoke({
    operationId: 'seedlands:request-combat',
    target: { kind: 'entity', entityId: targetId },
    input: { targetId },
  });
  if (!result.ok) return { success: false, reason: result.message };
  const receipt = result.value;
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt) ||
    !('success' in receipt) ||
    receipt.success !== true ||
    !('actionId' in receipt) ||
    typeof receipt.actionId !== 'string'
  )
    return { success: false, reason: 'combat-receipt-invalid' };
  return { success: true, actionId: receipt.actionId };
}
