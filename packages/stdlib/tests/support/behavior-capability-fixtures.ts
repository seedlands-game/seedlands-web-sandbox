import type { BehaviorSkillProviderDefinition, PackDefinition } from '@seedlands/stdlib/mod-api';

export const verifiedBehaviorPack = (definition: PackDefinition) => ({
  ...definition,
  integrity: {
    algorithm: 'sha256' as const,
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

export const undeclaredOperationBehavior = (): BehaviorSkillProviderDefinition => ({
  kind: 'skill',
  id: 'example:undeclared-operation',
  version: '1.0.0',
  description: 'Negative fixture for undeclared operation dispatch.',
  arguments: {},
  requiredOperations: [],
  state: { version: '1.0.0', maximumBytes: 32 },
  start(context) {
    const result = context.invoke({
      operationId: 'example:increment-counter',
      target: { kind: 'entity', entityId: context.actor.entityId },
      input: { amount: 1 },
    });
    return result.ok ? { status: 'succeeded', phase: 'unexpected' } : { status: 'failed', reason: result.code };
  },
  continue: () => ({ status: 'failed', reason: 'unexpected-continue' }),
});
