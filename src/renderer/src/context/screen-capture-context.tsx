import { createContext, useContext, useRef, useState, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toaster } from "@/components/ui/toaster";
import {
  electronScreenConstraints,
  screenShareOptions,
  whenPictureStops,
} from '@/services/camera-frame';

interface ScreenCaptureContextType {
  stream: MediaStream | null;
  isStreaming: boolean;
  error: string;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
}

const ScreenCaptureContext = createContext<ScreenCaptureContextType | undefined>(undefined);

export function ScreenCaptureProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');

  // Virgil (OLV1-25): stops listening for the browser's own "Stop sharing" (camera-frame.ts).
  const stopListeningRef = useRef<() => void>(() => {});

  const startCapture = async () => {
    try {
      let mediaStream: MediaStream;

      if (window.electron) {
        const sourceId = await window.electron.ipcRenderer.invoke('get-screen-capture');

        // Virgil (OLV1-25): the screen's own size up to 4K, not upstream's fixed 1280x720.
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: electronScreenConstraints(sourceId) as MediaTrackConstraints,
          audio: false,
        });
      } else {
        mediaStream = await navigator.mediaDevices.getDisplayMedia(screenShareOptions());
      }

      // Virgil (OLV1-25): when he stops sharing from the browser's own bar, the page
      // stops too, instead of showing the share as on and failing on every turn.
      stopListeningRef.current();
      stopListeningRef.current = whenPictureStops(mediaStream, () => {
        mediaStream.getTracks().forEach((track) => track.stop());
        setStream((current) => (current === mediaStream ? null : current));
        setIsStreaming(false);
      });

      setStream(mediaStream);
      setIsStreaming(true);
      setError('');
    } catch (err) {
      setError(t('error.failedStartScreenCapture'));
      toaster.create({
        title: `${t('error.failedStartScreenCapture')}: ${err}`,
        type: 'error',
        duration: 2000,
      });
      console.error(err);
    }
  };

  const stopCapture = () => {
    stopListeningRef.current();
    stopListeningRef.current = () => {};
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      setIsStreaming(false);
    }
  };

  return (
    <ScreenCaptureContext.Provider
      // eslint-disable-next-line react/jsx-no-constructed-context-values
      value={{
        stream,
        isStreaming,
        error,
        startCapture,
        stopCapture,
      }}
    >
      {children}
    </ScreenCaptureContext.Provider>
  );
}

export const useScreenCaptureContext = () => {
  const context = useContext(ScreenCaptureContext);
  if (context === undefined) {
    throw new Error('useScreenCaptureContext must be used within a ScreenCaptureProvider');
  }
  return context;
};
