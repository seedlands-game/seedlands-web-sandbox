import { registerClassicBoatJourney } from './boat-journey';
import { registerClassicMinecartJourney } from './minecart-journey';

export function registerClassicTransportJourneys(test: typeof import('@playwright/test').test) {
  registerClassicMinecartJourney(test);
  registerClassicBoatJourney(test);
}
