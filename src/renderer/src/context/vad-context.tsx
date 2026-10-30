/* eslint-disable no-use-before-define */
import {
  createContext, useContext, useRef, useCallback, useEffect, useReducer, useMemo, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MicVAD } from '@ricky0123/vad-web';
import { useInterrupt } from '@/components/canvas/live2d';
import { audioTaskQueue } from '@/utils/task-queue';
import { audioManager } from '@/utils/audio-manager';
import { useSendAudio } from '@/hooks/utils/use-send-audio';
import { SubtitleContext } from './subtitle-context';
import { AiStateContext, AiState } from './ai-state-context';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { toaster } from '@/components/ui/toaster';
import {
  LoudnessTracker, MIN_GATED_SAMPLES, atRealStart, atSpeechEnd, gatedAudio,
  grewLoudEnough, levelDb, thresholdInForce, VOICE_THRESHOLD_OFF,
} from '@/services/voice-gate';
import { addressFor, pageLocation } from '@/services/server-address';
import { joinedSamples, LEARN_SECONDS } from '@/services/voice-id';
import { VoiceProbe } from '@/services/voice-probe';

/**
 * VAD settings configuration interface
 * @interface VADSettings
 */
export interface VADSettings {
  /** Threshold for positive speech detection (0-100) */
  positiveSpeechThreshold: number;

  /** Threshold for negative speech detection (0-100) */
  negativeSpeechThreshold: number;

  /** Number of frames for speech redemption */
  redemptionFrames: number;

  /**
   * Voice threshold in dB (Virgil): while Virgil is talking, speech quieter than this is
   * its own voice coming back and is not heard. VOICE_THRESHOLD_OFF (-70) is off.
   * Optional so settings saved before it existed still load.
   */
  voiceThresholdDb?: number;
}

/**
 * VAD context state interface
 * @interface VADState
 */
interface VADState {
  /** Auto stop mic feature state */
  autoStopMic: boolean;

  /** Microphone active state */
  micOn: boolean;

  /** Set microphone state */
  setMicOn: (value: boolean) => void;

  /** Set Auto stop mic state */
  setAutoStopMic: (value: boolean) => void;

  /** Start microphone and VAD */
  startMic: () => Promise<void>;

  /** Stop microphone and VAD */
  stopMic: () => void;

  /** Previous speech probability value */
  previousTriggeredProbability: number;

  /** Set previous speech probability */
  setPreviousTriggeredProbability: (value: number) => void;

  /** VAD settings configuration */
  settings: VADSettings;

  /** Update VAD settings */
  updateSettings: (newSettings: VADSettings) => void;

  /** Auto start microphone when AI starts speaking */
  autoStartMicOn: boolean;

  /** Set auto start microphone state */
  setAutoStartMicOn: (value: boolean) => void;

  /** Auto start microphone when conversation ends */
  autoStartMicOnConvEnd: boolean;

  /** Set auto start microphone when conversation ends state */
  setAutoStartMicOnConvEnd: (value: boolean) => void;

  /** How loud the last thing the mic heard was, in dB, to set the voice threshold by */
  lastHeardDb: number | null;

  /**
   * The mic's level right now, in dB, or null when the mic is off - for the live meter
   * beside the voice threshold (Virgil). Read on each animation frame; it never re-renders.
   */
  readLiveLevelDb: () => number | null;

  /** Voice ID (Virgil): whether the server knows his voice, and how the last stretch matched. */
  voiceId: VoiceIdState;

  /** Use a voice threshold at once, before it is saved - the bar works live, as Discord's. */
  previewVoiceThreshold: (db: number | undefined) => void;

  /** Start learning his voice from the next stretches of speech. */
  startLearningVoice: () => void;

  /** Stop learning without saving. */
  cancelLearningVoice: () => void;

  /** The server's verdict on a stretch (from the connection handler). */
  noteVoiceIdVerdict: (verdict: {
    allowed: boolean; score: number | null; why: string; active?: boolean; probe?: boolean;
    stopped?: boolean;
  }) => void;
}

export interface VoiceIdState {
  enabled: boolean;
  model: boolean;
  learned: boolean;
  learning: boolean;
  learnedSeconds: number;
  message: string | null;
  lastScore: number | null;
  lastAllowed: boolean | null;
}

/**
 * Default values and constants
 */
