import { describe, expect, it } from 'vitest';
import { ContextSession } from '../../apps/agent-server/src/context-session';
import type { CognitionModel, ModelCompletion } from '../../apps/agent-server/src/model-types';
import { event } from './fixtures';

const memory = { revision: 7, throughCursor: 0, summary: 'old' };

describe('ContextSession rotation', () => {
  it('freezes a cursor, buffers new events, and switches only after Authority acceptance', async () => {
    let resolve!: (value: ModelCompletion) => void;
    let compressionMessages: readonly import('../../apps/agent-server/src/model-types').DeepSeekMessage[] = [];
    const model: CognitionModel = {
      complete: (request) => {
        compressionMessages = request.messages;
        return new Promise<ModelCompletion>((done) => (resolve = done));
      },
    };
    const session = new ContextSession(
      [
        { role: 'user', content: 'older evidence' },
        { role: 'assistant', content: 'public response', reasoning_content: 'private source reasoning' },
      ],
      {
        estimateTokens: () => 20,
        softThreshold: 10,
        hardThreshold: 30,
      },
    );
    session.appendEvents([event(1)]);
    const before = [...session.messages];
    const rotating = session.rotate(model, memory);
    session.appendEvents([event(2, 'attacked')]);
    resolve({
      message: { role: 'assistant', content: 'confirmed summary', reasoning_content: 'private compression' },
      finishReason: 'stop',
      usage: null,
      latencyMs: 3,
    });
    const candidate = await rotating;

    session.configureLimit(256_000);

    expect(candidate).toMatchObject({
      kind: 'pro',
      memory: { summary: 'confirmed summary', throughCursor: 1, expectedMemoryRevision: 7 },
    });
    expect(session.messages).toEqual([
      ...before,
      expect.objectContaining({ content: expect.stringContaining('"cursor":2') }),
    ]);
    expect(session.generation).toBe(1);
    expect(JSON.stringify(compressionMessages)).not.toContain('private source reasoning');
    expect(JSON.stringify(compressionMessages)).toContain('public response');

    expect(session.commitPreparedRotation()).toBe(true);
    expect(session.generation).toBe(2);
    expect(session.messages[0]?.content).toContain('confirmed summary');
    expect(session.messages.some((message) => message.content?.includes('"cursor":2'))).toBe(true);
    expect(JSON.stringify(session.messages)).not.toContain('private compression');
  });

  it('keeps the entire old journal when Pro fails below the hard threshold or Authority rejects', async () => {
    const failing: CognitionModel = { complete: async () => Promise.reject(new Error('mock failure')) };
    const session = new ContextSession([{ role: 'user', content: 'keep me' }], {
      estimateTokens: () => 20,
      softThreshold: 10,
      hardThreshold: 30,
    });
    const before = [...session.messages];
    expect(await session.rotate(failing, memory)).toMatchObject({ kind: 'none', error: 'compression-failed' });
    expect(session.messages).toEqual(before);

    const successful: CognitionModel = {
      complete: async () => ({
        message: { role: 'assistant', content: 'candidate' },
        finishReason: 'stop',
        usage: null,
        latencyMs: 1,
      }),
    };
    expect(await session.rotate(successful, memory)).toMatchObject({ kind: 'pro' });
    session.rejectPreparedRotation();
    expect(session.messages).toEqual(before);
    expect(session.generation).toBe(1);
  });

  it('uses deterministic recovery at the hard threshold and never truncates an open tool pair', async () => {
    const failing: CognitionModel = { complete: async () => Promise.reject(new Error('mock failure')) };
    const hard = new ContextSession([{ role: 'user', content: 'public fact' }], {
      estimateTokens: () => 40,
      softThreshold: 10,
      hardThreshold: 30,
    });
    expect(await hard.rotate(failing, memory)).toMatchObject({
      kind: 'deterministic',
      error: 'compression-failed',
    });
    expect(hard.commitPreparedRotation()).toBe(true);
    expect(hard.messages[0]?.content).toContain('Deterministic context recovery');

    const incomplete = new ContextSession(
      [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'open', type: 'function', function: { name: 'inventory', arguments: '{}' } }],
        },
      ],
      { estimateTokens: () => 40, softThreshold: 10, hardThreshold: 30 },
    );
    expect(await incomplete.rotate(failing, memory)).toMatchObject({
      kind: 'none',
      error: 'incomplete-tool-pair',
    });
  });

  it('passes cancellation into Pro compression', async () => {
    let observedSignal: AbortSignal | undefined;
    const model: CognitionModel = {
      complete: async (request) => {
        observedSignal = request.signal;
        return await new Promise<ModelCompletion>((_resolve, reject) =>
          request.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
        );
      },
    };
    const session = new ContextSession([{ role: 'user', content: 'large' }], {
      estimateTokens: () => 20,
      softThreshold: 10,
      hardThreshold: 30,
    });
    const controller = new AbortController();
    const rotating = session.rotate(model, memory, 100, controller.signal);
    controller.abort();
    expect(await rotating).toMatchObject({ kind: 'none', error: 'compression-failed' });
    expect(observedSignal?.aborted).toBe(true);
  });
});
