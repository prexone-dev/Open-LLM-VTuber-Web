import { useAiState } from '@/context/ai-state-context';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useSubtitle } from '@/context/subtitle-context';
import { useAudioTask } from './use-audio-task';

export const useInterrupt = () => {
  const { aiState, setAiState } = useAiState();
  const { sendMessage } = useWebSocket();
  const { fullResponse, clearResponse } = useChatHistory();
  // const { currentModel } = useLive2DModel();
  const { subtitleText, setSubtitleText } = useSubtitle();
  const { stopCurrentAudioAndLipSync } = useAudioTask();

  const interrupt = (sendSignal = true) => {
    if (aiState !== 'thinking-speaking') {
      // Virgil (OLV1-33): the queue now waits for the sentence in flight, so a sentence
      // still playing (or held for a click) while the state reads otherwise is stopped
      // here too, or it would hold everything behind it.
      if (audioTaskQueue.hasTask()) {
        stopCurrentAudioAndLipSync();
        audioTaskQueue.clearQueue();
      }
      return;
    }
    console.log('Interrupting conversation chain');

    stopCurrentAudioAndLipSync();

    audioTaskQueue.clearQueue();

    setAiState('interrupted');

    if (sendSignal) {
      sendMessage({
        type: 'interrupt-signal',
        text: fullResponse,
      });
    }

    clearResponse();

    if (subtitleText === 'Thinking...') {
      setSubtitleText('');
    }
    console.log('Interrupted!');
  };

  return { interrupt };
};
