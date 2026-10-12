/**
 * The voice is never skipped because the browser refused to play it (Virgil, OLV7-31).
 *
 * 2026-10-11: after a page reload, Safari may refuse to play sound until the
 * page has been clicked. The player only wrote that refusal to the console and
 * moved on, so the words appeared and the voice was silently skipped.
 *
 * Now a refusal (`NotAllowedError` from `audio.play()`) HOLDS the sentence:
 * the queue waits behind it, the page says so in words, and the next click or
 * key press anywhere on the page plays it - inside that click, which is what
 * the browser asks for - and the sentences behind it follow. If the browser
 * refuses again, the sentence is held again and the page says so again.
 * Nothing here decides to drop speech: only an interruption (or the sentence
 * being stopped) releases a held sentence without playing it.
 */

/** What the page shows while a sentence is held. */
export const UNLOCK_MESSAGE = 'Click anywhere to turn the voice back on';

/** Whether a rejection from `audio.play()` is the browser's autoplay refusal. */
export function isAutoplayRefusal(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'NotAllowedError';
}

/** The page events that count as him asking for sound (a user gesture). */
export const GESTURE_EVENTS = ['click', 'keydown', 'touchend'] as const;

interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: () => void, options?: boolean | EventListenerOptions): void
}

type Listener = (held: boolean) => void;

export class VoiceUnlock {
  private held: { token: number; retry: () => void } | null = null;

  private nextToken = 1;

  private listeners = new Set<Listener>();

  private armed = false;

  private readonly onGesture = () => { this.unlock(); };

  private readonly target: GestureTarget | null;

  constructor(target: GestureTarget | null = null) {
    this.target = target;
  }

  /** True while a sentence is waiting for a click. */
  get isHeld(): boolean {
    return this.held !== null;
  }

  /**
   * Hold a refused sentence. `retry` is called, synchronously inside the next
   * gesture, to play it. Returns a token the caller passes to `release` if the
   * sentence is stopped before then.
   */
  hold(retry: () => void): number {
    const token = this.nextToken;
    this.nextToken += 1;
    this.held = { token, retry };
    this.arm();
    this.notify();
    return token;
  }

  /** Let go of a held sentence without playing it (it was stopped or interrupted). */
  release(token: number): void {
    if (!this.held || this.held.token !== token) return;
    this.held = null;
    this.disarm();
    this.notify();
  }

  /**
   * Play the held sentence now. Must be called from inside a user gesture.
   * Returns whether there was anything to play.
   */
  unlock(): boolean {
    const held = this.held;
    if (!held) return false;
    this.held = null;
    this.disarm();
    held.retry();
    // retry may have held it again (the browser refused once more): only say
    // "released" when it did not.
    if (!this.held) this.notify();
    return true;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const held = this.isHeld;
    this.listeners.forEach((listener) => {
      try {
        listener(held);
      } catch (err) {
        console.error('[VoiceUnlock] listener failed:', err);
      }
    });
  }

  private arm(): void {
    if (this.armed || !this.target) return;
    GESTURE_EVENTS.forEach((type) => this.target!.addEventListener(type, this.onGesture, true));
    this.armed = true;
  }

  private disarm(): void {
    if (!this.armed || !this.target) return;
    GESTURE_EVENTS.forEach((type) => this.target!.removeEventListener(type, this.onGesture, true));
    this.armed = false;
  }
}

export interface PlayHandlers {
  /** The browser is playing it. */
  onPlaying: () => void
  /** It cannot be played for a reason other than the autoplay refusal. */
  onFailed: (err: unknown) => void
  /** It was refused and is now held; `token` releases it. Called again on every re-hold. */
  onHeld?: (token: number) => void
  /** Checked before a held sentence is retried: false lets it go unplayed (interrupted). */
  stillWanted?: () => boolean
  /** A held sentence was let go at the click because it is no longer wanted. */
  onDropped?: () => void
}

/**
 * Play, and on the browser's autoplay refusal hold the sentence in `gate`
 * until a gesture plays it. Never drops a refused sentence.
 */
export function playOrHold(
  play: () => Promise<unknown> | undefined,
  gate: VoiceUnlock,
  handlers: PlayHandlers,
): void {
  let attempt: Promise<unknown> | undefined;
  try {
    attempt = play();
  } catch (err) {
    handlers.onFailed(err);
    return;
  }
  // Very old browsers return nothing from play(): nothing to wait for.
  if (!attempt || typeof attempt.then !== 'function') {
    handlers.onPlaying();
    return;
  }
  attempt.then(
    () => handlers.onPlaying(),
    (err) => {
      if (!isAutoplayRefusal(err)) {
        handlers.onFailed(err);
        return;
      }
      console.warn('[VoiceUnlock] The browser refused to play the voice until the page is clicked; holding it.');
      const token = gate.hold(() => {
        if (handlers.stillWanted && !handlers.stillWanted()) {
          handlers.onDropped?.();
          return;
        }
        playOrHold(play, gate, handlers);
      });
      handlers.onHeld?.(token);
    },
  );
}

/** The page's one gate, listening for his click on the whole document. */
export const voiceUnlock = new VoiceUnlock(
  typeof document !== 'undefined' ? document : null,
);
