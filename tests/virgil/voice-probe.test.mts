// The early voice check (Virgil, 2026-10-13): "there is an excessivelly long pause now between
// when I begin to speak and Virgil recognizes I have interupted". Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROBE_AGAIN_SAMPLES, PROBE_ANSWER_LOST_SAMPLES, PROBE_MAX_AGAIN, PROBE_SAMPLES,
  PROBE_SAMPLE_RATE, PROBE_SECONDS, PROBE_WINDOW_SAMPLES, VoiceProbe,
} from '../../src/renderer/src/services/voice-probe.ts';

/** The speech detector's frame: 512 samples, 32 ms. */
const FRAME = 512;

function frame(value: number): Float32Array {
  return new Float32Array(FRAME).fill(value);
}

/** Feed frames until the probe gives a check back; how many frames that took, the samples and
 * whether it was a later check. The server's answer to any check before is taken as given. */
function feedUntilSent(probe: VoiceProbe, loudEnough = () => true, limit = 500) {
  probe.answered();
  for (let n = 1; n <= limit; n += 1) {
    const check = probe.add(frame(n), loudEnough());
    if (check) return { frames: n, out: check.samples, again: check.again };
  }
  return { frames: -1, out: null, again: false };
}

test('the probe is a little over the server minimum of one second', () => {
  assert.ok(PROBE_SECONDS >= 1.0);
  assert.equal(PROBE_SAMPLES, Math.round(PROBE_SECONDS * PROBE_SAMPLE_RATE));
});

test('the first check goes as soon as 1.2 s of speech is gathered - not at the end of the sentence', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  const { frames, out, again } = feedUntilSent(probe);
  assert.equal(frames, Math.ceil(PROBE_SAMPLES / FRAME));
  assert.equal(out!.length, PROBE_SAMPLES);
  // The first moments, in order.
  assert.equal(out![0], 1);
  assert.equal(out![FRAME], 2);
  const seconds = (frames * FRAME) / PROBE_SAMPLE_RATE;
  assert.ok(seconds < 1.25, `sent after ${seconds} s of speech`);
  assert.equal(again, false);
});

// 2026-11-06: "It won't recognize while I'm still talking. It waits for me to finish my
// sentence." The first second, mixed with Virgil's voice, scored closer to Virgil, and nothing
// looked again until his whole sentence arrived.
test('while he keeps talking and is not confirmed, the latest speech is checked again each second', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  const first = feedUntilSent(probe);
  const second = feedUntilSent(probe);
  assert.equal(second.frames, Math.ceil(PROBE_AGAIN_SAMPLES / FRAME));
  assert.equal(second.again, true);
  // Everything heard so far (under 3 s), in order, ending with the newest frame.
  const heard = first.frames + second.frames;
  assert.equal(second.out!.length, heard * FRAME);
  assert.equal(second.out![0], 1);
  assert.equal(second.out![second.out!.length - 1], second.frames);
  // Later on, only the latest 3 s.
  let late = feedUntilSent(probe);
  for (let n = 0; n < 3; n += 1) late = feedUntilSent(probe);
  assert.ok(late.out!.length <= PROBE_WINDOW_SAMPLES + FRAME);
  assert.ok(late.out!.length >= PROBE_WINDOW_SAMPLES);
  assert.equal(late.out![late.out!.length - 1], late.frames);
});

test('once his voice is confirmed, nothing more is sent for the stretch', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  feedUntilSent(probe);
  assert.equal(probe.verdict(true), true);
  assert.equal(feedUntilSent(probe).out, null);
});

test('a check after the first still waits for speech loud enough to be him', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  feedUntilSent(probe);
  assert.equal(feedUntilSent(probe, () => false, 200).out, null);
  assert.equal(probe.add(frame(5), true)?.again, true);
});

// Architecture review, 2026-11-06: the server takes one message at a time, so checks sent
// faster than it answers would queue up ahead of his turn.
test('a later check waits for the answer to the last', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  feedUntilSent(probe);
  // No answer: nothing more until the answer is long overdue.
  let frames = 0;
  let check = null;
  while (!check && frames < 500) {
    frames += 1;
    check = probe.add(frame(frames), true);
  }
  assert.equal(frames, Math.ceil(PROBE_ANSWER_LOST_SAMPLES / FRAME));
  // Answered: the next goes as soon as he has said a second more.
  const next = feedUntilSent(probe);
  assert.equal(next.frames, Math.ceil(PROBE_AGAIN_SAMPLES / FRAME));
  // An answer that comes once a second is due lets the next go on the next frame.
  for (let n = 0; n < Math.ceil(PROBE_AGAIN_SAMPLES / FRAME) + 5; n += 1) {
    assert.equal(probe.add(frame(1), true), null);
  }
  probe.answered();
  assert.equal(probe.add(frame(1), true)?.again, true);
});

test('his voice confirmed counts as the answer too', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  feedUntilSent(probe);
  assert.equal(probe.awaiting, true);
  probe.verdict(false);
  assert.equal(probe.awaiting, false);
});

test('a stretch is checked again at most ten more times - past that it is not him cutting in', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  feedUntilSent(probe);
  for (let n = 0; n < PROBE_MAX_AGAIN; n += 1) assert.equal(feedUntilSent(probe).again, true);
  assert.equal(feedUntilSent(probe).out, null);
});

test('a new stretch starts again from its own first check', () => {
  const probe = new VoiceProbe();
  probe.start(true);
  feedUntilSent(probe);
  feedUntilSent(probe);
  probe.start(true);
  const { frames, out, again } = feedUntilSent(probe);
  assert.equal(frames, Math.ceil(PROBE_SAMPLES / FRAME));
  assert.equal(out!.length, PROBE_SAMPLES);
  assert.equal(again, false);
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
  const out = probe.add(frame(7), true)?.samples;
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
    out = probe.add(shared, true)?.samples ?? null;
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
