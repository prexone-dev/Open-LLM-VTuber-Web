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
