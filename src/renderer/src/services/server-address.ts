// Where the page talks to Virgil's server (Virgil, OLV5-18).
//
// Upstream always pointed the page at ws://127.0.0.1:12393 - this computer. That is
// right only when the page is open on the machine Virgil runs on. Opened from another
// computer in the house (the home door, https://<mac>.local:12443), it would have
// talked to the wrong computer, or to nothing. So a page Virgil's server served talks
// back to wherever it came from; the desktop app (file://) and the development server
// keep upstream's address.

export interface PageLocation {
  protocol: string;
  host: string;
  hostname: string;
}

export interface ServerAddress {
  wsUrl: string;
  baseUrl: string;
}

export const UPSTREAM_ADDRESS: ServerAddress = {
  wsUrl: 'ws://127.0.0.1:12393/client-ws',
  baseUrl: 'http://127.0.0.1:12393',
};

function isThisMachine(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return name === 'localhost' || name === '::1' || name.startsWith('127.');
}

/** The server that served this page, or upstream's address when no server did. */
export function addressFor(
  location: PageLocation | undefined,
  development = false,
): ServerAddress {
  if (development || !location || !/^https?:$/.test(location.protocol)) {
    return UPSTREAM_ADDRESS;
  }
  const secure = location.protocol === 'https:';
  return {
    wsUrl: `${secure ? 'wss' : 'ws'}://${location.host}/client-ws`,
    baseUrl: `${location.protocol}//${location.host}`,
  };
}

/**
 * A saved address the page can still use from here. One saved on this computer's
 * own server (127.0.0.1) is wrong when the page came from another computer, and
 * plain ws:// is refused by a browser on a secure page - either way the address the
 * page came from is used instead. Anything else he typed in settings is kept.
 */
export function usableFromHere(
  saved: string | null | undefined,
  fallback: string,
  location: PageLocation | undefined,
): string {
  if (!saved) return fallback;
  if (!location || !/^https?:$/.test(location.protocol)) return saved;
  let target: URL;
  try {
    target = new URL(saved);
  } catch {
    return fallback;
  }
  if (isThisMachine(target.hostname) && !isThisMachine(location.hostname)) {
    return fallback;
  }
  if (location.protocol === 'https:' && /^(ws|http):$/.test(target.protocol)) {
    return fallback;
  }
  return saved;
}

/** The page's own location, when there is one. */
export function pageLocation(): PageLocation | undefined {
  return typeof window === 'undefined' ? undefined : window.location;
}
