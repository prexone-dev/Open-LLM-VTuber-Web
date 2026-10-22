// The picture Virgil sees (Virgil, OLV1-25). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraConstraints, frameSize } from '../../src/renderer/src/services/camera-frame.ts';

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
