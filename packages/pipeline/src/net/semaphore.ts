/** Bounds how many async operations run at once. Waiters are served in FIFO order. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('Semaphore size must be a positive integer');
    }
  }

  get inFlight(): number {
    return this.active;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // hand the slot straight to the next waiter
      next();
    } else {
      this.active--;
    }
  }
}

/** Maps items with at most `concurrency` in flight, preserving input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const semaphore = new Semaphore(concurrency);
  return Promise.all(items.map((item, index) => semaphore.run(() => fn(item, index))));
}
