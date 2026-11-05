// Each turn tells the server how many sentences started while his tab was
// hidden (Virgil, OLV1-33). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HiddenPlay } from '../../src/renderer/src/services/hidden-play.ts';

function fakeDocument(initial: 'visible' | 'hidden' = 'visible') {
  let state: string = initial;
  const listeners: Array<() => void> = [];
  return {
    get visibilityState() { return state; },
    addEventListener(_type: 'visibilitychange', fn: () => void) { listeners.push(fn); },
    set(next: 'visible' | 'hidden') {
      state = next;
      listeners.forEach((fn) => fn());
    },
  };
}

test('a visible turn reports nothing hidden', () => {
  const doc = fakeDocument();
  const hp = new HiddenPlay(doc);
  hp.noteStarted();
  hp.noteStarted();
  assert.deepEqual(hp.take(), { started: 2, started_hidden: 0, was_hidden: false });
});

test('sentences started while hidden are counted', () => {
  const doc = fakeDocument();
  const hp = new HiddenPlay(doc);
  hp.noteStarted();
  doc.set('hidden');
  hp.noteStarted();
  hp.noteStarted();
  assert.deepEqual(hp.take(), { started: 3, started_hidden: 2, was_hidden: true });
});

test('hidden and shown again before any sentence still reads was_hidden', () => {
  const doc = fakeDocument();
  const hp = new HiddenPlay(doc);
  doc.set('hidden');
  doc.set('visible');
  hp.noteStarted();
  assert.deepEqual(hp.take(), { started: 1, started_hidden: 0, was_hidden: true });
});

test('take starts the next turn afresh, keeping a tab that is still hidden', () => {
  const doc = fakeDocument();
  const hp = new HiddenPlay(doc);
  doc.set('hidden');
  hp.noteStarted();
  hp.take();
  assert.deepEqual(hp.take(), { started: 0, started_hidden: 0, was_hidden: true });
  doc.set('visible');
  hp.take();
  assert.deepEqual(hp.take(), { started: 0, started_hidden: 0, was_hidden: false });
});

test('an interrupted turn never reports into the next one', () => {
  const doc = fakeDocument();
  const hp = new HiddenPlay(doc);
  doc.set('hidden');
  hp.noteStarted();
  hp.noteStarted();
  doc.set('visible');
  // He cut that turn off: no take(). The next turn starts.
  hp.startTurn();
  hp.noteStarted();
  assert.deepEqual(hp.take(), { started: 1, started_hidden: 0, was_hidden: false });
});

test('a tab hidden while idle is not this turn once the turn starts visible', () => {
  const doc = fakeDocument();
  const hp = new HiddenPlay(doc);
  doc.set('hidden');
  doc.set('visible');
  hp.startTurn();
  hp.noteStarted();
  assert.equal(hp.take().was_hidden, false);
});

test('a page loaded hidden counts as hidden', () => {
  const hp = new HiddenPlay(fakeDocument('hidden'));
  assert.equal(hp.take().was_hidden, true);
});

test('with no document it counts and never claims hidden', () => {
  const hp = new HiddenPlay(null);
  hp.noteStarted();
  assert.deepEqual(hp.take(), { started: 1, started_hidden: 0, was_hidden: false });
});
