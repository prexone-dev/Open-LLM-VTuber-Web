// Voice ID on the page (Virgil, 2026-10-12): Virgil learns his voice once from the page, and the
// server then counts only speech that matches it. This side only gathers the learning speech.

/** How much of his speech the page gathers before sending it to be learned. */
export const LEARN_SECONDS = 12;

/** What he is asked to read while it learns: ordinary sentences, about twelve seconds. */
export const LEARN_PASSAGE =
  "Virgil, this is my voice. I'm reading a few ordinary sentences so you can learn "
  + 'how I sound. Tomorrow I want to check the weather, look over my calendar, and finish '
  + 'the chapter I started last week. When I talk to you, listen to me and nobody else.';

/** The gathered stretches as one run of samples, to send. */
export function joinedSamples(stretches: Float32Array[]): Float32Array {
  const total = stretches.reduce((n, s) => n + s.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const s of stretches) {
    out.set(s, at);
    at += s.length;
  }
  return out;
}
