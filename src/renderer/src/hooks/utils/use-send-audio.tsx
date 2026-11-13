import { useCallback } from "react";
import { useWebSocket } from "@/context/websocket-context";
import { useMediaCapture } from "@/hooks/utils/use-media-capture";
import type { MicReport } from "@/services/mic-report";

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
    (audio: Float32Array, again = false) => {
      // `again`: a check after the first of one stretch (Virgil, 2026-11-06).
      sendMessage({ type: "voice-probe", audio: Array.from(audio), ...(again ? { again: true } : {}) });
    },
    [sendMessage],
  );

  // Speech the page heard and kept from the server, and why (Virgil, 2026-10-27): he was
  // not stopping Virgil by talking over it, and the server's log could not say whether he
  // had been heard at all. Never audio - only how loud it was, the
  // threshold in force, how long it ran, and whether Virgil was talking.
  const reportHeldBack = useCallback(
    (report: {
      why: string; loudestDb: number; thresholdDb: number | null;
      virgilTalking: boolean; seconds: number;
    }) => {
      sendMessage({
        type: "speech-held-back",
        why: report.why,
        loudest_db: Math.round(report.loudestDb),
        threshold_db: report.thresholdDb,
        virgil_talking: report.virgilTalking,
        seconds: Math.round(report.seconds * 10) / 10,
      });
    },
    [sendMessage],
  );

  // His speech has started (Virgil OLV1-34, 2026-11-01): a sentence of his the server holds
  // as unfinished waits while he says the rest, instead of being answered alone. Never
  // audio, never a turn, never a stop.
  const sendSpeechStart = useCallback(() => {
    sendMessage({ type: "speech-start" });
  }, [sendMessage]);

  // What the browser did to his microphone (Virgil OLV7-16, 2026-11-13): sent once each
  // time the microphone starts. Switches and numbers only (services/mic-report.ts).
  const reportMic = useCallback((report: MicReport | null) => {
    if (report) sendMessage(report);
  }, [sendMessage]);

  return {
    sendAudioPartition,
    sendVoiceProbe,
    reportHeldBack,
    sendSpeechStart,
    reportMic,
  };
}
