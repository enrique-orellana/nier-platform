export interface RequestedCompositionMetadata {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export function applyRequestedCompositionMetadata<
  T extends RequestedCompositionMetadata,
>(
  composition: T,
  metadata: RequestedCompositionMetadata,
): T {
  return {
    ...composition,
    ...metadata,
  };
}
