/**
 * Whether the page shows the Reachy instead of the Live2D avatar (Virgil, OLV7-32).
 *
 * One setting on the server's /settings page picks it (`reachy_body.show_in_page`);
 * the avatar stays whenever the setting is off or no robot answers, so a
 * simulator that is closed brings the avatar back on its own, and one that is
 * started brings the robot - asked every few seconds, no refresh needed.
 */
import { useEffect, useState } from 'react';

export const REACHY_VIEW_POLL_MS = 4000;

export interface ReachyViewAnswer {
  show?: boolean;
  answering?: boolean;
}

/** The server's answer, read: show the robot only when both are true. */
export function showsReachy(answer: ReachyViewAnswer | null | undefined): boolean {
  return Boolean(answer && answer.show === true && answer.answering === true);
}

export function useReachyMode(baseUrl: string): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const base = baseUrl.replace(/\/$/, '');
    const ask = async () => {
      try {
        const response = await fetch(`${base}/api/reachy/view`, { cache: 'no-store' });
        // A server from before the setting existed answers 404: the avatar.
        const answer = response.ok ? await response.json() : null;
        if (!stopped) setActive(showsReachy(answer));
      } catch {
        // The server is not there; keep what is shown until it answers.
      }
      if (!stopped) timer = setTimeout(ask, REACHY_VIEW_POLL_MS);
    };
    ask();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [baseUrl]);

  return active;
}
