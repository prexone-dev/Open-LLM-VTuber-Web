// The picture Virgil sees (Virgil, OLV1-25). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_JPEG_QUALITY,
  cameraConstraints,
  electronScreenConstraints,
  frameSize,
  screenShareOptions,
  whenPictureStops,
} from '../../src/renderer/src/services/camera-frame.ts';

function fakeTrack(readyState = 'live') {
  const listeners = new Set<() => void>();
  return {
    readyState,
    listeners,
    addEventListener: (_type: 'ended', fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_type: 'ended', fn: () => void) => { listeners.delete(fn); },
    end() { this.readyState = 'ended'; [...listeners].forEach((fn) => fn()); },
  };
}

test('the camera is asked for a wide HD picture, not 320x240', () => {
  const asked = cameraConstraints() as Record<string, { ideal: number }>;
  assert.equal(asked.width.ideal, 1920);
  assert.equal(asked.height.ideal, 1080);
});

test('the camera is asked for a landscape shape, so a portrait mode is not picked', () => {
  const asked = cameraConstraints() as Record<string, { ideal: number }>;
  assert.ok(asked.aspectRatio.ideal > 1.7 && asked.aspectRatio.ideal < 1.8);
});

test('a frame wider than the cap is shrunk whole, keeping its shape', () => {
  assert.deepEqual(frameSize(2560, 1440, 1920), { width: 1920, height: 1080 });
  assert.deepEqual(frameSize(1920, 1080, 1080), { width: 1080, height: 608 });
});

test('a frame inside the cap is never enlarged', () => {
  assert.deepEqual(frameSize(320, 240, 1920), { width: 320, height: 240 });
});

test('a frame with no size gives an empty one, never NaN', () => {
  assert.deepEqual(frameSize(0, 0, 1920), { width: 0, height: 0 });
});

test('a frame is sent at a JPEG quality that keeps small print, above upstream 0.8', () => {
  assert.ok(FRAME_JPEG_QUALITY > 0.8 && FRAME_JPEG_QUALITY <= 0.95);
});

test('a shared screen is asked for as it is, video only, with the avatar tab left out', () => {
  const asked = screenShareOptions();
  assert.equal(asked.video, true); // no size asked, so none is imposed
  assert.equal(asked.audio, false);
  assert.equal(asked.selfBrowserSurface, 'exclude');
  assert.equal(asked.surfaceSwitching, 'include'); // he can move the share to another tab
});

test('the desktop app captures his screen up to 4K, not pinned to 1280x720', () => {
  const asked = electronScreenConstraints('screen:1:0') as { mandatory: Record<string, unknown> };
  assert.equal(asked.mandatory.chromeMediaSourceId, 'screen:1:0');
  assert.equal(asked.mandatory.maxWidth, 3840);
  assert.equal(asked.mandatory.maxHeight, 2160);
  assert.ok(!('minWidth' in asked.mandatory) && !('minHeight' in asked.mandatory));
});

test('when he presses the browser "Stop sharing", the page is told once', () => {
  const track = fakeTrack();
  let told = 0;
  whenPictureStops({ getVideoTracks: () => [track] }, () => { told += 1; });
  track.end();
  track.end();
  assert.equal(told, 1);
  assert.equal(track.listeners.size, 0);
});

test('a share the page stops itself is not reported as stopped from outside', () => {
  const track = fakeTrack();
  let told = 0;
  const stopListening = whenPictureStops({ getVideoTracks: () => [track] }, () => { told += 1; });
  stopListening();
  track.end();
  assert.equal(told, 0);
  assert.equal(track.listeners.size, 0);
});

test('a picture that had already stopped is reported at once', () => {
  let told = 0;
  whenPictureStops({ getVideoTracks: () => [fakeTrack('ended')] }, () => { told += 1; });
  assert.equal(told, 1);
});
