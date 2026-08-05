import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Friend } from '../types';
import type { CloudContext } from '../services/supabaseRepo';

export type WalkieCall = {
  id: string;
  senderId: string;
  senderName: string;
  startedAt: number;
  durationMs: number;
};

type WalkieSignal =
  | {
      kind: 'ptt-start' | 'ptt-stop' | 'presence';
      from: string;
      senderName: string;
      sentAt: number;
    }
  | {
      kind: 'audio';
      from: string;
      senderName: string;
      sentAt: number;
      sampleRate: number;
      pcm: string;
    };

const MAX_TRANSMISSION_MS = 60_000;
const STALE_SPEAKER_MS = 4_000;
const TARGET_SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 2048;

function floatToInt16Base64(input: Float32Array) {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToFloat32(pcm: string) {
  const binary = atob(pcm);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

function downsample(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    const count = Math.max(1, end - start);
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / count;
  }
  return output;
}

export function useWalkieRadio(options: {
  cloudContext: CloudContext | null;
  friends: Friend[];
  currentFriendId: string;
}) {
  const { cloudContext, friends, currentFriendId } = options;
  const [isConnecting, setIsConnecting] = useState(Boolean(cloudContext));
  const [channelReady, setChannelReady] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const [error, setError] = useState('');
  const [activeSpeaker, setActiveSpeaker] = useState<{ id: string; name: string } | null>(null);
  const [calls, setCalls] = useState<WalkieCall[]>([]);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const presenceRef = useRef(new Map<string, number>());
  const remoteCallStartedRef = useRef(new Map<string, number>());
  const lastSpeakerActivityRef = useRef(new Map<string, number>());
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<number | undefined>(undefined);
  const elapsedTimerRef = useRef<number | undefined>(undefined);
  const presenceTimerRef = useRef<number | undefined>(undefined);
  const releaseRequestedRef = useRef(false);
  const transmittingRef = useRef(false);
  const senderNameRef = useRef('Équipier');

  const currentFriend = friends.find((friend) => friend.id === currentFriendId) || friends[0];
  senderNameRef.current = currentFriend?.name || 'Équipier';

  const ensurePlaybackContext = useCallback(async () => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    }
    if (playbackCtxRef.current.state === 'suspended') {
      await playbackCtxRef.current.resume();
    }
    setAudioUnlocked(true);
    return playbackCtxRef.current;
  }, []);

  const unlockAudio = useCallback(async () => {
    try {
      await ensurePlaybackContext();
      setError('');
    } catch {
      setError('Impossible d’activer le haut-parleur sur cet appareil.');
    }
  }, [ensurePlaybackContext]);

  const sendSignal = useCallback(async (
    signal:
      | { kind: 'ptt-start' | 'ptt-stop' | 'presence' }
      | { kind: 'audio'; sampleRate: number; pcm: string }
  ) => {
    if (!cloudContext || !channelRef.current) return 'error' as const;
    return channelRef.current.send({
      type: 'broadcast',
      event: 'walkie',
      payload: {
        ...signal,
        from: cloudContext.user.id,
        senderName: senderNameRef.current,
        sentAt: Date.now(),
      },
    });
  }, [cloudContext]);

  const refreshPresence = useCallback(() => {
    const now = Date.now();
    for (const [id, seenAt] of [...presenceRef.current.entries()]) {
      if (now - seenAt > 12_000) presenceRef.current.delete(id);
    }
    setOnlineCount(presenceRef.current.size);
  }, []);

  const playPcmBuffer = useCallback((ctx: AudioContext, samples: Float32Array, sampleRate: number) => {
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, sampleRate || TARGET_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 1.15;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
  }, []);

  const playRemotePcm = useCallback(async (pcm: string, sampleRate: number) => {
    try {
      const ctx = await ensurePlaybackContext();
      playPcmBuffer(ctx, base64ToFloat32(pcm), sampleRate);
    } catch {
      setError('Touche une fois l’écran pour autoriser le haut-parleur.');
      setAudioUnlocked(false);
    }
  }, [ensurePlaybackContext, playPcmBuffer]);

  const clearStaleSpeaker = useCallback(() => {
    setActiveSpeaker((speaker) => {
      if (!speaker || speaker.id === cloudContext?.user.id) return speaker;
      const lastActivity = lastSpeakerActivityRef.current.get(speaker.id) || 0;
      if (Date.now() - lastActivity > STALE_SPEAKER_MS) {
        remoteCallStartedRef.current.delete(speaker.id);
        lastSpeakerActivityRef.current.delete(speaker.id);
        return null;
      }
      return speaker;
    });
  }, [cloudContext]);

  useEffect(() => {
    if (!cloudContext) {
      setIsConnecting(false);
      setChannelReady(false);
      setOnlineCount(0);
      return;
    }

    setIsConnecting(true);
    const handleSignal = async (signal: WalkieSignal) => {
      if (!signal || signal.from === cloudContext.user.id) return;

      if (signal.kind === 'presence') {
        presenceRef.current.set(signal.from, signal.sentAt);
        refreshPresence();
        return;
      }

      if (signal.kind === 'ptt-start') {
        remoteCallStartedRef.current.set(signal.from, signal.sentAt);
        lastSpeakerActivityRef.current.set(signal.from, signal.sentAt);
        setActiveSpeaker({ id: signal.from, name: signal.senderName });
        nextPlayTimeRef.current = 0;
        await ensurePlaybackContext().catch(() => undefined);
        return;
      }

      if (signal.kind === 'ptt-stop') {
        const startedAt = remoteCallStartedRef.current.get(signal.from) || signal.sentAt;
        remoteCallStartedRef.current.delete(signal.from);
        lastSpeakerActivityRef.current.delete(signal.from);
        setActiveSpeaker((speaker) => (speaker?.id === signal.from ? null : speaker));
        setCalls((items) => [{
          id: `${signal.from}-${signal.sentAt}`,
          senderId: signal.from,
          senderName: signal.senderName,
          startedAt,
          durationMs: Math.max(0, signal.sentAt - startedAt),
        }, ...items].slice(0, 6));
        return;
      }

      if (signal.kind === 'audio') {
        presenceRef.current.set(signal.from, signal.sentAt);
        lastSpeakerActivityRef.current.set(signal.from, signal.sentAt);
        if (!remoteCallStartedRef.current.has(signal.from)) {
          remoteCallStartedRef.current.set(signal.from, signal.sentAt);
          setActiveSpeaker({ id: signal.from, name: signal.senderName });
        }
        await playRemotePcm(signal.pcm, signal.sampleRate);
      }
    };

    const channel = cloudContext.supabase
      .channel(`walkie-live-${cloudContext.tripId}`, {
        config: { broadcast: { self: false, ack: false } },
      })
      .on('broadcast', { event: 'walkie' }, ({ payload }) => {
        void handleSignal(payload as WalkieSignal).catch(() => {
          setError('La radio a rencontré une erreur.');
        });
      })
      .subscribe((status) => {
        const ready = status === 'SUBSCRIBED';
        setChannelReady(ready);
        setIsConnecting(!ready && status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED');
        if (ready) {
          void sendSignal({ kind: 'presence' });
          setError('');
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Canal radio indisponible. Vérifie la connexion.');
        }
      });

    channelRef.current = channel;
    presenceTimerRef.current = window.setInterval(() => {
      void sendSignal({ kind: 'presence' });
      refreshPresence();
      clearStaleSpeaker();
    }, 4_000);

    return () => {
      window.clearInterval(presenceTimerRef.current);
      channelRef.current = null;
      presenceRef.current.clear();
      setOnlineCount(0);
      setChannelReady(false);
      void cloudContext.supabase.removeChannel(channel);
    };
  }, [cloudContext, clearStaleSpeaker, ensurePlaybackContext, playRemotePcm, refreshPresence, sendSignal]);

  const stopTransmission = useCallback(async () => {
    releaseRequestedRef.current = true;
    window.clearTimeout(stopTimerRef.current);
    window.clearInterval(elapsedTimerRef.current);
    if (!transmittingRef.current) return;

    transmittingRef.current = false;
    const durationMs = Date.now() - startedAtRef.current;

    try {
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;
    sourceRef.current = null;

    if (captureCtxRef.current) {
      void captureCtxRef.current.close().catch(() => undefined);
      captureCtxRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    setIsTransmitting(false);
    setElapsedMs(0);
    setActiveSpeaker((speaker) => (speaker?.id === cloudContext?.user.id ? null : speaker));
    lastSpeakerActivityRef.current.delete(cloudContext?.user.id || '');
    await sendSignal({ kind: 'ptt-stop' });
    setCalls((items) => [{
      id: `me-${Date.now()}`,
      senderId: cloudContext?.user.id || 'me',
      senderName: 'Vous',
      startedAt: startedAtRef.current,
      durationMs,
    }, ...items].slice(0, 6));
  }, [cloudContext, sendSignal]);

  const startTransmission = useCallback(async () => {
    const someoneElseSpeaking = activeSpeaker && activeSpeaker.id !== cloudContext?.user.id;
    if (transmittingRef.current || someoneElseSpeaking || !cloudContext || !channelReady) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Le micro n’est pas pris en charge sur ce navigateur.');
      return;
    }

    setError('');
    releaseRequestedRef.current = false;
    try {
      await ensurePlaybackContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (releaseRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const captureCtx = new AudioContext();
      const source = captureCtx.createMediaStreamSource(stream);
      const processor = captureCtx.createScriptProcessor(FRAME_SAMPLES, 1, 1);
      const mute = captureCtx.createGain();
      mute.gain.value = 0;
      const playbackCtx = await ensurePlaybackContext();

      processor.onaudioprocess = (event) => {
        if (!transmittingRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const downsampled = downsample(input, captureCtx.sampleRate, TARGET_SAMPLE_RATE);
        const pcm = floatToInt16Base64(downsampled);
        try {
          playPcmBuffer(playbackCtx, downsampled, TARGET_SAMPLE_RATE);
        } catch {
          // sidetone optional if playback context suspended
        }
        void sendSignal({
          kind: 'audio',
          sampleRate: TARGET_SAMPLE_RATE,
          pcm,
        });
      };

      source.connect(processor);
      processor.connect(mute);
      mute.connect(captureCtx.destination);

      streamRef.current = stream;
      captureCtxRef.current = captureCtx;
      sourceRef.current = source;
      processorRef.current = processor;
      startedAtRef.current = Date.now();
      transmittingRef.current = true;
      setIsTransmitting(true);
      setElapsedMs(0);
      setActiveSpeaker({ id: cloudContext.user.id, name: senderNameRef.current });
      lastSpeakerActivityRef.current.set(cloudContext.user.id, Date.now());
      nextPlayTimeRef.current = 0;
      await sendSignal({ kind: 'ptt-start' });
      elapsedTimerRef.current = window.setInterval(
        () => setElapsedMs(Date.now() - startedAtRef.current),
        100
      );
      stopTimerRef.current = window.setTimeout(() => void stopTransmission(), MAX_TRANSMISSION_MS);
    } catch (err) {
      setError((err as DOMException)?.name === 'NotAllowedError'
        ? 'Autorise le micro pour utiliser le talkie-walkie.'
        : 'Impossible d’accéder au micro.');
      transmittingRef.current = false;
      setIsTransmitting(false);
    }
  }, [
    activeSpeaker,
    channelReady,
    cloudContext,
    ensurePlaybackContext,
    playPcmBuffer,
    sendSignal,
    stopTransmission,
  ]);

  useEffect(() => () => {
    window.clearTimeout(stopTimerRef.current);
    window.clearInterval(elapsedTimerRef.current);
    window.clearInterval(presenceTimerRef.current);
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void captureCtxRef.current?.close().catch(() => undefined);
    void playbackCtxRef.current?.close().catch(() => undefined);
  }, []);

  const crewOnline = Math.min(
    Math.max(0, friends.length - 1),
    onlineCount
  );

  return {
    isConnecting,
    channelReady,
    isTransmitting,
    elapsedMs,
    onlineCount: crewOnline,
    error,
    activeSpeaker,
    calls,
    audioUnlocked,
    friends,
    currentFriend,
    disabled: !cloudContext || !channelReady || Boolean(
      activeSpeaker && activeSpeaker.id !== cloudContext.user.id
    ),
    unlockAudio,
    startTransmission,
    stopTransmission,
  };
}

export type WalkieRadioApi = ReturnType<typeof useWalkieRadio>;
