import { performance } from 'node:perf_hooks';

export const createPlayableNetworkRateLimit = (limits: {
  inboundBurst: number;
  inboundMessagesPerSecond: number;
  actionMessagesPerSecond: number;
}) => {
  let messageTokens = limits.inboundBurst;
  let actionTokens = limits.actionMessagesPerSecond;
  let timestamp = performance.now();
  return (action: boolean): boolean => {
    const now = performance.now();
    const elapsed = Math.max(0, now - timestamp) / 1000;
    timestamp = now;
    messageTokens = Math.min(limits.inboundBurst, messageTokens + elapsed * limits.inboundMessagesPerSecond);
    actionTokens = Math.min(limits.actionMessagesPerSecond, actionTokens + elapsed * limits.actionMessagesPerSecond);
    if (messageTokens < 1 || (action && actionTokens < 1)) return false;
    messageTokens -= 1;
    if (action) actionTokens -= 1;
    return true;
  };
};
