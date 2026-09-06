import type { AuthorityTransportFaults } from '../client/authority-transport';
import type { PerformanceProfile } from '../client/performance-profile';

export type BrowserSessionConfig = Readonly<{
  harnessEnabled: boolean;
  generalWorkerCount: 1 | 2;
  physicsHz: 30 | 60 | 120;
  authorityTransportFaults: AuthorityTransportFaults;
}>;

export function readBrowserSessionConfig(search: string): BrowserSessionConfig {
  const parameters = new URLSearchParams(search);
  const harnessEnabled = parameters.has('harness');
  const requestedPhysicsHz = Number(parameters.get('physicsHz'));
  const physicsHz =
    harnessEnabled && [30, 60, 120].includes(requestedPhysicsHz) ? (requestedPhysicsHz as 30 | 60 | 120) : 60;
  const requestedLatencyMs = Number(parameters.get('authorityLatencyMs'));
  const latencyMs =
    harnessEnabled && [0, 50, 150].includes(requestedLatencyMs) ? (requestedLatencyMs as 0 | 50 | 150) : 0;
  const duplicate = harnessEnabled && parameters.get('authorityDuplicate') === '1';
  return {
    harnessEnabled,
    generalWorkerCount: parameters.get('generalWorkers') === '2' ? 2 : 1,
    physicsHz,
    authorityTransportFaults: {
      harnessEnabled,
      latencyMs,
      duplicateOutbound: duplicate,
      duplicateInbound: duplicate,
      reorderInbound: harnessEnabled && parameters.get('authorityReorder') === '1',
    },
  };
}

export const applySessionWorkerBudget = (
  profile: PerformanceProfile,
  generalWorkerCount: 1 | 2,
): PerformanceProfile => ({ ...profile, maxWorkerTasksInFlight: generalWorkerCount });
