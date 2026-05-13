// In-process BackgroundQueue. Jobs are processed by the registered handler
// with bounded concurrency. Cloudflare Queues adapter later.
//
// Note: not durable. If the process crashes mid-job, the job is lost. Fine
// for dev — in production, Cloudflare Queues gives durability + retries.

import type { BackgroundQueue, QueueHandler } from "@/interfaces/queue";

export class InProcessQueue<T> implements BackgroundQueue<T> {
  private inflight = 0;
  private pending: T[] = [];

  constructor(
    private readonly handler: QueueHandler<T>,
    private readonly concurrency: number = 4,
  ) {}

  async enqueue(job: T): Promise<void> {
    this.pending.push(job);
    this.pump();
  }

  async enqueueBatch(jobs: T[]): Promise<void> {
    this.pending.push(...jobs);
    this.pump();
  }

  private pump(): void {
    while (this.inflight < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.inflight++;
      void this.handler(job)
        .catch((err) => {
          // TODO: structured retry / dead-letter. For now, log and drop.
          console.error("[queue] handler failed:", err);
        })
        .finally(() => {
          this.inflight--;
          this.pump();
        });
    }
  }
}
