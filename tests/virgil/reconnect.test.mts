// The page keeps its own connection (Virgil, OLV7-31).
// Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RETRY_DELAYS_MS, retryDelay, readyUrlFor, serverReady, lacksModel,
} from '../../src/renderer/src/services/reconnect.ts';

test('retries grow, then hold at the last delay', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 50].map(retryDelay), [1000, 2000, 3000, 5000, 5000, 5000]);
  assert.equal(retryDelay(-3), RETRY_DELAYS_MS[0]);
  assert.equal(retryDelay(Number.NaN), RETRY_DELAYS_MS[0]);
});

test('the readiness address is the socket server over HTTP', () => {
  assert.equal(readyUrlFor('ws://127.0.0.1:12393/client-ws'), 'http://127.0.0.1:12393/api/ready');
  assert.equal(readyUrlFor('wss://example.test/client-ws?x=1#y'), 'https://example.test/api/ready');
  assert.equal(readyUrlFor('http://127.0.0.1/client-ws'), null);
  assert.equal(readyUrlFor('not a url'), null);
});

const answering = (status: number) => (async () => ({ status }) as Response) as typeof fetch;

test('only a 503 holds the socket back', async () => {
  const url = 'ws://127.0.0.1:1/client-ws';
  assert.equal(await serverReady(url, answering(200)), true);
  assert.equal(await serverReady(url, answering(503)), false);
  // A server from before /api/ready existed: let the socket try.
  assert.equal(await serverReady(url, answering(404)), true);
  // Nothing there: the socket fails and is retried.
  const down = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  assert.equal(await serverReady(url, down), true);
});

test('it asks the right address, uncached', async () => {
  let asked = '';
  let init: RequestInit | undefined;
  const spy = (async (input: string, given?: RequestInit) => {
    asked = input;
    init = given;
    return { status: 200 } as Response;
  }) as unknown as typeof fetch;
  await serverReady('ws://127.0.0.1:12393/client-ws', spy);
  assert.equal(asked, 'http://127.0.0.1:12393/api/ready');
  assert.equal(init?.cache, 'no-store');
});

test('a server that never answers counts as not answering, after the timeout', async () => {
  const hangs = ((_: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as unknown as typeof fetch;
  const started = Date.now();
  assert.equal(await serverReady('ws://127.0.0.1:1/client-ws', hangs, 50), true);
  assert.ok(Date.now() - started < 2000);
});

test('a session without a model is one to leave', () => {
  assert.equal(lacksModel(undefined), true);
  assert.equal(lacksModel(null), true);
  assert.equal(lacksModel({}), true);
  assert.equal(lacksModel({ url: '' }), true);
  // The blank page of 2026-10-08 asked for /undefined/undefined.model3.json.
  assert.equal(lacksModel({ url: '/undefined/undefined.model3.json' }), true);
  assert.equal(lacksModel({ url: '/live2d-models/x/x.model3.json' }), false);
});
