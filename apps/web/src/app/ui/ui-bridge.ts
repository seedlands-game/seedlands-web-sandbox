import type {
  DebugState,
  FeedbackTone,
  HudState,
  InteractionState,
  InteractionTarget,
  ReadonlyChannel,
  ShellState,
  UiMetrics,
} from './ui-contracts';

type TimerHandle = number;
type BridgeOptions = {
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  debugIntervalMs?: number;
};

type MutableMetrics = {
  -readonly [Key in keyof Omit<UiMetrics, 'runtime' | 'debugProjectionRate' | 'totalPublishRate'>]: UiMetrics[Key];
};

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const createChannel = <Value>(initial: Value, onPublish: (durationMs: number) => void, now: () => number) => {
  let value = initial;
  const subscribers = new Set<(next: Value) => void>();
  return {
    channel: {
      get: () => value,
      subscribe(subscriber) {
        subscribers.add(subscriber);
        subscriber(value);
        return () => subscribers.delete(subscriber);
      },
    } satisfies ReadonlyChannel<Value>,
    publish(next: Value) {
      if (equal(value, next)) return false;
      const startedAt = now();
      value = Object.freeze(next);
      subscribers.forEach((subscriber) => subscriber(value));
      onPublish(Math.max(0, now() - startedAt));
      return true;
    },
  };
};

const initialShell = (): ShellState => ({
  phase: 'boot',
  seed: '',
  quality: 'medium',
  enterLabel: '正在读取世界…',
  initializationError: '',
  mapOpen: false,
  mapLayer: 'elevation',
  mapSeed: 0,
  mapCenter: [0, 0],
  mapRevision: 0,
  commandOpen: false,
  commandRunning: false,
  commandEntries: [],
  commandStatus: '输入 slash command，按 Enter 执行。',
  commandStatusState: 'idle',
  experience: null,
  gameplay: {
    station: null,
    inventoryOpen: false,
    lifecycle: 'alive',
    mode: 'survival',
    flightEnabled: false,
    inventory: [],
    creativeCatalog: [],
    selectedHotbarSlot: 0,
    craftableRecipeIds: [],
    recipes: [],
  },
});
const initialHud = (): HudState => ({
  visible: false,
  worldClock: '',
  health: { value: 20, max: 20 },
  hunger: { value: 20, max: 20 },
  mode: 'survival',
  flightEnabled: false,
  selectedHotbarSlot: 0,
  hotbar: Array.from({ length: 8 }, (_, slot) => ({ slot, itemId: null, count: 0, name: '空槽位', edible: false })),
});
const initialInteraction = (): InteractionState => ({
  gesture: null,
  target: null,
  feedback: null,
  breaking: null,
  presentedEntities: [],
});
const initialDebug = (): DebugState => ({ visible: false, text: '', collisionDebug: null });

