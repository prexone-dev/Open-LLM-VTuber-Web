// What the browser actually did to his microphone (Virgil OLV7-16, 2026-11-13).
//
// His words, 2026-11-12: "If I speak to interrupt him, Virgil doesn't respond to the
// interruption until I stop speaking." The microphone hears Virgil from the speakers mixed
// with him, and the mix sounds more like Virgil. The speech detector asks the browser for
// echo cancellation, but asking is not getting: a browser may refuse it, or cancel only
// sound it played through a call, not through the page's own audio. Nobody could say which.
//
// So once the microphone starts, the page tells the server what the browser says it applied
// - echo cancellation, noise suppression, gain control, rate, channels - and which browser
// it is. Never the device's name, never audio: only switches and numbers.

export interface MicReport {
  type: 'mic-settings';
  echo_cancellation: boolean | null;
  noise_suppression: boolean | null;
  auto_gain_control: boolean | null;
  sample_rate: number | null;
  channel_count: number | null;
  browser: string;
}

/** The browser's family from its user agent: the order matters, every one claims Safari. */
export function browserName(userAgent: string): string {
  const agent = userAgent || '';
  if (/Electron\//.test(agent)) return 'Electron';
  if (/Edg\//.test(agent)) return 'Edge';
  if (/Firefox\//.test(agent)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(agent)) return 'Chrome';
  if (/Safari\//.test(agent)) return 'Safari';
  return 'unknown';
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The report for the microphone's track. With no track to ask, every setting is
 * reported as unknown, so the server's log still says the page tried (architecture
 * review, 2026-11-13: a silent log could not be told from an older page). */
export function micReport(
  track: { getSettings(): object } | undefined | null,
  userAgent: string,
): MicReport {
  let settings: Record<string, unknown> = {};
  try {
    if (track) settings = (track.getSettings() || {}) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  return {
    type: 'mic-settings',
    echo_cancellation: flag(settings.echoCancellation),
    noise_suppression: flag(settings.noiseSuppression),
    auto_gain_control: flag(settings.autoGainControl),
    sample_rate: count(settings.sampleRate),
    channel_count: count(settings.channelCount),
    browser: browserName(userAgent),
  };
}
