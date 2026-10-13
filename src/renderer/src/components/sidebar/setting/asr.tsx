/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react/require-default-props */
import { Flex, Stack, Text } from '@chakra-ui/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { settingStyles } from './setting-styles';
import { useASRSettings } from '@/hooks/sidebar/setting/use-asr-settings';
import { SwitchField, NumberField, HelpIcon } from './common';
import { VoiceMeter } from './voice-meter';
import { thresholdInForce, VOICE_THRESHOLD_OFF } from '@/services/voice-gate';

interface ASRProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

function ASR({ onSave, onCancel }: ASRProps): JSX.Element {
  const { t } = useTranslation();
  const {
    localSettings,
    autoStopMic,
    autoStartMicOn,
    autoStartMicOnConvEnd,
    setAutoStopMic,
    setAutoStartMicOn,
    setAutoStartMicOnConvEnd,
    handleInputChange,
    handleSave,
    handleCancel,
    lastHeardDb,
    readLiveLevelDb,
    micOn,
  } = useASRSettings();

  useEffect(() => {
    if (!onSave || !onCancel) return;

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);

    return (): void => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [onSave, onCancel, handleSave, handleCancel]);

  return (
    <Stack {...settingStyles.common.container}>
      <SwitchField
        label={t('settings.asr.autoStopMic')}
        checked={autoStopMic}
        onChange={setAutoStopMic}
      />

      <SwitchField
        label={t('settings.asr.autoStartMicOnConvEnd')}
        checked={autoStartMicOnConvEnd}
        onChange={setAutoStartMicOnConvEnd}
      />

      <SwitchField
        label={t('settings.asr.autoStartMicOn')}
        checked={autoStartMicOn}
        onChange={setAutoStartMicOn}
      />

      {/* Full width, label above: a level bar squeezed into the value column is too short
          to read or drag (Virgil, 2026-10-12). */}
      <Stack gap="2" width="100%">
        <Flex align="center">
          <Text {...settingStyles.common.fieldLabel}>{t('settings.asr.voiceThreshold')}</Text>
          <HelpIcon
            content={`${t('settings.asr.voiceThresholdDesc')} ${
              lastHeardDb === null
                ? t('settings.asr.voiceThresholdNothingHeard')
                : t('settings.asr.voiceThresholdLastHeard', { db: lastHeardDb })
            }`}
          />
        </Flex>
        <VoiceMeter
          thresholdDb={thresholdInForce(localSettings.voiceThresholdDb) ?? VOICE_THRESHOLD_OFF}
          onChange={(db) => handleInputChange('voiceThresholdDb', db)}
          readLevel={readLiveLevelDb}
          micOn={micOn}
        />
      </Stack>

      <NumberField
        label={t('settings.asr.positiveSpeechThreshold')}
        help={t('settings.asr.positiveSpeechThresholdDesc')}
        value={localSettings.positiveSpeechThreshold}
        onChange={(value) => handleInputChange('positiveSpeechThreshold', value)}
        min={1}
        max={100}
      />

      <NumberField
        label={t('settings.asr.negativeSpeechThreshold')}
        help={t('settings.asr.negativeSpeechThresholdDesc')}
        value={localSettings.negativeSpeechThreshold}
        onChange={(value) => handleInputChange('negativeSpeechThreshold', value)}
        min={0}
        max={100}
      />

      <NumberField
        label={t('settings.asr.redemptionFrames')}
        help={t('settings.asr.redemptionFramesDesc')}
        value={localSettings.redemptionFrames}
        onChange={(value) => handleInputChange('redemptionFrames', value)}
        min={1}
        max={100}
      />
    </Stack>
  );
}

export default ASR;
