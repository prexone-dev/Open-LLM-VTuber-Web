// The voice threshold (Virgil, 2026-10-12). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atRealStart,
  atSpeechEnd,
  grewLoudEnough,
  levelDb,
  LoudnessTracker,
  thresholdInForce,
  VOICE_THRESHOLD_OFF,
} from '../../src/renderer/src/services/voice-gate.ts';

function tone(amplitude: number, length = 512): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = amplitude * Math.sin(i / 3);
  return out;
}

const ECHO = levelDb(tone(0.02));
const HIM = levelDb(tone(0.3));
const THRESHOLD = -25;

test('louder audio reads higher, full scale near 0 dB, silence at the floor', () => {
  assert.ok(levelDb(tone(0.5)) > levelDb(tone(0.05)));
  assert.ok(Math.abs(levelDb(tone(1)) - -3) < 1);
  assert.equal(levelDb(new Float32Array(512)), -100);
  assert.equal(levelDb(new Float32Array(0)), -100);
});

test('the loudest frame of a stretch is what counts, not the pauses', () => {
  const tracker = new LoudnessTracker();
  tracker.add(tone(0.01));
  tracker.add(tone(0.3));
  tracker.add(new Float32Array(512));
  assert.ok(Math.abs(tracker.loudest - HIM) < 0.001);
  tracker.reset();
  assert.equal(tracker.loudest, -100);
});

test('while Virgil talks, a quiet echo is held and dropped; his near voice cuts in and is sent', () => {
  assert.equal(atRealStart(true, ECHO, THRESHOLD), 'hold');
  assert.equal(atSpeechEnd(true, ECHO, THRESHOLD), 'drop');
  assert.equal(atRealStart(true, HIM, THRESHOLD), 'interrupt');
  assert.equal(atSpeechEnd(true, HIM, THRESHOLD), 'send');
});

test('speech that starts quiet and grows loud cuts Virgil off as soon as it is loud enough', () => {
  assert.equal(atRealStart(true, ECHO, THRESHOLD), 'hold');
  assert.equal(grewLoudEnough(true, ECHO, THRESHOLD), false);
  assert.equal(grewLoudEnough(true, HIM, THRESHOLD), true);
  assert.equal(grewLoudEnough(false, HIM, THRESHOLD), false);
});

test('when Virgil is quiet the speakers are held back too, and he still gets through', () => {
  // His correction, 2026-10-12: the other voices came out of the same speakers as Virgil.
  assert.equal(atRealStart(false, -80, -20), 'none');
  assert.equal(atSpeechEnd(false, ECHO, THRESHOLD), 'drop');
  assert.equal(atSpeechEnd(false, HIM, THRESHOLD), 'send');
});

test('off, not set, emptied or half typed holds nothing back', () => {
  for (const setting of [VOICE_THRESHOLD_OFF, -90, undefined, '', '-', NaN, null]) {
    assert.equal(thresholdInForce(setting), null, String(setting));
    assert.equal(atSpeechEnd(true, -95, setting), 'send', String(setting));
  }
  assert.equal(thresholdInForce(-30), -30);
});

test('the meter maps levels to the bar and back, clamped at both ends', async () => {
  const { dbToFraction, fractionToDb, METER_MIN_DB } = await import(
    '../../src/renderer/src/services/voice-gate.ts'
  );
  assert.equal(dbToFraction(METER_MIN_DB), 0);
  assert.equal(dbToFraction(0), 1);
  assert.equal(dbToFraction(-200), 0);
  assert.equal(dbToFraction(10), 1);
  assert.equal(dbToFraction(NaN), 0);
  assert.equal(fractionToDb(0), METER_MIN_DB);
  assert.equal(fractionToDb(0.5), -35);
  assert.equal(fractionToDb(1), -5);
  assert.equal(fractionToDb(dbToFraction(-30)), -30);
});

test('the meter rises at once and falls back gently, and shows nothing with the mic off', async () => {
  const { meterStep, METER_FALL_DB_PER_FRAME } = await import(
    '../../src/renderer/src/services/voice-gate.ts'
  );
  assert.equal(meterStep(-40, null), null);
  assert.equal(meterStep(null, -40), -40);
  assert.equal(meterStep(-40, -20), -20);
  assert.equal(meterStep(-20, -60), -20 - METER_FALL_DB_PER_FRAME);
  assert.equal(meterStep(-20, -20.5), -20.5);
  assert.equal(meterStep(-30, -30), -30);
});
