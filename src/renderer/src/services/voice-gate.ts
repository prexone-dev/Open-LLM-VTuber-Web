// The voice threshold (Virgil, 2026-10-12): "I need a voice threshold setting. Virgil is
// hearing himself even on a conservative volume."
//
// The speech detector only says how sure it is that a sound is speech, never how loud it
// is - so Virgil's own voice coming back from the speakers counts as speech exactly as his
// does, and it interrupts itself and answers itself. Echo only exists while Virgil is
// talking, so the threshold applies then: a sound has to be at least this loud to cut
// Virgil off and be heard. Corrected the same evening: it applies all the time, because a
// video or a call plays out of the same speakers while Virgil is quiet too; his voice up
// close is louder than anything the speakers make. The level of everything heard is shown
// beside the setting to set it by.
//
// The browser's own gain control is always on (the speech detector forces it), so levels
// drift a little over time; the "last heard" reading is what to set it by.

/** The setting's lowest value, and what it means: off, everything counts. */
export const VOICE_THRESHOLD_OFF = -70;

/** Quieter than this is silence; a level never reads lower. */
const FLOOR_DB = -100;

/** How loud a stretch of audio is, in dB below full scale (0 is as loud as it gets). */
export function levelDb(samples: Float32Array): number {
  if (!samples || samples.length === 0) return FLOOR_DB;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return FLOOR_DB;
  return Math.max(FLOOR_DB, 20 * Math.log10(rms));
}

/**
 * The loudest frame of one stretch of speech. The loudest, not the average: the
 * average is pulled down by the pauses between words, and a near voice and a far echo
 * differ most at their peaks.
 */
export class LoudnessTracker {
  private loudestDb = FLOOR_DB;

  reset(): void {
    this.loudestDb = FLOOR_DB;
  }

  add(frame: Float32Array): void {
    const db = levelDb(frame);
    if (db > this.loudestDb) this.loudestDb = db;
  }

  get loudest(): number {
    return this.loudestDb;
  }
}

/**
 * The threshold in force, or null for off. Anything that is not a finite number - an
 * emptied or half-typed field saved as text - is off: `Number('')` is 0, which would
 * otherwise hold back every word while Virgil talks (architecture review, 2026-10-12).
 */
export function thresholdInForce(thresholdDb: unknown): number | null {
  if (typeof thresholdDb !== 'number' || !Number.isFinite(thresholdDb)) return null;
  return thresholdDb <= VOICE_THRESHOLD_OFF ? null : thresholdDb;
}

/** Is this speech loud enough to be him while Virgil talks. */
export function loudEnough(loudestDb: number, thresholdDb: unknown): boolean {
  const threshold = thresholdInForce(thresholdDb);
  return threshold === null || loudestDb >= threshold;
}

/** When speech is confirmed: cut Virgil off, hold it back as Virgil's echo, or neither. */
export function atRealStart(
  virgilSpeaking: boolean,
  loudestDb: number,
  thresholdDb: unknown,
): 'interrupt' | 'hold' | 'none' {
  if (!virgilSpeaking) return 'none';
  return loudEnough(loudestDb, thresholdDb) ? 'interrupt' : 'hold';
}

/** While held back: has it grown loud enough to be him - cut Virgil off now. */
export function grewLoudEnough(
  held: boolean,
  loudestDb: number,
  thresholdDb: unknown,
): boolean {
  return held && loudEnough(loudestDb, thresholdDb);
}

/**
 * When speech ends: send it, or drop it as sound from the speakers. Always, not only while
 * Virgil talks - his correction, 2026-10-12: "the people that interrupted had the same volume
 * or less than Virgil. They were all on the same speakers." A video playing while Virgil is
 * quiet comes out of the same speakers, so his voice up close is the only loud thing.
 */
export function atSpeechEnd(
  _virgilSpeaking: boolean,
  loudestDb: number,
  thresholdDb: unknown,
): 'send' | 'drop' {
  return loudEnough(loudestDb, thresholdDb) ? 'send' : 'drop';
}

/** The meter's scale, like Discord's input sensitivity bar: quietest to loudest shown. */
export const METER_MIN_DB = VOICE_THRESHOLD_OFF;
export const METER_MAX_DB = 0;

/** Where a level sits along the meter, 0 at the left to 1 at the right. */
export function dbToFraction(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const fraction = (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);
  return Math.min(1, Math.max(0, fraction));
}

/** The threshold a point on the meter means, rounded to a whole dB, never above -5. */
export function fractionToDb(fraction: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const db = Math.round(METER_MIN_DB + clamped * (METER_MAX_DB - METER_MIN_DB));
  return Math.min(-5, db);
}

/** How fast the meter falls back after a loud sound: dB per animation frame (~60 a second). */
export const METER_FALL_DB_PER_FRAME = 1.2;

/**
 * One step of the meter: it rises to a louder level at once and falls back gently, as
 * Discord's does; null (mic off) shows nothing. An unchanged level returns the same value,
 * so the meter skips a render.
 */
export function meterStep(previous: number | null, level: number | null): number | null {
  if (level === null) return null;
  if (previous === null || level >= previous) return level;
  return Math.max(level, previous - METER_FALL_DB_PER_FRAME);
}
