// Virgil turns itself down the moment he starts talking (Virgil, 2026-10-27).
//
// That night he reported that shouting at Virgil to stop did not stop it. Since voice ID (2026-10-13) the page no longer cuts Virgil off by itself when speech
// starts - his voice, checked on the server, does that, so Virgil's own echo cannot. But the
// check needs 1.2 s of his speech first (`voice-probe.ts`), it often judges the start of his
// speech mixed with Virgil's echo as Virgil's (the Mac's log, 10-15 to 10-27: 121 refused as
// "closer to Virgil's own voice", 80 as "not his voice"), and when it does Virgil talks on
// until he has finished and been quiet for another second - one such night, a whole sentence
// of his telling it to stop was heard before anything stopped.
//
// What smart speakers do: the moment speech is heard, the assistant's own playback drops to
// a murmur, and only then is it decided whether the speech was the user's. Here: speech
// confirmed while Virgil talks ducks Virgil at once; his voice confirmed stops it (as
// before); anything else - his speech judged not his, a misfire, Virgil's echo dropped -
// brings the volume back. Turning Virgil down also takes most of its echo out of what the
// check hears. A duck left with no answer lets go by itself after `DUCK_LIMIT_MS`.

/** How loud Virgil plays while ducked: about 16 dB down, still heard, no longer talking over him. */
export const DUCKED_VOLUME = 0.15;

/** A duck with no verdict lets go after this long, so Virgil is never left murmuring. */
export const DUCK_LIMIT_MS = 8000;

interface Playable {
  volume: number;
}

type Timer = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

const REAL_TIMER: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class VoiceDuck {
  private ducked = false;

  private current: Playable | null = null;

  private limit: unknown = null;

  private readonly timer: Timer;

  // A plain field, not a parameter property: the page's tests run with type stripping only.
  constructor(timer: Timer = REAL_TIMER) {
    this.timer = timer;
  }

  get isDucked(): boolean {
    return this.ducked;
  }

  /** The sentence now playing; it starts ducked when a duck is on (the next sentence of a reply). */
  playing(audio: Playable | null): void {
    this.current = audio;
    if (audio) audio.volume = this.ducked ? DUCKED_VOLUME : 1;
  }

  /** Speech heard while Virgil talks: down at once, until a verdict or the limit. */
  duck(): void {
    this.ducked = true;
    if (this.current) this.current.volume = DUCKED_VOLUME;
    if (this.limit !== null) this.timer.clear(this.limit);
    this.limit = this.timer.set(() => this.release(), DUCK_LIMIT_MS);
  }

  /** Not him, or nothing decided in time: back to full volume. */
  release(): void {
    if (this.limit !== null) this.timer.clear(this.limit);
    this.limit = null;
    if (!this.ducked) return;
    this.ducked = false;
    if (this.current) this.current.volume = 1;
  }

  /** Virgil was stopped: nothing is left to bring back. */
  stopped(): void {
    if (this.limit !== null) this.timer.clear(this.limit);
    this.limit = null;
    this.ducked = false;
    this.current = null;
  }
}

export const voiceDuck = new VoiceDuck();
