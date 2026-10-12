// The page talks back to the server it came from (Virgil, OLV5-18). Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addressFor,
  usableFromHere,
  UPSTREAM_ADDRESS,
} from '../../src/renderer/src/services/server-address.ts';

const mac = { protocol: 'http:', host: '127.0.0.1:12393', hostname: '127.0.0.1' };
const homeDoor = {
  protocol: 'https:',
  host: 'studio.local:12443',
  hostname: 'studio.local',
};

test('on the machine Virgil runs on, the address is the same as before', () => {
  assert.deepEqual(addressFor(mac), UPSTREAM_ADDRESS);
});

test('from another computer, the page talks to the computer it came from, securely', () => {
  assert.deepEqual(addressFor(homeDoor), {
    wsUrl: 'wss://studio.local:12443/client-ws',
    baseUrl: 'https://studio.local:12443',
  });
});

test('the desktop app and the development server keep upstream\'s address', () => {
  assert.deepEqual(
    addressFor({ protocol: 'file:', host: '', hostname: '' }),
    UPSTREAM_ADDRESS,
  );
  assert.deepEqual(
    addressFor({ protocol: 'http:', host: 'localhost:5173', hostname: 'localhost' }, true),
    UPSTREAM_ADDRESS,
  );
  assert.deepEqual(addressFor(undefined), UPSTREAM_ADDRESS);
});

test('a saved address for this computer is not used from another computer', () => {
  const fallback = addressFor(homeDoor).wsUrl;
  assert.equal(usableFromHere('ws://127.0.0.1:12393/client-ws', fallback, homeDoor), fallback);
  assert.equal(usableFromHere('ws://localhost:12393/client-ws', fallback, homeDoor), fallback);
  assert.equal(usableFromHere('ws://[::1]:12393/client-ws', fallback, homeDoor), fallback);
});

test('a plain address is not used on a secure page, which would refuse it', () => {
  const fallback = addressFor(homeDoor).wsUrl;
  assert.equal(usableFromHere('ws://studio.local:12393/client-ws', fallback, homeDoor), fallback);
});

test('what he saved is kept when it still works from here', () => {
  assert.equal(
    usableFromHere('ws://127.0.0.1:12393/client-ws', 'x', mac),
    'ws://127.0.0.1:12393/client-ws',
  );
  assert.equal(
    usableFromHere('wss://studio.local:12443/client-ws', 'x', homeDoor),
    'wss://studio.local:12443/client-ws',
  );
  assert.equal(usableFromHere('', 'fallback', homeDoor), 'fallback');
  assert.equal(usableFromHere('not a url', 'fallback', homeDoor), 'fallback');
});
