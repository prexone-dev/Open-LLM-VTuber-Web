// The early voice check (Virgil, 2026-10-13): "there is an excessivelly long pause now between
// when I begin to speak and Virgil recognizes I have interupted".
//
// While voice ID knows his voice the page never cuts Virgil off by itself - his voice, checked
// on the server, does that, so Virgil's own echo and other people cannot. But the page sent his
// speech only when he stopped talking, so Virgil kept talking over his whole sentence and the
// silence after it. Now, while Virgil talks, the first moments of his speech are sent on their
// own as soon as there is enough to judge (the server needs a second; it gets a little more),
// and the server stops Virgil the moment it hears him. The turn itself is still sent whole when
// he stops, as before. Nothing here starts a turn or is transcribed.

/** The speech detector's sample rate. */
export const PROBE_SAMPLE_RATE = 16000;

/** How much of his speech is sent to be checked early: a little over the server's one-second
 * minimum (`voice_id.MIN_JUDGE_SECONDS`), so a short frame never leaves it just under. */
export const PROBE_SECONDS = 1.2;

export const PROBE_SAMPLES = Math.round(PROBE_SECONDS * PROBE_SAMPLE_RATE);

/**
 * One stretch of speech's early check. `start` at each speech start says whether this stretch
 * is checked early at all (voice ID on and Virgil talking); `add` takes each frame and gives
 * back the samples to send - once, when there are enough - and `null` otherwise.
 */
export class VoiceProbe {
  private frames: Float32Array[] = [];

  private gathered = 0;

  private armed = false;

  /** Enough gathered, waiting only to be loud enough to send. */
  private ready: Float32Array | null = null;

  /** Sent for this stretch, waiting on the server's verdict. */
  sent = false;

  /** The server said it is his: this stretch is a turn of his, as without voice ID. */
  confirmed = false;

  start(armed: boolean): void {
    this.frames = [];
    this.gathered = 0;
    this.ready = null;
    this.armed = armed;
    this.sent = false;
    this.confirmed = false;
  }

  /** Speech ended or was a misfire: nothing more is gathered for it. */
  stop(): void {
    this.frames = [];
    this.gathered = 0;
    this.ready = null;
    this.armed = false;
  }

  /**
   * `loudEnough`: whether the stretch so far passes the voice threshold. Quieter than that is
   * Virgil's own voice from the speakers by his setting, and is never sent; the first moments
   * are kept and sent the moment the stretch grows loud enough.
   */
  add(frame: Float32Array, loudEnough = true): Float32Array | null {
    if (!this.armed || this.sent) return null;
    if (!this.ready && frame && frame.length > 0) {
      // A copy: the detector may reuse its frame buffer.
      this.frames.push(frame.slice());
      this.gathered += frame.length;
      if (this.gathered >= PROBE_SAMPLES) {
        const out = new Float32Array(PROBE_SAMPLES);
        let at = 0;
        for (const f of this.frames) {
          const take = Math.min(f.length, PROBE_SAMPLES - at);
          out.set(f.subarray(0, take), at);
          at += take;
          if (at >= PROBE_SAMPLES) break;
        }
        this.frames = [];
        this.ready = out;
      }
    }
    if (!this.ready || !loudEnough) return null;
    const out = this.ready;
    this.ready = null;
    this.sent = true;
    return out;
  }

  /** The server's verdict on what was sent. True when the page should stop Virgil now. */
  verdict(allowed: boolean): boolean {
    if (!this.sent || this.confirmed || !allowed) return false;
    this.confirmed = true;
    return true;
  }
}
