/**
 * Count what Virgil said while his tab was hidden, and tell the server once a
 * turn (Virgil, OLV1-33).
 *
 * The fix for speaking from a hidden tab (audio-prime.ts) was proved in a test
 * browser, but the server's log could not say whether his own tab was ever
 * hidden, so his own use was the only proof left. With this report, every
 * turn's frontend-playback-complete carries how many sentences started, how
 * many of them started while the page was hidden, and whether the page was
 * hidden at any point during the turn. The server writes that to its log, so
 * "did a hidden tab speak?" is read from the log rather than asked of him.
 *
 * Counts only: no text, nothing he said.
 *
 * 2026-11-12: every hidden turn on the Mac read "0 of 0 started" although the page
 * reported the turn done at speaking pace, so Safari was playing without the
 * play() promise being counted. A sentence now counts as started once, from the
 * promise or the audio element's own `playing` event, whichever comes first; and
 * the report also says how many were held for his click and how many played to
 * their end, so a hidden turn is read from the log without guessing.
 */

/** Where visibility is read from, so tests can stand in for document. */
export interface VisibilitySource {
  readonly visibilityState: string
  addEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface HiddenPlayReport {
  /** Sentences whose sound started this turn. */
  started: number
  /** Of those, how many started while the page was hidden. */
  started_hidden: number
  /** Sentences the browser refused and held for his click (voice-unlock). */
  held: number
  /** Of those, how many were held while the page was hidden. */
  held_hidden: number
  /** Sentences whose sound played to its end. */
  finished: number
  /** The page was hidden at some point since this turn started. */
  was_hidden: boolean
}

export class HiddenPlay {
  private started = 0;

  private startedHidden = 0;

  private held = 0;

  private heldHidden = 0;

  private finished = 0;

  private wasHidden = false;

  // A plain field, not a constructor parameter property: `npm run test:virgil`
  // runs this under node's type stripping, which refuses parameter properties.
  private readonly source: VisibilitySource | null;

  constructor(source: VisibilitySource | null) {
    this.source = source;
    if (!source) return;
    this.wasHidden = this.isHidden();
    source.addEventListener('visibilitychange', () => {
      if (this.isHidden()) this.wasHidden = true;
    });
  }

  private isHidden(): boolean {
    return this.source?.visibilityState === 'hidden';
  }

  /** A sentence's sound has started playing. */
  noteStarted(): void {
    this.started += 1;
    if (this.isHidden()) {
      this.startedHidden += 1;
      this.wasHidden = true;
    }
  }

  /** The browser refused a sentence and it is held for his click. */
  noteHeld(): void {
    this.held += 1;
    if (this.isHidden()) {
      this.heldHidden += 1;
      this.wasHidden = true;
    }
  }

  /** A sentence's sound played to its end. */
  noteFinished(): void {
    this.finished += 1;
  }

  /**
   * A new turn has begun: count from here. A turn he interrupts never reaches
   * take(), so without this its counts, and a tab hidden while idle, would be
   * reported as the next turn's.
   */
  startTurn(): void {
    this.started = 0;
    this.startedHidden = 0;
    this.held = 0;
    this.heldHidden = 0;
    this.finished = 0;
    this.wasHidden = this.isHidden();
  }

  /** This turn's counts; the next turn counts afresh. */
  take(): HiddenPlayReport {
    const report = {
      started: this.started,
      started_hidden: this.startedHidden,
      held: this.held,
      held_hidden: this.heldHidden,
      finished: this.finished,
      was_hidden: this.wasHidden,
    };
    this.startTurn();
    return report;
  }
}

export const hiddenPlay = new HiddenPlay(
  typeof document === 'undefined' ? null : document,
);
