/* eslint-disable no-promise-executor-return */
/* eslint-disable arrow-parens */

/** Whether the page is out of sight - another tab, or the window minimised. */
const pageHidden = () => typeof document !== 'undefined' && document.hidden;

/**
 * Runs tasks one at a time, in order.
 *
 * Virgil (OLV1-33, 2026-10-30), his report: away from the tab Virgil said nothing, and
 * back on it everything it had meant to say came out at once, speaking over itself.
 * Two things in the old queue did that, and both are changed here:
 * - `clearQueue` marked the queue idle while a task was still running, so the next
 *   task started beside it. A sentence that cannot finish while the tab is hidden
 *   stayed running, and every new turn added another player beside it, all of which
 *   played when the tab came back. Now clearing drops only what is waiting; the task
 *   in flight runs to its end (an interruption stops its sound first, which ends it).
 * - The gap between tasks and `waitForCompletion` were timers, which a hidden tab
 *   slows to once a second, and Chrome to once a minute after five minutes. Now the
 *   gap is skipped while the page is hidden and the end is told, not polled.
 */
export class TaskQueue {
  private queue: (() => Promise<void>)[] = [];

  private current: Promise<void> | null = null;

  private taskInterval: number;

  private hidden: () => boolean;

  private idle: (() => void)[] = [];

  constructor(taskIntervalMs = 3000, hidden: () => boolean = pageHidden) {
    this.taskInterval = taskIntervalMs;
    this.hidden = hidden;
  }

  addTask(task: () => Promise<void>) {
    this.queue.push(task);
    this.runNextTask();
  }

  /** Drop every task still waiting. The one in flight, if any, runs to its end. */
  clearQueue() {
    this.queue = [];
  }

  private gap(): Promise<void> {
    if (this.taskInterval <= 0 || this.hidden()) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, this.taskInterval));
  }

  private runNextTask() {
    if (this.current) return;
    const task = this.queue.shift();
    if (!task) {
      this.settle();
      return;
    }
    const run = (async () => {
      try {
        await task();
        await this.gap();
      } catch (error) {
        console.error('Task Queue Error', error);
      }
    })();
    this.current = run;
    run.then(() => {
      this.current = null;
      this.runNextTask();
    });
  }

  private settle() {
    const waiting = this.idle;
    this.idle = [];
    waiting.forEach(resolve => resolve());
  }

  public hasTask(): boolean {
    return this.queue.length > 0 || this.current !== null;
  }

  /** Resolves once nothing is running or waiting. */
  public waitForCompletion(): Promise<void> {
    if (!this.hasTask()) return Promise.resolve();
    return new Promise((resolve) => { this.idle.push(resolve); });
  }
}

export const audioTaskQueue = new TaskQueue(20);
