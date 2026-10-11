// The page reconnects on its own (Virgil, OLV7-31), proved with a fake socket
// and a hand-driven clock. Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionKeeper } from '../../src/renderer/src/services/reconnect.ts';

class FakeSocket {
  onopen: ((ev: unknown) => unknown) | null = null;

  onmessage: ((ev: { data: unknown }) => unknown) | null = null;

  onclose: ((ev: unknown) => unknown) | null = null;

  onerror: ((ev: unknown) => unknown) | null = null;

  readyState = 0;

  sent: string[] = [];

  closed = false;

  url: string;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) { this.sent.push(data); }

  close() { this.closed = true; }

  open() { this.readyState = 1; this.onopen?.({}); }

  fail() { this.readyState = 3; this.onerror?.({}); this.onclose?.({}); }
}

function harness(readyAnswers: boolean[] = []) {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  const states: string[] = [];
  let opens = 0;
  const data: unknown[] = [];
  const asked: string[] = [];
  let nextId = 1;
  const keeper = new ConnectionKeeper({
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    ready: async (url) => {
      asked.push(url);
      return readyAnswers.length ? readyAnswers.shift()! : true;
    },
    setTimer: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimer: (id) => {
      const at = timers.findIndex((t) => t.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
    onState: (s) => states.push(s),
    onOpen: () => { opens += 1; },
    onData: (d) => data.push(d),
  });
  const tick = async () => {
    const t = timers.shift();
    assert.ok(t, 'a retry should be waiting');
    t.fn();
    await new Promise((r) => setImmediate(r));
    return t.ms;
  };
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    keeper, sockets, timers, states, data, asked, tick, settle, opens: () => opens,
  };
}

const URL_ = 'ws://127.0.0.1:1/client-ws';

test('a server that is down is retried until it answers, with no click', async () => {
  const h = harness();
  h.keeper.connect(URL_);
  await h.settle();
  h.sockets[0].fail();
  assert.equal(h.keeper.current, 'CONNECTING');
  assert.equal(await h.tick(), 1000);
  h.sockets[1].fail();
  assert.equal(await h.tick(), 2000);
  h.sockets[2].fail();
  assert.equal(await h.tick(), 3000);
  h.sockets[3].fail();
  assert.equal(await h.tick(), 5000);
  h.sockets[4].fail();
  assert.equal(await h.tick(), 5000);
  // The server is up now.
  h.sockets[5].open();
  assert.equal(h.keeper.current, 'OPEN');
  assert.equal(h.opens(), 1);
  assert.equal(h.timers.length, 0);
  // While it was trying the page never said CLOSED ("click to reconnect").
  assert.deepEqual(h.states, ['CONNECTING', 'OPEN']);
});

test('a server that is starting (503) is waited for, without opening a session', async () => {
  const h = harness([false, false, true]);
  h.keeper.connect(URL_);
  await h.settle();
  assert.equal(h.sockets.length, 0);
  await h.tick();
  assert.equal(h.sockets.length, 0);
  await h.tick();
  assert.equal(h.sockets.length, 1, 'opens only once the server says ready');
  assert.equal(h.asked.length, 3);
  h.sockets[0].open();
  assert.equal(h.keeper.current, 'OPEN');
});

test('a server that goes away and comes back is reconnected, from a short delay again', async () => {
  const h = harness();
  h.keeper.connect(URL_);
  await h.settle();
  h.sockets[0].open();
  h.sockets[0].fail();
  assert.equal(h.keeper.current, 'CONNECTING');
  assert.equal(await h.tick(), 1000);
  h.sockets[1].open();
  assert.equal(h.opens(), 2, 'the new session is set up again (configs, history)');
  h.sockets[1].fail();
  assert.equal(await h.tick(), 1000, 'the delay starts small again after a success');
});

test('messages reach the page; a dropped socket does not', async () => {
  const h = harness();
  h.keeper.connect(URL_);
  await h.settle();
  const first = h.sockets[0];
  first.open();
  first.onmessage?.({ data: 'one' });
  h.keeper.connect(URL_);
  await h.settle();
  assert.equal(first.closed, true);
  // A late message from the replaced socket is ignored (its handlers were removed).
  assert.equal(first.onmessage, null);
  h.sockets[1].open();
  h.sockets[1].onmessage?.({ data: 'two' });
  assert.deepEqual(h.data, ['one', 'two']);
  assert.equal(h.keeper.openSocket, h.sockets[1]);
});

test('disconnect means stop: nothing retries', async () => {
  const h = harness();
  h.keeper.connect(URL_);
  await h.settle();
  h.sockets[0].fail();
  assert.equal(h.timers.length, 1);
  h.keeper.disconnect();
  assert.equal(h.timers.length, 0);
  assert.equal(h.keeper.current, 'CLOSED');
  assert.equal(h.keeper.openSocket, null);
});

test('reconnectSoon leaves this session and tries again', async () => {
  const h = harness();
  h.keeper.connect(URL_);
  await h.settle();
  h.sockets[0].open();
  h.keeper.reconnectSoon();
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.keeper.current, 'CONNECTING');
  await h.tick();
  h.sockets[1].open();
  assert.equal(h.keeper.current, 'OPEN');
});

test('a readiness check that throws still lets the socket try', async () => {
  const h = harness();
  const keeper = new ConnectionKeeper({
    createSocket: (url) => { const s = new FakeSocket(url); h.sockets.push(s); return s; },
    ready: async () => { throw new Error('boom'); },
    setTimer: () => 0,
    clearTimer: () => {},
    onState: () => {},
    onOpen: () => {},
    onData: () => {},
  });
  keeper.connect(URL_);
  await h.settle();
  assert.equal(h.sockets.length, 1);
});
