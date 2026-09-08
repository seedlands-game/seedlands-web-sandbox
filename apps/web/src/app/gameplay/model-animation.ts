import type { ModelAnimationRole } from '../../client/presentation/appearance-project';

export type ModelAnimationClips = Partial<Record<ModelAnimationRole, string>>;

export type ModelAnimationPlayback = Readonly<{
  play(clipName: string, options: Readonly<{ loop: boolean; blendSeconds: number }>): void;
  locate(normalizedTime: number, normalizedRatePerSecond: number): void;
}>;

export type AuthoritativeAnimationAction = Readonly<{
  actionId: string;
  comboStep: number;
  phase: 'windup' | 'hit' | 'recovery';
  phaseElapsedSeconds: number;
  phaseDurationSeconds: number;
}>;

export type ModelAnimationInput = Readonly<{
  moving: boolean;
  activeAction: AuthoritativeAnimationAction | null;
  hurtSequence: number | null;
}>;

export type ModelAnimationController = Readonly<{
  update(input: ModelAnimationInput): void;
  reset(): void;
}>;

const transition = (input: ModelAnimationInput): Readonly<{ role: ModelAnimationRole; token: string }> => {
  if (input.hurtSequence !== null) return { role: 'hurt', token: `hurt:${input.hurtSequence}` };
  if (input.activeAction !== null)
    return { role: 'attack', token: `attack:${input.activeAction.actionId}:${input.activeAction.comboStep}` };
  return input.moving ? { role: 'move', token: 'move' } : { role: 'idle', token: 'idle' };
};

const attackSegment = (action: AuthoritativeAnimationAction): Readonly<{ time: number; rate: number }> => {
  const [start, end] = action.phase === 'windup' ? [0, 0.35] : action.phase === 'hit' ? [0.35, 0.6] : [0.6, 1];
  const progress =
    action.phaseDurationSeconds > 0
      ? Math.max(0, Math.min(1, action.phaseElapsedSeconds / action.phaseDurationSeconds))
      : 1;
  return {
    time: start + (end - start) * progress,
    rate: action.phaseDurationSeconds > 0 ? (end - start) / action.phaseDurationSeconds : 0,
  };
};

/** Maps presentation facts to clips. Tokens prevent phase updates from restarting one authoritative action. */
export function createModelAnimationController(
  clips: ModelAnimationClips,
  playback: ModelAnimationPlayback,
): ModelAnimationController {
  let currentToken: string | null = null;
  let currentClip: string | null = null;
  return {
    update(input) {
      const next = transition(input);
      const clip = clips[next.role] ?? clips.idle;
      if (!clip) return;
      if (next.token !== currentToken || clip !== currentClip) {
        playback.play(clip, {
          loop: next.role === 'idle' || next.role === 'move',
          blendSeconds: currentToken === null ? 0 : next.role === 'hurt' ? 0.04 : next.role === 'attack' ? 0.06 : 0.12,
        });
        currentToken = next.token;
        currentClip = clip;
      }
      if (next.role === 'attack' && input.activeAction && clips.attack === clip) {
        const segment = attackSegment(input.activeAction);
        playback.locate(segment.time, segment.rate);
      }
    },
    reset() {
      currentToken = null;
      currentClip = null;
    },
  };
}
