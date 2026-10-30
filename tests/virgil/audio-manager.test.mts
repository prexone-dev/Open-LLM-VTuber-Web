// A stop ends the sentence's task itself (Virgil, OLV1-33): the queue waits for the
// sentence in flight, so it must not hang on the browser firing `error`.
// Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioManager } from '../../src/renderer/src/utils/audio-manager.ts';

function fakeAudio() {
  return { paused: false, src: 'data:audio/mp3;base64,AA', pause() { this.paused = true; }, load() {} };
}

test('stopping the sentence ends its task at once, once', () => {
  const audio = fakeAudio();
  let ended = 0;
  audioManager.setCurrentAudio(audio as unknown as HTMLAudioElement, null, () => { ended += 1; });
  audioManager.stopCurrentAudioAndLipSync();
  assert.equal(ended, 1);
  assert.equal(audio.paused, true);
  assert.equal(audioManager.hasCurrentAudio(), false);
  audioManager.stopCurrentAudioAndLipSync();
  assert.equal(ended, 1);
});

test('a sentence that ended by itself is not ended again by a later stop', () => {
  const audio = fakeAudio();
  let ended = 0;
  audioManager.setCurrentAudio(audio as unknown as HTMLAudioElement, null, () => { ended += 1; });
  audioManager.clearCurrentAudio(audio as unknown as HTMLAudioElement);
  audioManager.stopCurrentAudioAndLipSync();
  assert.equal(ended, 0);
});
