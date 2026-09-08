export type WaterAudioMedium = { wading: boolean; swimming: boolean; cameraSubmerged: boolean };
export type WaterAudioEvent = 'water-enter' | 'water-exit' | 'water-wade' | 'water-swim';

export class WaterAudioPolicy {
  private previous: WaterAudioMedium = { wading: false, swimming: false, cameraSubmerged: false };
  private lastDistance = 0;
  private lastMovementEventAt = Number.NEGATIVE_INFINITY;

  sample(medium: WaterAudioMedium, distance: number, now: number, paused: boolean): WaterAudioEvent[] {
    if (paused) {
      this.previous = { ...medium };
      this.lastDistance = distance;
      this.lastMovementEventAt = now;
      return [];
    }
    const events: WaterAudioEvent[] = [];
    if (!this.previous.wading && medium.wading) events.push('water-enter');
    else if (this.previous.wading && !medium.wading) events.push('water-exit');

    const traveled = Math.max(0, distance - this.lastDistance);
    const threshold = medium.swimming ? 1.15 : 0.65;
    const minimumInterval = medium.swimming ? 0.42 : 0.32;
    if (
      medium.wading &&
      events.length === 0 &&
      traveled >= threshold &&
      now - this.lastMovementEventAt >= minimumInterval
    ) {
      events.push(medium.swimming ? 'water-swim' : 'water-wade');
      this.lastDistance = distance;
      this.lastMovementEventAt = now;
    } else if (!medium.wading || events.length > 0) {
      this.lastDistance = distance;
      this.lastMovementEventAt = now;
    }
    this.previous = { ...medium };
    return events;
  }
}
