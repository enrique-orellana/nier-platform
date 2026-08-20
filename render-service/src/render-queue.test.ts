import { describe, expect, it } from "vitest";
import { RenderQueue } from "./render-queue.js";

describe("render queue", () => {
  it("never runs more tasks than its configured concurrency", async () => {
    const queue = new RenderQueue(2);
    let active = 0;
    let maximumActive = 0;
    const resolvers: Array<() => void> = [];
    const task = () => new Promise<void>((resolve) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      resolvers.push(() => {
        active -= 1;
        resolve();
      });
    });

    queue.add(task);
    queue.add(task);
    queue.add(task);
    while (resolvers.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maximumActive).toBe(2);
    expect(resolvers).toHaveLength(2);

    resolvers.shift()?.();
    while (resolvers.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maximumActive).toBe(2);
    expect(resolvers).toHaveLength(2);

    resolvers.shift()?.();
    resolvers.shift()?.();
    await queue.onIdle();
    expect(active).toBe(0);
  });
});