const DEFAULT_VAD_SETTINGS: VADSettings = {
  positiveSpeechThreshold: 50,
  negativeSpeechThreshold: 35,
  redemptionFrames: 35,
  voiceThresholdDb: VOICE_THRESHOLD_OFF,
};

const DEFAULT_VAD_STATE = {
  micOn: false,
  autoStopMic: false,
  autoStartMicOn: false,
  autoStartMicOnConvEnd: false,
};

/**
 * Create the VAD context
 */
export const VADContext = createContext<VADState | null>(null);

/**
 * VAD Provider Component
 * Manages voice activity detection and microphone state
 *
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function VADProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  // Refs for VAD instance and state
  const vadRef = useRef<MicVAD | null>(null);
  const previousTriggeredProbabilityRef = useRef(0);
  const previousAiStateRef = useRef<AiState>('idle');

  // Persistent state management
  const [micOn, setMicOn] = useLocalStorage('micOn', DEFAULT_VAD_STATE.micOn);
  const [autoStopMic, setAutoStopMicState] = useLocalStorage(
    'autoStopMic',
    DEFAULT_VAD_STATE.autoStopMic,
  );
  // Start from the stored value. It used to start at `true`, so the mic was
  // switched off on a reply whatever had been saved.
  const autoStopMicRef = useRef(autoStopMic);
  const [settings, setSettings] = useLocalStorage<VADSettings>(
    'vadSettings',
    DEFAULT_VAD_SETTINGS,
  );
  const [autoStartMicOn, setAutoStartMicOnState] = useLocalStorage(
    'autoStartMicOn',
    DEFAULT_VAD_STATE.autoStartMicOn,
  );
  const autoStartMicRef = useRef(autoStartMicOn);
  const [autoStartMicOnConvEnd, setAutoStartMicOnConvEndState] = useLocalStorage(
    'autoStartMicOnConvEnd',
    DEFAULT_VAD_STATE.autoStartMicOnConvEnd,
  );
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);

  // Force update mechanism for ref updates
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // External hooks and contexts
  const { interrupt } = useInterrupt();
  const { sendAudioPartition, sendVoiceProbe, reportHeldBack } = useSendAudio();
  const { setSubtitleText } = useContext(SubtitleContext)!;
  const { aiState, setAiState } = useContext(AiStateContext)!;

  // Refs for callback stability
  const interruptRef = useRef(interrupt);
  const sendAudioPartitionRef = useRef(sendAudioPartition);
  const sendVoiceProbeRef = useRef(sendVoiceProbe);
  const reportHeldBackRef = useRef(reportHeldBack);
  const aiStateRef = useRef<AiState>(aiState);
  const setSubtitleTextRef = useRef(setSubtitleText);
  const setAiStateRef = useRef(setAiState);

  const isProcessingRef = useRef(false);

  // The voice threshold (Virgil): how loud the speech so far is, whether it was held
  // back as Virgil's own voice, and the setting, read through a ref because these
  // callbacks are made once.
  const loudnessRef = useRef(new LoudnessTracker());
  const heldBackRef = useRef(false);
  const settingsRef = useRef(settings);
  const [lastHeardDb, setLastHeardDb] = useState<number | null>(null);

  // Voice ID (Virgil, 2026-10-12): the server says whether a stretch was his. While it
  // knows his voice, the page never cuts Virgil off on its own - his voice, checked on the
  // server, does that - so Virgil's own echo and other people cannot.
  const [voiceId, setVoiceId] = useState<VoiceIdState>({
    enabled: false,
    model: false,
    learned: false,
    learning: false,
    learnedSeconds: 0,
    message: null,
    lastScore: null,
    lastAllowed: null,
  });
  const voiceIdActiveRef = useRef(false);
  // The early voice check (Virgil, 2026-10-13): the first moments of his speech while Virgil
  // talks are sent on their own, so Virgil stops when he starts, not when he finishes.
  const probeRef = useRef(new VoiceProbe());
  const learningRef = useRef<Float32Array[] | null>(null);
  const serverBase = useMemo(() => addressFor(pageLocation(), import.meta.env.DEV).baseUrl, []);

  const refreshVoiceId = useCallback(async () => {
    try {
      const reply = await fetch(`${serverBase}/api/voice-id`, { credentials: 'include' });
      if (!reply.ok) return;
      const status = await reply.json();
      voiceIdActiveRef.current = Boolean(status.enabled && status.model && status.learned);
      setVoiceId((prev) => ({
        ...prev,
        enabled: Boolean(status.enabled),
        model: Boolean(status.model),
        learned: Boolean(status.learned),
      }));
    } catch {
      // An older server without voice ID: everything counts, as before.
    }
  }, [serverBase]);

  useEffect(() => {
    refreshVoiceId();
  }, [refreshVoiceId]);

  const previewVoiceThreshold = useCallback((db: number | undefined) => {
    // Applied to the checks at once; saved (and kept) only by the settings' Save.
    settingsRef.current = { ...settingsRef.current, voiceThresholdDb: db };
  }, []);

  const startLearningVoice = useCallback(() => {
    learningRef.current = [];
    setVoiceId((prev) => ({ ...prev, learning: true, learnedSeconds: 0, message: null }));
  }, []);

  const cancelLearningVoice = useCallback(() => {
    learningRef.current = null;
    setVoiceId((prev) => ({ ...prev, learning: false, learnedSeconds: 0 }));
  }, []);

  const finishLearningVoice = useCallback(async (stretches: Float32Array[]) => {
    learningRef.current = null;
    setVoiceId((prev) => ({ ...prev, learning: false, message: 'Learning your voice...' }));
    try {
      const reply = await fetch(`${serverBase}/api/voice-id/learn`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: joinedSamples(stretches).buffer as ArrayBuffer,
      });
      const result = await reply.json();
      setVoiceId((prev) => ({
        ...prev,
        message: result.learned
          ? `Learned. Only your voice counts now (your own lowest match ${result.lowest_match}).`
          : (result.error || 'It could not learn your voice.'),
      }));
    } catch {
      setVoiceId((prev) => ({ ...prev, message: 'It could not reach Virgil to learn your voice.' }));
    }
    refreshVoiceId();
  }, [serverBase, refreshVoiceId]);

  const noteVoiceIdVerdict = useCallback(
    (verdict: {
      allowed: boolean; score: number | null; why: string; active?: boolean; probe?: boolean;
      stopped?: boolean;
    }) => {
      // The server is the only judge of whether voice ID is on.
      if (typeof verdict.active === 'boolean') voiceIdActiveRef.current = verdict.active;
      setVoiceId((prev) => ({ ...prev, lastScore: verdict.score, lastAllowed: verdict.allowed }));
      if (verdict.probe && probeRef.current.verdict(verdict.allowed)) {
        // His voice, heard early: Virgil stops now. When the server stopped a running reply it
        // has recorded the cut; when the reply had already finished generating and only this
        // page still plays it, the page tells the server what he heard, so the cut is recorded
        // exactly once. From here this stretch is his turn, as when the page cut Virgil off.
        console.log('Voice ID: his voice at the start of his speech - interrupting');
        heldBackRef.current = false;
        interruptRef.current(VoiceProbe.pageRecordsTheCut(verdict));
        if (isProcessingRef.current) setAiStateRef.current('listening');
      }
    },
    [],
  );
  // Every frame's level, for the live meter (Virgil, 2026-10-12: "a reactive sound
  // threshold bar like discord has"). A ref, not state: frames arrive ~30 times a second.
  const liveLevelRef = useRef<{ db: number; at: number } | null>(null);
  const readLiveLevelDb = useCallback((): number | null => {
    const live = liveLevelRef.current;
    if (!live || performance.now() - live.at > 500) return null;
    return live.db;
  }, []);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Update refs when dependencies change
  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);

  useEffect(() => {
    interruptRef.current = interrupt;
  }, [interrupt]);

  useEffect(() => {
    sendAudioPartitionRef.current = sendAudioPartition;
  }, [sendAudioPartition]);

  useEffect(() => {
    sendVoiceProbeRef.current = sendVoiceProbe;
    reportHeldBackRef.current = reportHeldBack;
  }, [sendVoiceProbe, reportHeldBack]);

  useEffect(() => {
    setSubtitleTextRef.current = setSubtitleText;
  }, [setSubtitleText]);

  useEffect(() => {
    setAiStateRef.current = setAiState;
  }, [setAiState]);

  useEffect(() => {
    autoStopMicRef.current = autoStopMic;
  }, [autoStopMic]);

  useEffect(() => {
    autoStartMicRef.current = autoStartMicOn;
  }, [autoStartMicOn]);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  /**
   * Update previous triggered probability and force re-render
   */
  const setPreviousTriggeredProbability = useCallback((value: number) => {
    previousTriggeredProbabilityRef.current = value;
    forceUpdate();
  }, []);

  /**
   * Handle speech start event (initial detection)
   */
  const handleSpeechStart = useCallback(() => {
    console.log('Speech started - saving current state');
    // Save current AI state but DON'T change to listening yet
    previousAiStateRef.current = aiStateRef.current;
    isProcessingRef.current = true;
    loudnessRef.current.reset();
    heldBackRef.current = false;
    // Checked early only while voice ID decides and Virgil is talking; otherwise the page
    // cuts Virgil off itself at the real start, as before.
    probeRef.current.start(
      voiceIdActiveRef.current && previousAiStateRef.current === 'thinking-speaking',
    );
    // Don't change state here - wait for onSpeechRealStart
  }, []);

  /**
   * Handle real speech start event (confirmed speech)
   */
  const handleSpeechRealStart = useCallback(() => {
    console.log('Real speech confirmed - checking if need to interrupt');
    // While Virgil talks, a sound below the voice threshold is its own voice coming back:
    // it does not cut Virgil off (Virgil, 2026-10-12).
    if (voiceIdActiveRef.current && previousAiStateRef.current === 'thinking-speaking') {
      // Voice ID decides on the server whether this is him. Virgil's volume is never
      // turned down meanwhile: his test of the murmur, 2026-10-30 - Virgil's own loud
      // sentences crossed the threshold, so it went quiet, came back, and went quiet again.
      heldBackRef.current = true;
      return;
    }
    const decision = atRealStart(
      previousAiStateRef.current === 'thinking-speaking',
      loudnessRef.current.loudest,
      settingsRef.current.voiceThresholdDb,
    );
    if (decision === 'hold') {
      console.log('Below the voice threshold while Virgil talks - not interrupting');
      heldBackRef.current = true;
      return;
    }
    // Check if we need to interrupt based on the PREVIOUS state (before speech started)
    if (decision === 'interrupt') {
      console.log('Interrupting AI speech due to user speaking');
      interruptRef.current();
    }
    // Now change to listening state
    setAiStateRef.current('listening');
  }, []);

  /**
   * Handle frame processing event
   */
  const handleFrameProcessed = useCallback((probs: { isSpeech: number }, frame?: Float32Array) => {
    if (frame) liveLevelRef.current = { db: levelDb(frame), at: performance.now() };
    if (isProcessingRef.current && frame) {
      loudnessRef.current.add(frame);
      const probe = probeRef.current.add(frame, atSpeechEnd(
        true,
        loudnessRef.current.loudest,
        settingsRef.current.voiceThresholdDb,
      ) === 'send');
      if (probe) {
        console.log('Sending the start of his speech for an early voice check');
        sendVoiceProbeRef.current(probe);
      }
      // Held back as an echo but now loud enough to be him: cut Virgil off at once, not
      // when the sentence ends (architecture review, 2026-10-12).
      if (!voiceIdActiveRef.current && grewLoudEnough(
        heldBackRef.current,
        loudnessRef.current.loudest,
        settingsRef.current.voiceThresholdDb,
      )) {
        heldBackRef.current = false;
        console.log('Loud enough to be him - interrupting');
        interruptRef.current();
        setAiStateRef.current('listening');
      }
    }
    if (probs.isSpeech > previousTriggeredProbabilityRef.current) {
      setPreviousTriggeredProbability(probs.isSpeech);
    }
  }, []);

  /**
   * Handle speech end event
   */
  const handleSpeechEnd = useCallback((whole: Float32Array) => {
    if (!isProcessingRef.current) return;
    console.log('Speech ended');
    probeRef.current.stop();
    const loudest = Math.round(loudnessRef.current.loudest);
    setLastHeardDb(loudest);
    // Only the sound as loud as the threshold, and a margin round it, is sent: the rest of
    // the stretch is Virgil's own voice from the speakers (2026-10-28, "its eye candy").
    const audio = gatedAudio(whole, settingsRef.current.voiceThresholdDb);
    if (audio.length !== whole.length) {
      console.log(`Voice threshold cut ${((whole.length - audio.length) / 16000).toFixed(1)} s of quieter sound`);
    }
    if (atSpeechEnd(
      previousAiStateRef.current === 'thinking-speaking',
      loudnessRef.current.loudest,
      settingsRef.current.voiceThresholdDb,
    ) === 'drop' || (audio !== whole && audio.length < MIN_GATED_SAMPLES)) {
      // Sound from the speakers, by the voice threshold: never sent, never answered. The
      // page goes back to what it was doing (it may have shown 'listening').
      console.log(`Held back as sound from the speakers: ${loudest} dB`);
      reportHeldBackRef.current({
        why: 'below the voice threshold',
        loudestDb: loudnessRef.current.loudest,
        thresholdDb: thresholdInForce(settingsRef.current.voiceThresholdDb),
        virgilTalking: previousAiStateRef.current === 'thinking-speaking',
        seconds: whole.length / 16000,
      });
      setPreviousTriggeredProbability(0);
      isProcessingRef.current = false;
      heldBackRef.current = false;
      if (aiStateRef.current === 'listening') setAiStateRef.current(previousAiStateRef.current);
      return;
    }
    if (learningRef.current && previousAiStateRef.current !== 'thinking-speaking') {
      // Learning his voice: this stretch is for the voice print, not a turn - never while
      // Virgil talks, or its own voice would be learned as his.
      learningRef.current.push(audio);
      const seconds = learningRef.current.reduce((n, a) => n + a.length, 0) / 16000;
      setVoiceId((prev) => ({ ...prev, learnedSeconds: Math.round(seconds) }));
      setPreviousTriggeredProbability(0);
      isProcessingRef.current = false;
      if (seconds >= LEARN_SECONDS) finishLearningVoice(learningRef.current);
      return;
    }
    if (
      voiceIdActiveRef.current
      && previousAiStateRef.current === 'thinking-speaking'
      && !probeRef.current.confirmed
    ) {
      // Sent for the server to check; Virgil goes on unless it was him (the server then
      // stops the reply and the page with it).
      setPreviousTriggeredProbability(0);
      sendAudioPartitionRef.current(audio);
      isProcessingRef.current = false;
      return;
    }
    // His finished turn is the interruption: what is left of the last reply stops now,
    // since the queue no longer starts a new sentence beside one in flight (OLV1-33).
    audioManager.stopCurrentAudioAndLipSync();
    audioTaskQueue.clearQueue();

    if (autoStopMicRef.current) {
      stopMic();
    } else {
      console.log('Auto stop mic is OFF, keeping mic active');
    }

    setPreviousTriggeredProbability(0);
    sendAudioPartitionRef.current(audio);
    isProcessingRef.current = false;
    setAiStateRef.current("thinking-speaking");
  }, []);

  /**
   * Handle VAD misfire event
   */
  const handleVADMisfire = useCallback(() => {
    if (!isProcessingRef.current) return;
    console.log('VAD misfire detected');
    probeRef.current.stop();
    reportHeldBackRef.current({
      why: 'too short to be speech (a misfire)',
      loudestDb: loudnessRef.current.loudest,
      thresholdDb: thresholdInForce(settingsRef.current.voiceThresholdDb),
      virgilTalking: previousAiStateRef.current === 'thinking-speaking',
      seconds: 0,
    });
    setPreviousTriggeredProbability(0);
    isProcessingRef.current = false;

    // Restore previous AI state and show helpful misfire message
    setAiStateRef.current(previousAiStateRef.current);
    setSubtitleTextRef.current(t('error.vadMisfire'));
  }, [t]);

  /**
   * Update VAD settings and restart if active
   */
  const updateSettings = useCallback((newSettings: VADSettings) => {
    setSettings(newSettings);
    if (vadRef.current) {
      stopMic();
      setTimeout(() => {
        startMic();
      }, 100);
    }
  }, []);

  // Starting the mic is slow (the model loads first). Two starts that overlap
  // used to build two VADs, keep one in vadRef and leave the other listening
  // after the mic was switched off - the icon red and the mic still live.
  // Overlapping starts now share one build, and a stop bumps the generation
  // so a build that finishes after it is destroyed instead of started.
  const initPromiseRef = useRef<Promise<boolean> | null>(null);
  const micGenerationRef = useRef(0);

  /**
   * Initialize new VAD instance; false when a stop arrived while it was built
   */
  const initVAD = async (): Promise<boolean> => {
    const generation = micGenerationRef.current;
    const newVAD = await MicVAD.new({
      model: "v5",
      preSpeechPadFrames: 20,
      positiveSpeechThreshold: settings.positiveSpeechThreshold / 100,
      negativeSpeechThreshold: settings.negativeSpeechThreshold / 100,
      redemptionFrames: settings.redemptionFrames,
      baseAssetPath: './libs/',
      onnxWASMBasePath: './libs/',
      onSpeechStart: handleSpeechStart,
      onSpeechRealStart: handleSpeechRealStart,
      onFrameProcessed: handleFrameProcessed,
      onSpeechEnd: handleSpeechEnd,
      onVADMisfire: handleVADMisfire,
    });

    if (generation !== micGenerationRef.current || vadRef.current) {
      newVAD.destroy();
      return false;
    }
    vadRef.current = newVAD;
    newVAD.start();
    return true;
  };

  /**
   * Start microphone and VAD processing
   */
  const startMic = useCallback(async () => {
    try {
      const callGeneration = micGenerationRef.current;
      if (!vadRef.current) {
        while (!vadRef.current) {
          if (!initPromiseRef.current) {
            console.log('Initializing VAD');
            initPromiseRef.current = initVAD().finally(() => {
              initPromiseRef.current = null;
            });
          }
          if (await initPromiseRef.current) break;
          // A build this start shared was cancelled. If the stop came after
          // this start was asked for, the stop wins; otherwise build again.
          if (micGenerationRef.current !== callGeneration) return;
        }
      } else {
        console.log('Starting VAD');
        vadRef.current.start();
      }
      setMicOn(true);
    } catch (error) {
      console.error('Failed to start VAD:', error);
      toaster.create({
        title: `${t('error.failedStartVAD')}: ${error}`,
        type: 'error',
        duration: 2000,
      });
    }
  }, [t]);

  /**
   * Stop microphone and VAD processing
   */
  const stopMic = useCallback(() => {
    console.log('Stopping VAD');
    micGenerationRef.current += 1;
    if (vadRef.current) {
      vadRef.current.pause();
      vadRef.current.destroy();
      vadRef.current = null;
      console.log('VAD stopped and destroyed successfully');
      setPreviousTriggeredProbability(0);
    } else {
      console.log('VAD instance not found');
    }
    setMicOn(false);
    isProcessingRef.current = false;
  }, []);

  /**
   * Set Auto stop mic state
   */
  const setAutoStopMic = useCallback((value: boolean) => {
    autoStopMicRef.current = value;
    setAutoStopMicState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOn = useCallback((value: boolean) => {
    autoStartMicRef.current = value;
    setAutoStartMicOnState(value);
    forceUpdate();
  }, []);

  const setAutoStartMicOnConvEnd = useCallback((value: boolean) => {
    autoStartMicOnConvEndRef.current = value;
    setAutoStartMicOnConvEndState(value);
    forceUpdate();
  }, []);

  // Memoized context value. The three switches are published from state, not
  // read from their refs: a ref read with the ref outside the dependencies
  // handed the settings panel a stale `true`, and its Cancel saved it back.
  const contextValue = useMemo(
    () => ({
      autoStopMic,
      micOn,
      setMicOn,
      setAutoStopMic,
      startMic,
      stopMic,
      previousTriggeredProbability: previousTriggeredProbabilityRef.current,
      setPreviousTriggeredProbability,
      settings,
      updateSettings,
      autoStartMicOn,
      setAutoStartMicOn,
      autoStartMicOnConvEnd,
      setAutoStartMicOnConvEnd,
      lastHeardDb,
      readLiveLevelDb,
      voiceId,
      previewVoiceThreshold,
      startLearningVoice,
      cancelLearningVoice,
      noteVoiceIdVerdict,
    }),
    [
      autoStopMic,
      autoStartMicOn,
      autoStartMicOnConvEnd,
      micOn,
      startMic,
      stopMic,
      settings,
      updateSettings,
      lastHeardDb,
      readLiveLevelDb,
      voiceId,
      previewVoiceThreshold,
      startLearningVoice,
      cancelLearningVoice,
      noteVoiceIdVerdict,
    ],
  );

  return (
    <VADContext.Provider value={contextValue}>
      {children}
    </VADContext.Provider>
  );
}

/**
 * Custom hook to use the VAD context
 * @throws {Error} If used outside of VADProvider
 */
export function useVAD() {
  const context = useContext(VADContext);

  if (!context) {
    throw new Error('useVAD must be used within a VADProvider');
  }

  return context;
}
