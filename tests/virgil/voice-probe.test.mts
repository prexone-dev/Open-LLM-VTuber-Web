// The early voice check (Virgil, 2026-10-13): "there is an excessivelly long pause now between
// when I begin to speak and Virgil recognizes I have interupted". Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROBE_SAMPLES, PROBE_SAMPLE_RATE, PROBE_SECONDS, VoiceProbe,
} from '../../src/renderer/src/services/voice-probe.ts';

/** The speech detector's frame: 512 samples, 32 ms. */
const FRAME = 512;

function frame(value: number): Float32Array {
  return new Float32Array(FRAME).fill(value);
}

/** Feed frames until the probe gives something back; how many frames that took. */
function feedUntilSent(probe: VoiceProbe, loudEnough = () => true, limit = 500) {
  for (let n = 1; n <= limit; n += 1) {
    const out = probe.add(frame(n), loudEnough());
    if (out) return { frames: n, out };
  }
  return { frames: -1, out: null };
}

test('the probe is a little over the server minimum of one second', () => {
  assert.ok(PROBE_SECONDS >= 1.0);
  assert.equal(PROBE_SAMPLES, Math.round(PROBE_SECONDS * PROBE_SAMPLE_RATE));
});

test('sent once, as soon as 1.2 s of speech is gathered - not at the end of the sentence', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  const { frames, out } = feedUntilSent(probe);
  assert.equal(frames, Math.ceil(PROBE_SAMPLES / FRAME));
  assert.equal(out!.length, PROBE_SAMPLES);
  // The first moments, in order.
  assert.equal(out![0], 1);
  assert.equal(out![FRAME], 2);
  const seconds = (frames * FRAME) / PROBE_SAMPLE_RATE;
  assert.ok(seconds < 1.25, `sent after ${seconds} s of speech`);
  // Never twice for one stretch.
  for (let n = 0; n < 100; n += 1) assert.equal(probe.add(frame(9)), null);
});

test('not armed - voice ID off or Virgil quiet - nothing is ever sent', () => {
  const probe = new VoiceProbe();
  probe.start(false);
  assert.equal(feedUntilSent(probe).out, null);
});

test('below the voice threshold it waits, and goes the moment the speech is loud enough', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  let loud = false;
  assert.equal(feedUntilSent(probe, () => loud, 100).out, null);
  loud = true;
  const out = probe.add(frame(7), true);
  assert.ok(out);
  // What is sent is still the first moments, not the latest frame.
  assert.equal(out![0], 1);
});

test('speech that ends before there is enough sends nothing, and the next stretch starts fresh', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  for (let n = 0; n < 10; n += 1) assert.equal(probe.add(frame(1)), null);
  probe.stop();
  assert.equal(feedUntilSent(probe).out, null);
  probe.start(true);
  const { frames } = feedUntilSent(probe);
  assert.equal(frames, Math.ceil(PROBE_SAMPLES / FRAME));
});

test("his voice confirmed stops Virgil once; not his, or nothing sent, does nothing", () => {
  const probe = new VoiceProbe();
  probe.start(true);
  assert.equal(probe.verdict(true), false, 'no verdict counts before anything was sent');
  feedUntilSent(probe);
  assert.equal(probe.verdict(false), false);
  assert.equal(probe.confirmed, false);
  assert.equal(probe.verdict(true), true);
  assert.equal(probe.confirmed, true);
  assert.equal(probe.verdict(true), false, 'stopped once');
});

test('a verdict that lands after he stopped talking still stops Virgil; after a new stretch it does not', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  feedUntilSent(probe);
  probe.stop();
  assert.equal(probe.verdict(true), true);
  probe.start(true);
  assert.equal(probe.verdict(true), false);
});

test('frames are copied - a detector that reuses its buffer does not change what is sent', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  const shared = new Float32Array(FRAME);
  let out: Float32Array | null = null;
  for (let n = 1; !out && n < 100; n += 1) {
    shared.fill(n);
    out = probe.add(shared, true);
  }
  assert.equal(out![0], 1);
});

// Architecture review, 2026-10-13: the reply had finished generating and only the page still
// played it, so the server stopped nothing - and the page interrupted without telling it, so
// nobody recorded the cut and the memory kept the whole reply as heard.
test('the page sends what he heard exactly when the server did not stop the reply', () => {
  assert.equal(VoiceProbe.pageRecordsTheCut({ stopped: false }), true);
  assert.equal(VoiceProbe.pageRecordsTheCut({ stopped: true }), false);
});

test('a server that does not say whether it stopped is taken to have stopped it', () => {
  assert.equal(VoiceProbe.pageRecordsTheCut({}), false);
});