export function createUiBridge(options: BridgeOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle));
  const debugIntervalMs = options.debugIntervalMs ?? 250;
  let rateStartedAt = now();
  let ratePublishBaseline = 0;
  let rateDebugBaseline = 0;
  const counts: MutableMetrics = {
    shellPublishCount: 0,
    hudPublishCount: 0,
    interactionPublishCount: 0,
    debugProjectionCount: 0,
    debugPublishCount: 0,
    staleUpdateCount: 0,
    coalescedUpdateCount: 0,
    domCommitCount: 0,
    projectionDurationMs: 0,
    publishDurationMs: 0,
    domCommitDurationMs: 0,
  };
  const shell = createChannel(
    initialShell(),
    (duration) => {
      counts.shellPublishCount += 1;
      counts.publishDurationMs += duration;
    },
    now,
  );
  const hud = createChannel(
    initialHud(),
    (duration) => {
      counts.hudPublishCount += 1;
      counts.publishDurationMs += duration;
    },
    now,
  );
  const interaction = createChannel(
    initialInteraction(),
    (duration) => {
      counts.interactionPublishCount += 1;
      counts.publishDurationMs += duration;
    },
    now,
  );
  const debug = createChannel(
    initialDebug(),
    (duration) => {
      counts.debugPublishCount += 1;
      counts.publishDurationMs += duration;
    },
    now,
  );
  let activeToken = 0;
  let feedbackTimer: TimerHandle | null = null;

  const publishPatch = <Value extends object>(
    target: { channel: ReadonlyChannel<Value>; publish: (next: Value) => boolean },
    patch: Partial<Value>,
  ) => {
    const changed = target.publish({ ...target.channel.get(), ...patch });
    if (!changed) counts.coalescedUpdateCount += 1;
    return changed;
  };

  const clearFeedback = () => {
    if (feedbackTimer !== null) clearTimer(feedbackTimer);
    feedbackTimer = null;
    publishPatch(interaction, { feedback: null });
  };

  return {
    shell: shell.channel,
    hud: hud.channel,
    interaction: interaction.channel,
    debug: debug.channel,
    publishShell: (patch: Partial<ShellState>) => publishPatch(shell, patch),
    publishDebug: (patch: Partial<DebugState>) => publishPatch(debug, patch),
    beginMeasurementWindow() {
      rateStartedAt = now();
      ratePublishBaseline =
        counts.shellPublishCount + counts.hudPublishCount + counts.interactionPublishCount + counts.debugPublishCount;
      rateDebugBaseline = counts.debugProjectionCount;
    },
    recordDomCommit(durationMs: number) {
      counts.domCommitCount += 1;
      counts.domCommitDurationMs += Math.max(0, durationMs);
    },
    metrics(): UiMetrics {
      const elapsedSeconds = Math.max(1, (now() - rateStartedAt) / 1000);
      const totalPublishes =
        counts.shellPublishCount + counts.hudPublishCount + counts.interactionPublishCount + counts.debugPublishCount;
      return {
        runtime: 'svelte5',
        ...counts,
        debugProjectionRate: (counts.debugProjectionCount - rateDebugBaseline) / elapsedSeconds,
        totalPublishRate: (totalPublishes - ratePublishBaseline) / elapsedSeconds,
      };
    },
    beginWorldSession(worldSessionId: string) {
      const token = ++activeToken;
      const sequences = { hud: 0, interaction: 0, debug: 0 };
      let lastDebugAt = -debugIntervalMs;
      let disposed = false;
      clearFeedback();
      publishPatch(hud, initialHud());
      publishPatch(interaction, initialInteraction());
      publishPatch(debug, initialDebug());
      rateStartedAt = now();
      ratePublishBaseline =
        counts.shellPublishCount + counts.hudPublishCount + counts.interactionPublishCount + counts.debugPublishCount;
      rateDebugBaseline = counts.debugProjectionCount;

      const accept = (channel: keyof typeof sequences, sequence: number) => {
        if (disposed || token !== activeToken || sequence <= sequences[channel]) {
          counts.staleUpdateCount += 1;
          return false;
        }
        sequences[channel] = sequence;
        return true;
      };

      const publishTarget = (sequence: number, target: InteractionTarget | null) => {
        if (!accept('interaction', sequence)) return false;
        const current = interaction.channel.get().target;
        if (current?.kind === target?.kind && current?.id === target?.id) {
          counts.coalescedUpdateCount += 1;
          return false;
        }
        return publishPatch(interaction, { target });
      };

      return {
        worldSessionId,
        publishHud(sequence: number, patch: Partial<HudState>) {
          return accept('hud', sequence) && publishPatch(hud, patch);
        },
        publishTarget,
        publishInteraction(sequence: number, patch: Partial<InteractionState>) {
          return accept('interaction', sequence) && publishPatch(interaction, patch);
        },
        publishFeedback(sequence: number, value: { message: string; tone: FeedbackTone; durationMs: number }) {
          if (!accept('interaction', sequence)) return false;
          if (feedbackTimer !== null) clearTimer(feedbackTimer);
          const { durationMs, ...feedback } = value;
          const published = publishPatch(interaction, { feedback });
          feedbackTimer = setTimer(() => {
            if (disposed || token !== activeToken) return;
            feedbackTimer = null;
            publishPatch(interaction, { feedback: null });
          }, durationMs);
          return published;
        },
        sampleDebug(sequence: number, projector: () => Partial<DebugState>) {
          if (disposed || token !== activeToken) {
            counts.staleUpdateCount += 1;
            return false;
          }
          const sampledAt = now();
          if (sampledAt - lastDebugAt < debugIntervalMs) return false;
          if (!accept('debug', sequence)) return false;
          lastDebugAt = sampledAt;
          const projectionStartedAt = now();
          const projection = projector();
          counts.projectionDurationMs += Math.max(0, now() - projectionStartedAt);
          counts.debugProjectionCount += 1;
          return publishPatch(debug, projection);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          if (token === activeToken) clearFeedback();
        },
      };
    },
  };
}

export type UiBridge = ReturnType<typeof createUiBridge>;
export type UiWorldSession = ReturnType<UiBridge['beginWorldSession']>;
