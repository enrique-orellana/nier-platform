export interface RenderConcurrencyOptions {
  requested: number;
  available: number;
}

export function selectRenderConcurrency({
  requested,
  available,
}: RenderConcurrencyOptions): number {
  const availableWorkers = Number.isInteger(available) && available > 0 ? available : 1;
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return Math.min(requested, availableWorkers);
}
