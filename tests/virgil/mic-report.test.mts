// What the browser did to his microphone (Virgil OLV7-16, 2026-11-13). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserName, micReport } from '../../src/renderer/src/services/mic-report.ts';

const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ELECTRON = `${CHROME} Electron/33.0.0`;

test('the browser is named by family, not by the Safari every agent claims', () => {
  assert.equal(browserName(SAFARI), 'Safari');
  assert.equal(browserName(CHROME), 'Chrome');
  assert.equal(browserName(ELECTRON), 'Electron');
  assert.equal(browserName(''), 'unknown');
});

test('what the browser says it applied is reported, switches and numbers only', () => {
  const track = {
    getSettings: () => ({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
      deviceId: 'abc',
      groupId: 'def',
    }),
  };
  assert.deepEqual(micReport(track, SAFARI), {
    type: 'mic-settings',
    echo_cancellation: false,
    noise_suppression: true,
    auto_gain_control: true,
    sample_rate: 48000,
    channel_count: 1,
    browser: 'Safari',
  });
});

test('a setting the browser does not report is unknown, not off', () => {
  const report = micReport({ getSettings: () => ({}) }, CHROME);
  assert.equal(report?.echo_cancellation, null);
  assert.equal(report?.sample_rate, null);
});

test('no track, or a track that throws, never breaks the microphone', () => {
  assert.equal(micReport(undefined, SAFARI).echo_cancellation, null);
  assert.equal(micReport(undefined, SAFARI).browser, 'Safari');
  const report = micReport({ getSettings: () => { throw new Error('gone'); } }, SAFARI);
  assert.equal(report?.echo_cancellation, null);
});
