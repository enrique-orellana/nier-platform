type RenderTask = () => Promise<void> | void;

export class RenderQueue {
  private readonly pending: RenderTask[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private active = 0;

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Render queue concurrency must be a positive integer");
    }
  }

  add(task: RenderTask): void {
    this.pending.push(task);
    this.drain();
  }

  onIdle(): Promise<void> {
    if (this.active === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) return;
      this.active += 1;
      Promise.resolve()
        .then(task)
        .catch(() => undefined)
        .finally(() => {
          this.active -= 1;
          this.drain();
          if (this.active === 0 && this.pending.length === 0) {
            const waiters = this.idleWaiters.splice(0);
            waiters.forEach((resolve) => resolve());
          }
        });
    }
  }
}
