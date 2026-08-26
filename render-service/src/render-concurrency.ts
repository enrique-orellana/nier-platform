export interface RenderConcurrencyOptions {
  requested: number;
  available: number;
}

export const DEFAULT_RENDER_CONCURRENCY = 2;

export function resolveRenderConcurrency(configured: string | undefined): number {
  if (!configured?.trim()) return DEFAULT_RENDER_CONCURRENCY;

  const parsed = Number.parseInt(configured, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_RENDER_CONCURRENCY;
}

export function selectRenderConcurrency({
  requested,
  available,
}: RenderConcurrencyOptions): number {
  const availableWorkers = Number.isInteger(available) && available > 0 ? available : 1;
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return Math.min(requested, availableWorkers);
}
