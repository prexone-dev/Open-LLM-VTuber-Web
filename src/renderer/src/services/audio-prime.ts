/**
 * Let Virgil start a sentence while his tab is hidden (Virgil, OLV1-33).
 *
 * Chrome holds media loading in a background tab until the tab is shown
 * again, unless the page has already played sound. Measured 2026-11-03 in
 * Chrome, with the tab really hidden: a page that had played nothing never
 * got as far as loading a new sentence while hidden, so every sentence waited
 * and the lot came out when he came back. A page that had played anything,
 * even 0.1 s of silence, loaded and played three sentences back to back while
 * still hidden.
 *
 * So the page plays one short silent clip as early as the browser allows: at
 * start-up if autoplay is permitted, otherwise inside his first click, key
 * press or touch anywhere on the page. This is the usual way pages unlock
 * sound (Howler.js plays a silent buffer on the first gesture for the same
 * reason). It happens once; nothing is heard.
 */
// A relative '.ts' path, not '@/services/voice-unlock': `npm run test:virgil` runs this
// file under plain node, which knows neither the '@/' alias nor an extensionless import.
import { GESTURE_EVENTS, isAutoplayRefusal } from './voice-unlock.ts';

interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: () => void, options?: boolean | EventListenerOptions): void
}

/** Anything with play(), so tests can stand in for an Audio element. */
export interface Playable {
  play(): Promise<unknown> | undefined
}

/** A WAV file of silence: 8-bit mono PCM, where the value 128 is silence. */
export function silentWavDataUrl(seconds = 0.1, sampleRate = 8000): string {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) bytes[offset + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export class AudioPrime {
  private state: 'idle' | 'trying' | 'waiting' | 'primed' | 'failed' = 'idle';

  private armed = false;

  private readonly onGesture = () => { this.attempt(); };

  private readonly makePlayable: () => Playable;

  private readonly target: GestureTarget | null;

  constructor(makePlayable: () => Playable, target: GestureTarget | null) {
    this.makePlayable = makePlayable;
    this.target = target;
  }

  /** True once the page has played its silent clip. */
  get primed(): boolean {
    return this.state === 'primed';
  }

  /** Try now; if the browser wants a gesture first, try again at his first one. */
  start(): void {
    if (this.state !== 'idle') return;
    this.attempt();
  }

  private attempt(): void {
    if (this.state === 'primed' || this.state === 'failed' || this.state === 'trying') return;
    this.state = 'trying';
    let result: Promise<unknown> | undefined;
    try {
      result = this.makePlayable().play();
    } catch (err) {
      this.fail(err);
      return;
    }
    if (!result || typeof result.then !== 'function') {
      this.succeed();
      return;
    }
    result.then(
      () => this.succeed(),
      (err) => {
        if (isAutoplayRefusal(err)) {
          // Not allowed yet: his first click, key or touch will be.
          this.state = 'waiting';
          this.arm();
          return;
        }
        this.fail(err);
      },
    );
  }

  private succeed(): void {
    this.state = 'primed';
    this.disarm();
  }

  private fail(err: unknown): void {
    // Not fatal: sentences still play while the tab is shown, as before.
    console.warn('[AudioPrime] The silent clip could not be played; a hidden tab may hold the voice until it is shown.', err);
    this.state = 'failed';
    this.disarm();
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

/** The page's one primer. `audioPrime.start()` is called once at start-up. */
export const audioPrime = new AudioPrime(
  () => new Audio(silentWavDataUrl()),
  typeof document !== 'undefined' ? document : null,
);
