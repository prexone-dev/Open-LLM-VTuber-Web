/**
 * The page keeps its own connection to the server (Virgil, OLV7-31).
 *
 * 2026-10-06: the page loaded while the server was still starting its tool
 * servers, got no model and sat blank until someone clicked "reconnect". The
 * server now answers `GET /api/ready` - 200 once a page opened then would get
 * the agent and a model, 503 before - and the page waits for it, and tries
 * again on its own whenever the server is not there or goes away.
 */

/** How long to wait between tries, growing from the first to the last. */
export const RETRY_DELAYS_MS = [1000, 2000, 3000, 5000];

/** The delay before retry number `attempt` (0-based): grows, then stays at the last. */
export function retryDelay(attempt: number): number {
  const at = Math.min(Math.max(Math.floor(attempt) || 0, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[at];
}

/**
 * The server's readiness address for a socket address:
 * `ws://host:port/client-ws` -> `http://host:port/api/ready`. Null when the
 * address cannot be read.
 */
export function readyUrlFor(wsUrl: string): string | null {
  try {
    const url = new URL(wsUrl);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    else if (url.protocol === 'wss:') url.protocol = 'https:';
    else return null;
    url.pathname = '/api/ready';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Whether to open the socket now. Only an explicit "not ready" (503) holds the
 * socket back: a server from before the endpoint existed (404), or an answer
 * that cannot be read, lets the socket try, and a server that is not there at
 * all fails the socket, which is then retried.
 */
export async function serverReady(
  wsUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<boolean> {
  const readyUrl = readyUrlFor(wsUrl);
  if (!readyUrl) return true;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(readyUrl, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    return response.status !== 503;
  } catch {
    // Not answering, or not reachable from here: the socket finds out which.
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A session that came up without a model to draw - the blank page of
 * 2026-10-08 - is one the page should leave and try again.
 */
export function lacksModel(modelInfo: { url?: string } | null | undefined): boolean {
  return !modelInfo || typeof modelInfo.url !== 'string' || !modelInfo.url
    || modelInfo.url.includes('undefined');
}

export type SocketState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';

/** The part of a browser WebSocket the keeper uses. */
export interface SocketLike {
  onopen: ((ev: unknown) => unknown) | null;
  onmessage: ((ev: { data: unknown }) => unknown) | null;
  onclose: ((ev: unknown) => unknown) | null;
  onerror: ((ev: unknown) => unknown) | null;
  readyState: number;
  send(data: string): void;
  close(): void;
}

export interface KeeperDeps {
  createSocket: (url: string) => SocketLike;
  ready: (url: string) => Promise<boolean>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onState: (state: SocketState) => void;
  onOpen: () => void;
  onData: (data: unknown) => void;
}

/**
 * Keeps one socket open to the address it was given: waits for the server to
 * say it is ready, opens, and when the socket fails or closes tries again on
 * its own (1, 2, 3, then every 5 seconds) until `disconnect()`. While it is
 * trying it reports CONNECTING, so the page never shows "click to reconnect"
 * for a server that is only starting or restarting.
 */
export class ConnectionKeeper {
  private socket: SocketLike | null = null;

  private wantedUrl: string | null = null;

  /** Bumped by connect/disconnect/reconnectSoon, so a stale try or socket stands down. */
  private generation = 0;

  private attempt = 0;

  private timer: unknown = null;

  private state: SocketState = 'CLOSED';

  private readonly deps: KeeperDeps;

  constructor(deps: KeeperDeps) {
    this.deps = deps;
  }

  get current(): SocketState {
    return this.state;
  }

  get openSocket(): SocketLike | null {
    return this.state === 'OPEN' ? this.socket : null;
  }

  connect(url: string): void {
    this.stopTimer();
    this.dropSocket();
    this.generation += 1;
    this.wantedUrl = url;
    this.attempt = 0;
    this.tryNow(this.generation);
  }

  /** Leave this session and try again shortly: it came up without what the page needs. */
  reconnectSoon(): void {
    if (!this.wantedUrl) return;
    this.stopTimer();
    this.dropSocket();
    this.generation += 1;
    this.later(this.generation);
  }

  /** Close on purpose: nothing retries until connect() is called again. */
  disconnect(): void {
    this.stopTimer();
    this.generation += 1;
    this.wantedUrl = null;
    this.dropSocket();
    this.setState('CLOSED');
  }

  private setState(state: SocketState): void {
    if (state === this.state) return;
    this.state = state;
    this.deps.onState(state);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private dropSocket(): void {
    const old = this.socket;
    this.socket = null;
    if (!old) return;
    old.onopen = null;
    old.onmessage = null;
    old.onclose = null;
    old.onerror = null;
    try {
      old.close();
    } catch {
      // already closed
    }
  }

  private later(generation: number): void {
    if (generation !== this.generation || !this.wantedUrl) return;
    this.stopTimer();
    this.setState('CONNECTING');
    const delay = retryDelay(this.attempt);
    this.attempt += 1;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.tryNow(generation);
    }, delay);
  }

  private async tryNow(generation: number): Promise<void> {
    const url = this.wantedUrl;
    if (!url || generation !== this.generation) return;
    this.setState('CONNECTING');

    let ready = true;
    try {
      ready = await this.deps.ready(url);
    } catch {
      ready = true;
    }
    if (generation !== this.generation) return;
    if (!ready) {
      this.later(generation);
      return;
    }

    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(url);
    } catch {
      this.later(generation);
      return;
    }
    this.socket = socket;
    const mine = () => generation === this.generation && this.socket === socket;

    socket.onopen = () => {
      if (!mine()) return;
      this.attempt = 0;
      this.setState('OPEN');
      this.deps.onOpen();
    };
    socket.onmessage = (event) => {
      if (mine()) this.deps.onData(event.data);
    };
    const lost = () => {
      if (!mine()) return;
      this.socket = null;
      // Straight back to trying: the page shows "connecting", never "click to reconnect".
      this.later(generation);
    };
    socket.onclose = lost;
    socket.onerror = lost;
  }
}
