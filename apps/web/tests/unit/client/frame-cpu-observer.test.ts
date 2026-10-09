import { describe, expect, it } from 'vitest';
import { FrameCpuObserver } from '../../../src/client/presentation/frame-cpu-observer';

class EventSource {
  private readonly listeners = new Map<string, Set<() => void>>();

  on(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  off(name: string, listener: () => void): void {
    this.listeners.get(name)?.delete(listener);
  }

  emit(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) listener();
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

describe('FrameCpuObserver', () => {
  it('pairs update and render wall intervals and returns bounded detached frozen samples', () => {
    const events = new EventSource();
    let now = 0;
    const observer = new FrameCpuObserver(() => now, 2);
    observer.attach(events);

    for (let index = 0; index < 3; index += 1) {
      now = index * 100;
      events.emit('frameupdate');
      now += 5;
      events.emit('framerender');
      now += 5;
      events.emit('prerender');
      now += 12;
      events.emit('postrender');
      now += 18;
      events.emit('frameend');
    }

    const sample = observer.snapshot();
    expect(sample.sampleCount).toBe(2);
    expect(sample.samples.map(({ updateWallMs, renderWallMs }) => [updateWallMs, renderWallMs])).toEqual([
      [5, 12],
      [5, 12],
    ]);
    expect(
      sample.samples.map(({ renderEnvelopeWallMs, renderTailWallMs, tickWallMs }) => [
        renderEnvelopeWallMs,
        renderTailWallMs,
        tickWallMs,
      ]),
    ).toEqual([
      [35, 18, 40],
      [35, 18, 40],
    ]);
    expect(sample.samples[1]!.frameSequence).toBeGreaterThan(sample.samples[0]!.frameSequence);
    expect(Object.isFrozen(sample)).toBe(true);
    expect(Object.isFrozen(sample.samples)).toBe(true);
    expect(sample.samples.every(Object.isFrozen)).toBe(true);
    expect(() => (sample.samples as unknown as Array<unknown>).push({})).toThrow();
    expect(observer.snapshot().sampleCount).toBe(2);
  });

  it('drops incomplete phases and prevents repeated frame starts from joining different frames', () => {
    const events = new EventSource();
    let now = 0;
    const observer = new FrameCpuObserver(() => now);
    observer.attach(events);

    events.emit('frameupdate');
    now = 4;
    events.emit('framerender');
    now = 8;
    events.emit('frameupdate');
    now = 10;
    events.emit('prerender');
    now = 20;
    events.emit('postrender');
    now = 25;
    events.emit('frameend');
    expect(observer.snapshot().sampleCount).toBe(0);

    now = 30;
    events.emit('frameupdate');
    now = 35;
    events.emit('framerender');
    now = 40;
    events.emit('frameupdate');
    now = 45;
    events.emit('framerender');
    now = 50;
    events.emit('prerender');
    now = 62;
    events.emit('postrender');
    now = 70;
    events.emit('frameend');
    expect(observer.snapshot().samples).toHaveLength(1);
    expect(observer.snapshot().samples[0]).toMatchObject({ updateWallMs: 5, renderWallMs: 12 });
  });

  it('does not record non-finite, negative, or backward intervals', () => {
    const events = new EventSource();
    let now = 10;
    const observer = new FrameCpuObserver(() => now);
    observer.attach(events);

    events.emit('frameupdate');
    now = 9;
    events.emit('framerender');
    now = Number.NaN;
    events.emit('prerender');
    now = 20;
    events.emit('postrender');
    now = 25;
    events.emit('frameend');

    now = 30;
    events.emit('frameupdate');
    now = 35;
    events.emit('framerender');
    now = 40;
    events.emit('prerender');
    now = 39;
    events.emit('postrender');
    now = 45;
    events.emit('frameend');
    expect(observer.snapshot().sampleCount).toBe(0);
  });

  it('keeps same-emitter attach idempotent and detaches old emitters on replacement/reset', () => {
    const first = new EventSource();
    const second = new EventSource();
    let now = 0;
    const observer = new FrameCpuObserver(() => now);
    observer.attach(first);
    const listenersOnFirst = first.listenerCount();
    observer.attach(first);
    expect(first.listenerCount()).toBe(listenersOnFirst);

    now = 1;
    first.emit('frameupdate');
    now = 3;
    first.emit('framerender');
    now = 4;
    first.emit('prerender');
    now = 8;
    first.emit('postrender');
    now = 10;
    first.emit('frameend');
    expect(observer.snapshot().sampleCount).toBe(1);

    observer.attach(second);
    expect(first.listenerCount()).toBe(0);
    expect(observer.snapshot().sampleCount).toBe(0);
    now = 10;
    first.emit('frameupdate');
    expect(observer.snapshot().sampleCount).toBe(0);

    observer.reset();
    expect(second.listenerCount()).toBe(0);
    expect(observer.snapshot().sampleCount).toBe(0);
    observer.attach(second);
    expect(second.listenerCount()).toBeGreaterThan(0);
    second.emit('destroy');
    expect(second.listenerCount()).toBe(0);
    expect(observer.snapshot().sampleCount).toBe(0);
    observer.attach(second);
    expect(second.listenerCount()).toBeGreaterThan(0);
  });

  it('records only complete frames and measures intervals through frameend', () => {
    const events = new EventSource();
    let now = 10;
    const observer = new FrameCpuObserver(() => now);
    observer.attach(events);

    events.emit('frameupdate');
    now = 15;
    events.emit('framerender');
    now = 20;
    events.emit('prerender');
    now = 32;
    events.emit('postrender');
    expect(observer.snapshot().sampleCount).toBe(0);
    now = 50;
    events.emit('frameend');
    expect(observer.snapshot().samples[0]).toMatchObject({
      updateWallMs: 5,
      renderWallMs: 12,
      renderEnvelopeWallMs: 35,
      renderTailWallMs: 18,
      tickWallMs: 40,
      interTickGapWallMs: null,
    });

    now = 60;
    events.emit('frameupdate');
    now = 65;
    events.emit('framerender');
    now = 70;
    events.emit('prerender');
    now = 72;
    events.emit('postrender');
    now = 100;
    events.emit('frameend');
    expect(observer.snapshot().samples[1]).toMatchObject({
      renderEnvelopeWallMs: 35,
      renderTailWallMs: 28,
      tickWallMs: 40,
      interTickGapWallMs: 10,
    });
  });

  it('does not pair missing render or backward frameend events into samples', () => {
    const events = new EventSource();
    let now = 0;
    const observer = new FrameCpuObserver(() => now);
    observer.attach(events);

    events.emit('frameupdate');
    now = 2;
    events.emit('framerender');
    now = 3;
    events.emit('prerender');
    now = 5;
    events.emit('postrender');
    events.emit('frameupdate');
    now = 8;
    events.emit('frameend');
    expect(observer.snapshot().sampleCount).toBe(0);

    now = 10;
    events.emit('frameupdate');
    now = 11;
    events.emit('framerender');
    now = 12;
    events.emit('prerender');
    now = 13;
    events.emit('postrender');
    now = 12;
    events.emit('frameend');
    expect(observer.snapshot().sampleCount).toBe(0);
  });
});
