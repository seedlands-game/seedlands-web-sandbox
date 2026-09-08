export const MAX_PLAYABLE_FRAME_BYTES = 1024 * 1024;
export const MAX_PLAYABLE_SEND_QUEUE_BYTES = 4 * 1024 * 1024;

export const playableNetworkLimits = Object.freeze({
  metadataBytesMax: 64 * 1024,
  reliableMessageBytesMax: MAX_PLAYABLE_FRAME_BYTES,
  baselineTransferBytesMax: MAX_PLAYABLE_FRAME_BYTES,
  baselineInFlightBytesMax: 16 * 1024 * 1024,
  inboundMessagesPerSecond: 120,
  inboundBurst: 180,
  actionMessagesPerSecond: 30,
  interestKeysMax: 1,
  canonicalResidencyMax: 512,
  sendQueueBytesMax: MAX_PLAYABLE_SEND_QUEUE_BYTES,
});

export const playableBaselineLimits = Object.freeze({
  metadataBytesMax: playableNetworkLimits.metadataBytesMax,
  reliableMessageBytesMax: playableNetworkLimits.reliableMessageBytesMax,
  baselineTransferBytesMax: playableNetworkLimits.baselineTransferBytesMax,
  baselineInFlightBytesMax: playableNetworkLimits.baselineInFlightBytesMax,
  sendQueueBytesMax: playableNetworkLimits.sendQueueBytesMax,
});
