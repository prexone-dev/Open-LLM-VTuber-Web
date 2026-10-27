// Virgil turns itself down the moment he starts talking (Virgil, 2026-10-27). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUCK_LIMIT_MS, DUCKED_VOLUME, VoiceDuck } from '../../src/renderer/src/services/voice-duck.ts';

function fakeTimer() {
  const due: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  return {
    due,
    set: (fn: () => void, ms: number) => { const t = { fn, ms, live: true }; due.push(t); return t; },
    clear: (t: unknown) => { (t as { live: boolean }).live = false; },
    fire: () => { for (const t of due) if (t.live) { t.live = false; t.fn(); } },
  };
}

test('his speech turns the sentence now playing down at once', () => {
  const duck = new VoiceDuck(fakeTimer());
  const audio = { volume: 1 };
  duck.playing(audio);
  duck.duck();
  assert.equal(audio.volume, DUCKED_VOLUME);
});

test('the next sentence of the reply starts turned down while he is checked', () => {
  const duck = new VoiceDuck(fakeTimer());
  duck.playing({ volume: 1 });
  duck.duck();
  duck.playing(null);
  const next = { volume: 1 };
  duck.playing(next);
  assert.equal(next.volume, DUCKED_VOLUME);
});

test('judged not his, Virgil comes back up', () => {
  const duck = new VoiceDuck(fakeTimer());
  const audio = { volume: 1 };
  duck.playing(audio);
  duck.duck();
  duck.release();
  assert.equal(audio.volume, 1);
  assert.equal(duck.isDucked, false);
});

test('a duck nobody answers lets go by itself', () => {
  const timer = fakeTimer();
  const duck = new VoiceDuck(timer);
  const audio = { volume: 1 };
  duck.playing(audio);
  duck.duck();
  assert.equal(timer.due[0].ms, DUCK_LIMIT_MS);
  timer.fire();
  assert.equal(audio.volume, 1);
});

test('stopped, nothing is turned back up and the next reply starts at full volume', () => {
  const timer = fakeTimer();
  const duck = new VoiceDuck(timer);
  const audio = { volume: 1 };
  duck.playing(audio);
  duck.duck();
  duck.stopped();
  timer.fire();
  assert.equal(audio.volume, DUCKED_VOLUME);
  const next = { volume: 1 };
  duck.playing(next);
  assert.equal(next.volume, 1);
});

test('ducking again restarts the limit instead of stacking timers', () => {
  const timer = fakeTimer();
  const duck = new VoiceDuck(timer);
  duck.playing({ volume: 1 });
  duck.duck();
  duck.duck();
  assert.equal(timer.due.filter((t) => t.live).length, 1);
});

test('stopped with nothing playing, the reply to his turn starts at full volume', () => {
  // Architecture review, 2026-10-27: he was confirmed between two sentences, so no sentence
  // was playing when Virgil was stopped, and the duck carried into the reply to his turn.
  const duck = new VoiceDuck(fakeTimer());
  duck.playing({ volume: 1 });
  duck.duck();
  duck.playing(null);
  duck.stopped();
  const reply = { volume: 1 };
  duck.playing(reply);
  assert.equal(reply.volume, 1);
});
