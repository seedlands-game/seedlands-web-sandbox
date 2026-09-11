import {
  definePack,
  defineBehaviorCapabilityModule,
  type BehaviorDefinition,
  type BehaviorJson,
} from '@seedlands/game-core/mod-api';

const isWood = (slot: BehaviorJson): boolean =>
  Boolean(
    slot &&
    typeof slot === 'object' &&
    !Array.isArray(slot) &&
    'itemId' in slot &&
    ['wood-block', 'seedlands:wood-block'].includes(String(slot.itemId)) &&
    'count' in slot &&
    typeof slot.count === 'number' &&
    slot.count > 0,
  );

const validState = (state: BehaviorJson): state is Readonly<{ remainingSeconds: number }> =>
  Boolean(
    state &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    Object.keys(state).length === 1 &&
    'remainingSeconds' in state &&
    typeof state.remainingSeconds === 'number' &&
    Number.isFinite(state.remainingSeconds) &&
    state.remainingSeconds >= 0 &&
    state.remainingSeconds <= 10,
  );

/** Pack-local policy recipe; neither the NPC kernel nor a host Action union knows these names. */
export const withCampWork = (life: BehaviorDefinition): BehaviorDefinition => ({
  ...life,
  root: {
    id: 'camp-and-life',
    type: 'selector',
    children: [
      {
        id: 'camp-work',
        type: 'sequence',
        children: [
          { id: 'camp-material', type: 'condition', condition: { name: 'sample:has-camp-material' } },
          { id: 'camp-prepare', type: 'action', skill: 'sample:prepare-planks', args: { seconds: 2 } },
        ],
      },
      life.root,
    ],
  },
});

export const pack = definePack({
  id: 'sample:camp-work',
  version: '1.0.0',
  kind: 'extension',
  entry: 'camp-work.mjs',
  dependencies: [{ id: 'seedlands:overworld', version: '1.0.0' }],
  modules: [
    defineBehaviorCapabilityModule({
      id: 'sample:camp-behavior',
      version: '1.0.0',
      permissions: [{ resource: 'seedlands.inventory', operations: ['execute'] }],
      capabilities: [
        {
          id: 'sample:has-camp-material',
          version: '1.0.0',
          kind: 'condition',
          description: 'Whether my own backpack contains wood that can become useful camp planks.',
          arguments: {},
          evaluate: (context) => context.actorState.inventory.slots.some(isWood),
        },
        {
          id: 'sample:prepare-planks',
          version: '1.0.0',
          kind: 'skill',
          description:
            'Spend a short time preparing, then craft my own wood into planks through normal world rules. Fails without materials.',
          arguments: { seconds: { type: 'number', required: true, minimum: 1, maximum: 10 } },
          requiredOperations: [{ operationId: 'seedlands:inventory-craft', authorization: 'self' }],
          state: { version: '1.0.0', maximumBytes: 128, validate: validState },
          start(_context, args) {
            return { status: 'running', phase: 'preparing', state: { remainingSeconds: Number(args.seconds) } };
          },
          continue(context, _args, state) {
            if (!validState(state)) return { status: 'failed', reason: 'Invalid preparation checkpoint' };
            const remainingSeconds = Math.max(0, state.remainingSeconds - context.deltaSeconds);
            if (remainingSeconds > 0) return { status: 'running', phase: 'preparing', state: { remainingSeconds } };
            const receipt = context.invoke({
              operationId: 'seedlands:inventory-craft',
              target: { kind: 'entity', entityId: context.actor.entityId },
              input: { recipeId: 'planks' },
            });
            return receipt.ok
              ? { status: 'succeeded', phase: 'planks-crafted', result: { operation: 'seedlands:inventory-craft' } }
              : { status: 'failed', phase: 'craft-rejected', reason: receipt.code };
          },
          cancel: () => ({ status: 'cancelled', phase: 'preparation-cancelled' }),
        },
      ],
    }),
  ],
});
