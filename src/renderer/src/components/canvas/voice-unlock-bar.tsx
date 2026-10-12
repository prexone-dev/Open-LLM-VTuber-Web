import { Box } from '@chakra-ui/react';
import { memo, useEffect, useState } from 'react';
import { UNLOCK_MESSAGE, voiceUnlock } from '@/services/voice-unlock';

/**
 * Virgil (OLV7-31): shown while the browser is refusing to play the voice.
 * Any click or key press on the page plays what was held (the gate listens on
 * the whole document); the bar is just where he is told so.
 */
const VoiceUnlockBar = memo((): JSX.Element | null => {
  const [held, setHeld] = useState(voiceUnlock.isHeld);

  useEffect(() => {
    setHeld(voiceUnlock.isHeld);
    return voiceUnlock.subscribe(setHeld);
  }, []);

  if (!held) return null;

  return (
    <Box
      role="alert"
      position="fixed"
      top="16px"
      left="50%"
      transform="translateX(-50%)"
      zIndex={2000}
      px="18px"
      py="10px"
      borderRadius="999px"
      bg="rgba(20, 20, 28, 0.88)"
      color="white"
      fontSize="15px"
      fontWeight="500"
      boxShadow="0 4px 18px rgba(0, 0, 0, 0.35)"
      cursor="pointer"
      userSelect="none"
    >
      {UNLOCK_MESSAGE}
    </Box>
  );
});

VoiceUnlockBar.displayName = 'VoiceUnlockBar';

export default VoiceUnlockBar;
