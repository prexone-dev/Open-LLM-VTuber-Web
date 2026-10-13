// The live voice meter beside the voice threshold (Virgil, 2026-10-12): "it would be nice
// if I had a reactive sound threshold bar like discord has so I can visually adjust the
// threshold". The bar moves with the mic as he speaks and as Virgil's echo comes back; the
// line across it is the threshold, and clicking or dragging on the bar moves it. Sound
// above the line shows green - while Virgil talks, that is what counts as him.
import { Box, Flex, Text } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  dbToFraction, fractionToDb, meterStep, thresholdInForce, VOICE_THRESHOLD_OFF,
} from '@/services/voice-gate';

interface VoiceMeterProps {
  /** The threshold as set (the saved or the edited value), in dB. */
  thresholdDb: number;
  /** A new threshold from a click or a drag on the bar. */
  onChange: (db: number) => void;
  /** The mic's level now, or null when the mic is off. */
  readLevel: () => number | null;
  micOn: boolean;
}

export function VoiceMeter({
  thresholdDb, onChange, readLevel, micOn,
}: VoiceMeterProps): JSX.Element {
  const { t } = useTranslation();
  const [shownDb, setShownDb] = useState<number | null>(null);
  const shownRef = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  // The bar follows the mic, rising at once and falling back gently, as Discord's does.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const previous = shownRef.current;
      const next = meterStep(previous, readLevel());
      if (next !== previous) {
        shownRef.current = next;
        setShownDb(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [readLevel]);

  const setFromPointer = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const box = bar.getBoundingClientRect();
    if (box.width <= 0) return;
    onChange(fractionToDb((clientX - box.left) / box.width));
  };

  const threshold = thresholdInForce(thresholdDb);
  const level = shownDb ?? VOICE_THRESHOLD_OFF - 30;
  const above = threshold === null || level >= threshold;
  const fill = shownDb === null ? 0 : dbToFraction(level);
  const line = dbToFraction(thresholdDb);
  const label = threshold === null
    ? t('settings.asr.voiceThresholdOff')
    : t('settings.asr.voiceThresholdAt', { db: thresholdDb });
  const step = (db: number) => onChange(Math.min(-5, Math.max(VOICE_THRESHOLD_OFF, db)));

  return (
    <Box width="100%">
      <Box
        ref={barRef}
        position="relative"
        height="16px"
        borderRadius="8px"
        bg="whiteAlpha.200"
        cursor="pointer"
        overflow="hidden"
        touchAction="none"
        role="slider"
        aria-label={t('settings.asr.voiceThreshold')}
        aria-valuemin={VOICE_THRESHOLD_OFF}
        aria-valuemax={-5}
        aria-valuenow={thresholdDb}
        aria-valuetext={label}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          // Only while a button is held: a drag that lost its release must not stick.
          if (dragging.current && (e.buttons & 1)) setFromPointer(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onLostPointerCapture={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          const keys: Record<string, number> = {
            ArrowLeft: thresholdDb - 1,
            ArrowDown: thresholdDb - 1,
            ArrowRight: thresholdDb + 1,
            ArrowUp: thresholdDb + 1,
            Home: VOICE_THRESHOLD_OFF,
            End: -5,
          };
          if (e.key in keys) {
            e.preventDefault();
            step(keys[e.key]);
          }
        }}
      >
        <Box
          position="absolute"
          left="0"
          top="0"
          bottom="0"
          width={`${fill * 100}%`}
          bg={above ? 'green.400' : 'yellow.500'}
          transition="background-color 0.1s"
        />
        <Box
          position="absolute"
          top="0"
          bottom="0"
          left={`calc(${line * 100}% - 2px)`}
          width="4px"
          bg="white"
          borderRadius="2px"
          boxShadow="0 0 3px rgba(0,0,0,0.6)"
        />
      </Box>
      <Flex justify="space-between" mt="1">
        <Text fontSize="xs" color="whiteAlpha.700">
          {label}
        </Text>
        <Text fontSize="xs" color="whiteAlpha.700">
          {micOn
            ? t('settings.asr.voiceMeterNow', { db: shownDb === null ? '-' : Math.round(level) })
            : t('settings.asr.voiceMeterMicOff')}
        </Text>
      </Flex>
    </Box>
  );
}

export default VoiceMeter;
