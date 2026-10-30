// One sentence at a time, also when the tab is hidden (Virgil, OLV1-33).
// Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../../src/renderer/src/utils/task-queue.ts';

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

/** A sentence that plays until `finish()` is called, recording when it starts. */
function sentence(name: string, log: string[]) {
  let finish = () => {};
  const task = () => new Promise<void>((resolve) => {
    log.push(`start ${name}`);
    finish = () => { log.push(`end ${name}`); resolve(); };
  });
  return { task, finish: () => finish() };
}

test('sentences play one at a time, in order', async () => {
  const log: string[] = [];
  const queue = new TaskQueue(0);
  const a = sentence('a', log);
  const b = sentence('b', log);
  queue.addTask(a.task);
  queue.addTask(b.task);
  await flush();
  assert.deepEqual(log, ['start a']);
  a.finish();
  await flush();
  assert.deepEqual(log, ['start a', 'end a', 'start b']);
});

test('a new turn clearing the queue never starts a second player beside the one in flight', async () => {
  // His report, 2026-10-30: back on the tab, everything it meant to say came out at
  // once, speaking over itself. A sentence that cannot finish while the tab is hidden
  // stayed in flight, each new turn cleared the queue and started another beside it.
  const log: string[] = [];
  const queue = new TaskQueue(0);
  const first = sentence('first', log);
  const next = sentence('next', log);
  queue.addTask(first.task);
  await flush();
  queue.clearQueue();
  queue.addTask(next.task);
  await flush();
  assert.deepEqual(log, ['start first']);
  first.finish();
  await flush();
  assert.deepEqual(log, ['start first', 'end first', 'start next']);
});

test('clearing drops what waits, not what plays', async () => {
  const log: string[] = [];
  const queue = new TaskQueue(0);
  const a = sentence('a', log);
  const b = sentence('b', log);
  queue.addTask(a.task);
  queue.addTask(b.task);
  await flush();
  queue.clearQueue();
  a.finish();
  await flush();
  assert.deepEqual(log, ['start a', 'end a']);
  assert.equal(queue.hasTask(), false);
});

test('in a hidden tab the gap between sentences is not a timer the browser can hold back', async () => {
  // A hidden tab's timers are slowed to once a second, and in Chrome to once a minute
  // after five minutes; the queue's 20 ms gap became that long between sentences.
  const log: string[] = [];
  const queue = new TaskQueue(60_000, () => true);
  const a = sentence('a', log);
  const b = sentence('b', log);
  queue.addTask(a.task);
  queue.addTask(b.task);
  await flush();
  a.finish();
  await flush();
  await flush();
  assert.deepEqual(log, ['start a', 'end a', 'start b']);
});

test('waiting for the end is told when the queue empties, not polled on a timer', async () => {
  const log: string[] = [];
  const queue = new TaskQueue(0, () => true);
  const a = sentence('a', log);
  queue.addTask(a.task);
  let done = false;
  queue.waitForCompletion().then(() => { done = true; });
  await flush();
  assert.equal(done, false);
  a.finish();
  await flush();
  await flush();
  assert.equal(done, true);
  assert.equal(await Promise.race([queue.waitForCompletion().then(() => 'now'), flush().then(() => 'late')]), 'now');
});

test('a sentence that fails does not stop the ones behind it', async () => {
  const log: string[] = [];
  const queue = new TaskQueue(0);
  const b = sentence('b', log);
  const quiet = console.error;
  console.error = () => {};
  try {
    queue.addTask(() => Promise.reject(new Error('bad audio')));
    queue.addTask(b.task);
    await flush();
    await flush();
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(log, ['start b']);
});

test('a wait already in progress when the queue is cleared ends with the sentence in flight, not before', async () => {
  // use-audio-task tells the server playback is complete when this resolves.
  const log: string[] = [];
  const queue = new TaskQueue(0);
  const a = sentence('a', log);
  queue.addTask(a.task);
  let done = false;
  queue.waitForCompletion().then(() => { done = true; });
  queue.clearQueue();
  await flush();
  assert.equal(done, false);
  a.finish();
  await flush();
  await flush();
  assert.equal(done, true);
});
