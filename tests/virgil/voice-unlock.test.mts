// The voice is held, never skipped, when the browser refuses to play it
// (Virgil, OLV7-31). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GESTURE_EVENTS, VoiceUnlock, isAutoplayRefusal, playOrHold,
} from '../../src/renderer/src/services/voice-unlock.ts';

const refusal = () => Object.assign(new Error('play() needs a user gesture'), { name: 'NotAllowedError' });
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

/** A play() that refuses `refusals` times, then plays. */
function fakePlayer(refusals: number) {
  const calls: number[] = [];
  let left = refusals;
  const play = () => {
    calls.push(calls.length + 1);
    if (left > 0) {
      left -= 1;
      return Promise.reject(refusal());
    }
    return Promise.resolve();
  };
  return { play, calls };
}

function recorder() {
  const events: string[] = [];
  let token: number | null = null;
  return {
    events,
    get token() { return token; },
    handlers: {
      onPlaying: () => { events.push('playing'); },
      onFailed: (err: unknown) => { events.push(`failed:${(err as Error).name}`); },
      onHeld: (t: number) => { token = t; events.push('held'); },
      onDropped: () => { events.push('dropped'); },
    },
  };
}

test('only NotAllowedError is the autoplay refusal', () => {
  assert.equal(isAutoplayRefusal(refusal()), true);
  assert.equal(isAutoplayRefusal(Object.assign(new Error('x'), { name: 'NotSupportedError' })), false);
  assert.equal(isAutoplayRefusal(Object.assign(new Error('x'), { name: 'AbortError' })), false);
  assert.equal(isAutoplayRefusal(null), false);
  assert.equal(isAutoplayRefusal('NotAllowedError'), false);
});

test('a sentence the browser plays is never held', async () => {
  const gate = new VoiceUnlock();
  const { play } = fakePlayer(0);
  const r = recorder();
  playOrHold(play, gate, r.handlers);
  await flush();
  assert.deepEqual(r.events, ['playing']);
  assert.equal(gate.isHeld, false);
});

test('a refused sentence is held, not skipped, and the click plays it', async () => {
  const gate = new VoiceUnlock();
  const seen: boolean[] = [];
  gate.subscribe((held) => seen.push(held));
  const { play, calls } = fakePlayer(1);
  const r = recorder();
  playOrHold(play, gate, r.handlers);
  await flush();
  assert.deepEqual(r.events, ['held']);
  assert.equal(gate.isHeld, true);
  assert.deepEqual(seen, [true]);

  assert.equal(gate.unlock(), true);
  // play() is called inside the click, synchronously: that is what the browser requires.
  assert.equal(calls.length, 2);
  await flush();
  assert.deepEqual(r.events, ['held', 'playing']);
  assert.equal(gate.isHeld, false);
  assert.deepEqual(seen, [true, false]);
});

test('refused again after the click: held again and the page says so again', async () => {
  const gate = new VoiceUnlock();
  const { play } = fakePlayer(2);
  const r = recorder();
  playOrHold(play, gate, r.handlers);
  await flush();
  const first = r.token;
  gate.unlock();
  await flush();
  assert.deepEqual(r.events, ['held', 'held']);
  assert.equal(gate.isHeld, true);
  assert.notEqual(r.token, first);
  gate.unlock();
  await flush();
  assert.deepEqual(r.events, ['held', 'held', 'playing']);
});

test('any other failure is reported, never held', async () => {
  const gate = new VoiceUnlock();
  const r = recorder();
  playOrHold(() => Promise.reject(Object.assign(new Error('bad'), { name: 'NotSupportedError' })), gate, r.handlers);
  await flush();
  assert.deepEqual(r.events, ['failed:NotSupportedError']);
  assert.equal(gate.isHeld, false);
});

test('a play() that throws is reported', () => {
  const gate = new VoiceUnlock();
  const r = recorder();
  playOrHold(() => { throw Object.assign(new Error('x'), { name: 'TypeError' }); }, gate, r.handlers);
  assert.deepEqual(r.events, ['failed:TypeError']);
});

test('a sentence interrupted while held is let go at the click, not played', async () => {
  const gate = new VoiceUnlock();
  const { play, calls } = fakePlayer(1);
  const r = recorder();
  let wanted = true;
  playOrHold(play, gate, { ...r.handlers, stillWanted: () => wanted });
  await flush();
  wanted = false;
  gate.unlock();
  assert.equal(calls.length, 1);
  assert.deepEqual(r.events, ['held', 'dropped']);
  assert.equal(gate.isHeld, false);
});

test('a held sentence that is stopped is released, and an old token releases nothing', async () => {
  const gate = new VoiceUnlock();
  const { play } = fakePlayer(5);
  const r = recorder();
  playOrHold(play, gate, r.handlers);
  await flush();
  const token = r.token!;
  gate.release(token + 99);
  assert.equal(gate.isHeld, true);
  gate.release(token);
  assert.equal(gate.isHeld, false);
  assert.equal(gate.unlock(), false);
});

test('the gate listens for a click or key anywhere only while something is held', async () => {
  const target = new EventTarget();
  const gate = new VoiceUnlock(target);
  const { play, calls } = fakePlayer(1);
  const r = recorder();

  // Nothing held: a click does nothing.
  target.dispatchEvent(new Event('click'));
  assert.equal(calls.length, 0);

  playOrHold(play, gate, r.handlers);
  await flush();
  assert.ok(GESTURE_EVENTS.includes('keydown'));
  target.dispatchEvent(new Event('keydown'));
  assert.equal(calls.length, 2);
  await flush();
  assert.deepEqual(r.events, ['held', 'playing']);

  // Released: the listeners are gone.
  target.dispatchEvent(new Event('click'));
  assert.equal(calls.length, 2);
});
