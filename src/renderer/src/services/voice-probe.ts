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
//
// Checked again while he keeps talking (2026-11-06): "It won't recognize while I'm still
// talking. It waits for me to finish my sentence ... The timing is terrible." One check of the
// first second, mixed with Virgil's own voice from the speakers, scored closer to Virgil
// (14:00:19, 14:03:31 on the Mac) and nothing looked again until his whole sentence - which then
// scored his plainly. Now each further second of his speech sends the latest few seconds again,
// until one is his or he stops - one check out at a time, the next only once the server has
// answered the last, so checks never queue up ahead of his turn (architecture review, same day).

/** The speech detector's sample rate. */
export const PROBE_SAMPLE_RATE = 16000;

/** How much of his speech is sent to be checked early: a little over the server's one-second
 * minimum (`voice_id.MIN_JUDGE_SECONDS`), so a short frame never leaves it just under. */
export const PROBE_SECONDS = 1.2;

export const PROBE_SAMPLES = Math.round(PROBE_SECONDS * PROBE_SAMPLE_RATE);

/** While Virgil is not yet stopped, another check goes after each this much more of his speech. */
export const PROBE_AGAIN_SECONDS = 1.0;

export const PROBE_AGAIN_SAMPLES = Math.round(PROBE_AGAIN_SECONDS * PROBE_SAMPLE_RATE);

/** How much of the latest speech a check after the first carries: the most the server looks at
 * (`conversation_handler.PROBE_MAX_SECONDS`). */
export const PROBE_WINDOW_SECONDS = 3.0;

export const PROBE_WINDOW_SAMPLES = Math.round(PROBE_WINDOW_SECONDS * PROBE_SAMPLE_RATE);

/** The most checks after the first for one stretch: ten seconds of talk. Past that it is not
 * him cutting in (a television, a visitor), and his finished stretch is judged as before. */
export const PROBE_MAX_AGAIN = 10;

/** An answer not back after this much more speech is taken as lost, so one dropped message
 * never stops the checks for the rest of the stretch. */
export const PROBE_ANSWER_LOST_SECONDS = 3.0;

export const PROBE_ANSWER_LOST_SAMPLES = Math.round(PROBE_ANSWER_LOST_SECONDS * PROBE_SAMPLE_RATE);

/** One check to send: the samples, and whether it is one after the first of its stretch. */
export interface ProbeCheck {
  samples: Float32Array;
  again: boolean;
}

/**
 * One stretch of speech's early check. `start` at each speech start says whether this stretch
 * is checked early at all (voice ID on and Virgil talking); `add` takes each frame and gives
 * back the check to send - the first 1.2 s when there are enough, then the latest 3 s after
 * each further second, once the last is answered (`answered`), until his voice is confirmed -
 * and `null` otherwise.
 */
export class VoiceProbe {
  private frames: Float32Array[] = [];

  private gathered = 0;

  private armed = false;

  /** Enough gathered, waiting only to be loud enough to send. */
  private ready: Float32Array | null = null;

  /** The latest frames of this stretch, at most `PROBE_WINDOW_SAMPLES`. */
  private recent: Float32Array[] = [];

  private recentSamples = 0;

  /** Speech gathered since the last check went. */
  private sinceSent = 0;

  /** The first check of this stretch went. */
  sent = false;

  /** A check is out and the server has not answered it yet. */
  awaiting = false;

  /** How many checks after the first went for this stretch. */
  private agains = 0;

  /** The server said it is his: this stretch is a turn of his, as without voice ID. */
  confirmed = false;

  start(armed: boolean): void {
    this.frames = [];
    this.gathered = 0;
    this.ready = null;
    this.armed = armed;
    this.sent = false;
    this.confirmed = false;
    this.recent = [];
    this.recentSamples = 0;
    this.sinceSent = 0;
    this.awaiting = false;
    this.agains = 0;
  }

  /** Speech ended or was a misfire: nothing more is gathered for it. */
  stop(): void {
    this.frames = [];
    this.gathered = 0;
    this.ready = null;
    this.armed = false;
    this.recent = [];
    this.recentSamples = 0;
    this.sinceSent = 0;
  }

  /**
   * `loudEnough`: whether the stretch so far passes the voice threshold. Quieter than that is
   * Virgil's own voice from the speakers by his setting, and is never sent; the first moments
   * are kept and sent the moment the stretch grows loud enough.
   */
  add(frame: Float32Array, loudEnough = true): ProbeCheck | null {
    if (!this.armed || this.confirmed) return null;
    if (frame && frame.length > 0) {
      // A copy: the detector may reuse its frame buffer.
      const copy = frame.slice();
      this.keepRecent(copy);
      if (this.sent) this.sinceSent += copy.length;
      if (!this.sent && !this.ready) {
        this.frames.push(copy);
        this.gathered += copy.length;
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
    }
    if (!this.sent) {
      if (!this.ready || !loudEnough) return null;
      const out = this.ready;
      this.ready = null;
      return this.went(out, false);
    }
    // Not his yet: look again at the latest seconds once he has said more and the last check
    // is answered (or its answer is long enough overdue to be lost).
    if (this.agains >= PROBE_MAX_AGAIN || !loudEnough) return null;
    if (this.sinceSent < PROBE_AGAIN_SAMPLES) return null;
    if (this.awaiting && this.sinceSent < PROBE_ANSWER_LOST_SAMPLES) return null;
    this.agains += 1;
    return this.went(this.latest(), true);
  }

  /** The server answered the check that is out. */
  answered(): void {
    this.awaiting = false;
  }

  private went(samples: Float32Array, again: boolean): ProbeCheck {
    this.sent = true;
    this.awaiting = true;
    this.sinceSent = 0;
    return { samples, again };
  }

  private keepRecent(copy: Float32Array): void {
    this.recent.push(copy);
    this.recentSamples += copy.length;
    while (this.recent.length > 1 && this.recentSamples - this.recent[0].length >= PROBE_WINDOW_SAMPLES) {
      this.recentSamples -= this.recent[0].length;
      this.recent.shift();
    }
  }

  /** The latest speech, at most `PROBE_WINDOW_SAMPLES`, in order. */
  private latest(): Float32Array {
    const size = Math.min(this.recentSamples, PROBE_WINDOW_SAMPLES);
    const out = new Float32Array(size);
    let skip = this.recentSamples - size;
    let at = 0;
    for (const f of this.recent) {
      const from = Math.min(skip, f.length);
      skip -= from;
      const part = f.subarray(from);
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  /**
   * Whether the page, stopping Virgil on the early check, sends the server its own interrupt
   * with what he heard. Exactly when the server did not already stop and record the reply
   * (`stopped: false`): it had finished generating and only the page was still playing it, so
   * nobody else records the cut and the memory would keep the whole reply as heard
   * (architecture review, 2026-10-13). A server that does not say is taken to have stopped it,
   * as before the field existed, so the cut is never recorded twice.
   */
  static pageRecordsTheCut(verdict: { stopped?: boolean }): boolean {
    return verdict.stopped === false;
  }

  /** The server's verdict on what was sent. True when the page should stop Virgil now. */
  verdict(allowed: boolean): boolean {
    this.answered();
    if (!this.sent || this.confirmed || !allowed) return false;
    this.confirmed = true;
    return true;
  }
}
