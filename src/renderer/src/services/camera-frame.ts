// The picture Virgil sees from his camera and his screen (Virgil, OLV1-25).
//
// 2026-10-14, at his desk: he held a photo up to the camera and Virgil said the writing
// was too small and blurry to read. It was right - upstream opened the camera asking
// for 320x240, so every frame the model saw had ordinary print two or three pixels
// tall. The camera is now asked for a wide HD picture. The server shrinks each frame
// to what the model reads best (about a megapixel, `vision_frames.py` in Virgil), so
// asking for more here costs nothing on the model's side.
//
// LANDSCAPE, ASKED FOR IN SO MANY WORDS: his camera (an Insta360 Link 2) has its
// portrait mode switched on, and he keeps it on because he streams. Asked only for a
// width and height, the browser may pick a 9:16 mode; an aspect ratio of 16:9 makes it
// pick (or crop to) a wide one, so only the avatar's view is wide and the camera keeps
// every mode it has.

export const CAMERA_WIDTH = 1920;
export const CAMERA_HEIGHT = 1080;

/**
 * The JPEG quality a frame is sent at: 0.92, not upstream's 0.8. A frame is compressed
 * here and, when the server shrinks it to what the model reads best, compressed again (at
 * 90, `vision_frames.py` in Virgil); at 0.8 the first pass already blurs the edges of small
 * print, which is the thing he holds up to be read. A 1920x1080 frame at 0.92 is a few
 * hundred kilobytes, sent only on a turn, to his own server.
 */
export const FRAME_JPEG_QUALITY = 0.92;

/** What the page asks the camera for: this size, and this shape. */
export function cameraConstraints(
  width: number = CAMERA_WIDTH,
  height: number = CAMERA_HEIGHT,
): MediaTrackConstraints {
  return {
    width: { ideal: width },
    height: { ideal: height },
    aspectRatio: { ideal: width / height },
  };
}

/**
 * The size a frame is drawn at: no wider than `maxWidth`, keeping its shape, in whole
 * pixels. A frame already narrower is kept as it is - enlarging adds no detail.
 */
export function frameSize(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  if (!(maxWidth > 0) || width <= maxWidth) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  return {
    width: Math.round(maxWidth),
    height: Math.max(1, Math.round((maxWidth / width) * height)),
  };
}

// HIS SCREEN, AND THE PAGE HE IS ON (Virgil, OLV1-25). His words, 2026-10-04: "For the
// avatar to be able to use my camera, my screen, and whatever website I'm on, we need to
// make sure those are hooked up." "Whatever website I'm on" is a shared browser tab: the
// browser's own picker offers a tab, a window or a whole screen.

/** How sharp a shared screen is captured in the desktop app: up to 4K, never enlarged. */
export const SCREEN_MAX_WIDTH = 3840;
export const SCREEN_MAX_HEIGHT = 2160;

/** The options Chrome reads beyond the typed ones; other browsers ignore them. */
export interface ScreenShareOptions extends DisplayMediaStreamOptions {
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  preferCurrentTab?: boolean;
}

/**
 * What the browser is asked for when he shares his screen. Video only, at the screen's
 * own size (no size is asked, so none is imposed). The avatar's own tab is left out of
 * the picker - a picture of Virgil's page shows Virgil nothing - and while a tab is
 * shared the browser offers "share this tab instead", so moving to another page moves
 * what Virgil sees with him.
 */
export function screenShareOptions(): ScreenShareOptions {
  return {
    video: true,
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    preferCurrentTab: false,
  };
}

/**
 * The desktop app's screen capture (Electron's desktop source). Upstream pinned it to
 * exactly 1280x720 with a minimum and a maximum, so a 2560x1440 screen reached Virgil at
 * half its size and a screen of any other shape was stretched. Only a ceiling now.
 */
export function electronScreenConstraints(sourceId: string): Record<string, unknown> {
  return {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxWidth: SCREEN_MAX_WIDTH,
      maxHeight: SCREEN_MAX_HEIGHT,
    },
  };
}

/** The part of a MediaStream this needs - so a test can hand it a stand-in. */
interface TrackLike {
  readonly readyState: string;
  addEventListener(type: 'ended', listener: () => void): void;
  removeEventListener(type: 'ended', listener: () => void): void;
}
interface StreamLike {
  getVideoTracks(): TrackLike[];
}

/**
 * Call `onEnded` once when the stream's picture stops from outside the page - he presses
 * the browser's own "Stop sharing", closes the shared window, or the camera is unplugged.
 * Upstream never listened, so the page went on showing the share as on, and every turn
 * after it tried to take a picture from a dead stream and put up a capture error.
 * Returns a function that stops listening (for when the page stops the stream itself).
 */
export function whenPictureStops(stream: StreamLike, onEnded: () => void): () => void {
  const tracks = stream.getVideoTracks();
  let done = false;
  const detach = () => {
    tracks.forEach((track) => track.removeEventListener('ended', listener));
  };
  function listener() {
    if (done) return;
    done = true;
    detach();
    onEnded();
  }
  if (tracks.length > 0 && tracks.every((track) => track.readyState === 'ended')) {
    listener();
    return () => {};
  }
  tracks.forEach((track) => track.addEventListener('ended', listener));
  return () => {
    done = true;
    detach();
  };
}
