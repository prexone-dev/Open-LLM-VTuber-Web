import { useCallback } from "react";
import { useWebSocket } from "@/context/websocket-context";
import { useMediaCapture } from "@/hooks/utils/use-media-capture";

export function useSendAudio() {
  const { sendMessage } = useWebSocket();
  const { captureAllMedia } = useMediaCapture();

  const sendAudioPartition = useCallback(
    async (audio: Float32Array) => {
      const chunkSize = 4096;

      // Send the audio data in chunks
      for (let index = 0; index < audio.length; index += chunkSize) {
        const endIndex = Math.min(index + chunkSize, audio.length);
        const chunk = audio.slice(index, endIndex);
        sendMessage({
          type: "mic-audio-data",
          audio: Array.from(chunk),
          // Only send images with first chunk
        });
      }

      // Send end signal after all chunks
      const images = await captureAllMedia();
      sendMessage({ type: "mic-audio-end", images });
    },
    [sendMessage, captureAllMedia],
  );

  // The first moments of his speech while Virgil talks, for the server to check his voice
  // early and stop Virgil at once (Virgil, 2026-10-13). Never a turn: the whole stretch
  // still goes by sendAudioPartition when he stops.
  const sendVoiceProbe = useCallback(
    (audio: Float32Array) => {
      sendMessage({ type: "voice-probe", audio: Array.from(audio) });
    },
    [sendMessage],
  );

  return {
    sendAudioPartition,
    sendVoiceProbe,
  };
}
