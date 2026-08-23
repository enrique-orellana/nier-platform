import { describe, expect, it } from "vitest";
import { selectRenderConcurrency } from "./render-concurrency.js";

describe("selectRenderConcurrency", () => {
  it("keeps a requested concurrency within the available CPU budget", () => {
    expect(selectRenderConcurrency({ requested: 1, available: 8 })).toBe(1);
    expect(selectRenderConcurrency({ requested: 4, available: 8 })).toBe(4);
    expect(selectRenderConcurrency({ requested: 99, available: 4 })).toBe(4);
  });

  it("falls back to one worker for invalid values", () => {
    expect(selectRenderConcurrency({ requested: 0, available: 8 })).toBe(1);
    expect(selectRenderConcurrency({ requested: Number.NaN, available: 8 })).toBe(1);
    expect(selectRenderConcurrency({ requested: 4, available: 0 })).toBe(1);
  });
});
