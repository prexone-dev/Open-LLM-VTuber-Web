// The page plays one silent clip as early as it may, so a hidden tab can
// still start Virgil's sentences (Virgil, OLV1-33). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioPrime, silentWavDataUrl } from '../../src/renderer/src/services/audio-prime.ts';

const refusal = () => Object.assign(new Error('play() needs a user gesture'), { name: 'NotAllowedError' });
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

/** A document stand-in that records listeners and can fire a gesture. */
function fakeDocument() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) {
      [...(listeners.get(type) ?? [])].forEach((fn) => fn());
    },
    count() {
      let n = 0;
      listeners.forEach((set) => { n += set.size; });
      return n;
    },
  };
}

/** play() results handed out in order; the last one repeats. */
function player(results: Array<'ok' | 'refuse' | 'broken'>) {
  let plays = 0;
  const make = () => ({
    play: () => {
      const r = results[Math.min(plays, results.length - 1)];
      plays += 1;
      if (r === 'ok') return Promise.resolve();
      if (r === 'refuse') return Promise.reject(refusal());
      return Promise.reject(new Error('no decoder'));
    },
  });
  return { make, get plays() { return plays; } };
}

test('the silent clip is a valid, silent WAV', () => {
  const url = silentWavDataUrl(0.1, 8000);
  assert.match(url, /^data:audio\/wav;base64,/);
  const bytes = Buffer.from(url.split(',')[1], 'base64');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(40), 800);
  assert.equal(bytes.length, 44 + 800);
  assert.ok([...bytes.subarray(44)].every((b) => b === 128), 'every sample is silence');
});

test('primed at start-up when the browser allows sound', async () => {
  const doc = fakeDocument();
  const p = player(['ok']);
  const prime = new AudioPrime(p.make, doc);
  prime.start();
  await flush();
  assert.equal(prime.primed, true);
  assert.equal(p.plays, 1);
  assert.equal(doc.count(), 0, 'nothing left listening');
});

test('refused at start-up, primed inside his first click, and then stops listening', async () => {
  const doc = fakeDocument();
  const p = player(['refuse', 'ok']);
  const prime = new AudioPrime(p.make, doc);
  prime.start();
  await flush();
  assert.equal(prime.primed, false);
  assert.ok(doc.count() > 0, 'waiting for a gesture');
  doc.fire('click');
  await flush();
  assert.equal(prime.primed, true);
  assert.equal(p.plays, 2);
  assert.equal(doc.count(), 0);
  doc.fire('keydown');
  await flush();
  assert.equal(p.plays, 2, 'never played again');
});

test('refused again at a gesture, it keeps waiting for the next one', async () => {
  const doc = fakeDocument();
  const p = player(['refuse', 'refuse', 'ok']);
  const prime = new AudioPrime(p.make, doc);
  prime.start();
  await flush();
  doc.fire('touchend');
  await flush();
  assert.equal(prime.primed, false);
  doc.fire('keydown');
  await flush();
  assert.equal(prime.primed, true);
  assert.equal(p.plays, 3);
});

test('a failure that is not the autoplay refusal gives up quietly and stops listening', async () => {
  const doc = fakeDocument();
  const p = player(['broken']);
  const prime = new AudioPrime(p.make, doc);
  const warn = console.warn;
  console.warn = () => {};
  try {
    prime.start();
    await flush();
  } finally {
    console.warn = warn;
  }
  assert.equal(prime.primed, false);
  assert.equal(doc.count(), 0);
  doc.fire('click');
  await flush();
  assert.equal(p.plays, 1);
});

test('start() twice plays once', async () => {
  const p = player(['ok']);
  const prime = new AudioPrime(p.make, fakeDocument());
  prime.start();
  prime.start();
  await flush();
  assert.equal(p.plays, 1);
});
