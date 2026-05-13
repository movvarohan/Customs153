// BackgroundQueue interface. Local adapter is an in-process async worker pool;
// Cloudflare Queues adapter later.

export interface BackgroundQueue<T> {
  enqueue(job: T): Promise<void>;
  enqueueBatch(jobs: T[]): Promise<void>;
}

export type QueueHandler<T> = (job: T) => Promise<void>;
