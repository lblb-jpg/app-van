import React, { useEffect, useRef, useState } from 'react';
import { Mic, Radio, Volume2, WifiOff } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Friend } from '../types';
import type { CloudContext } from '../services/supabaseRepo';

interface WalkieTalkieProps {
  cloudContext: CloudContext | null;
  friends: Friend[];
  currentFriendId: string;
}

type RtcSignal = {
  kind: 'hello' | 'offer' | 'answer' | 'ice' | 'ptt-start' | 'ptt-stop';
  from: string;
  to?: string;
  senderName: string;
  sentAt: number;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type RadioCall = {
  id: string;
  senderId: string;
  senderName: string;
  startedAt: number;
  durationMs: number;
};

const MAX_TRANSMISSION_MS = 60_000;

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turnUrl = (import.meta as any).env?.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: (import.meta as any).env?.VITE_TURN_USERNAME || '',
      credential: (import.meta as any).env?.VITE_TURN_CREDENTIAL || '',
    });
  }
  return servers;
}

export const WalkieTalkie: React.FC<WalkieTalkieProps> = ({
  cloudContext,
  friends,
  currentFriendId,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(Boolean(cloudContext));
  const [channelReady, setChannelReady] = useState(false);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState<{ id: string; name: string } | null>(null);
  const [calls, setCalls] = useState<RadioCall[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const remoteAudioRef = useRef(new Map<string, HTMLAudioElement>());
  const remoteCallStartedRef = useRef(new Map<string, number>());
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<number | undefined>(undefined);
  const elapsedTimerRef = useRef<number | undefined>(undefined);
  const releaseRequestedRef = useRef(false);
  const isTransmittingRef = useRef(false);
  const currentFriend = friends.find((friend) => friend.id === currentFriendId) || friends[0];
  const friendIdsKey = friends.map((friend) => friend.id).sort().join(',');

  const sendSignal = (signal: Omit<RtcSignal, 'from' | 'senderName' | 'sentAt'>) => {
    if (!cloudContext || !channelRef.current) return Promise.resolve('error' as const);
    return channelRef.current.send({
      type: 'broadcast',
      event: 'rtc-signal',
      payload: {
        ...signal,
        from: cloudContext.user.id,
        senderName: currentFriend?.name || 'Équipier',
        sentAt: Date.now(),
      } satisfies RtcSignal,
    });
  };

  const refreshConnectedPeers = () => {
    setConnectedPeers(
      [...peersRef.current.values()].filter((peer) => peer.connectionState === 'connected').length
    );
  };

  const createPeer = async (peerId: string, initiator: boolean) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const peer = new RTCPeerConnection({ iceServers: getIceServers() });
    peersRef.current.set(peerId, peer);
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal({ kind: 'ice', to: peerId, candidate: event.candidate.toJSON() });
      }
    };
    peer.onconnectionstatechange = () => {
      refreshConnectedPeers();
      if (peer.connectionState === 'failed') {
        setError('Connexion directe impossible. Configure un serveur TURN pour ce réseau.');
      }
    };
    peer.ontrack = (event) => {
      let audio = remoteAudioRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        remoteAudioRef.current.set(peerId, audio);
      }
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void audio.play().catch(() => {
        setError('Touche une fois l’écran pour autoriser le haut-parleur.');
      });
    };

    if (initiator) {
      peer.addTransceiver('audio', { direction: 'sendrecv' });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal({ kind: 'offer', to: peerId, sdp: offer });
    }
    return peer;
  };

  useEffect(() => {
    if (!cloudContext) {
      setIsConnecting(false);
      setChannelReady(false);
      return;
    }

    setIsConnecting(true);
    const handleSignal = async (signal: RtcSignal) => {
      if (!signal || signal.from === cloudContext.user.id) return;
      if (signal.to && signal.to !== cloudContext.user.id) return;

      if (signal.kind === 'hello') {
        if (cloudContext.user.id < signal.from && !peersRef.current.has(signal.from)) {
          await createPeer(signal.from, true);
        }
        return;
      }
      if (signal.kind === 'ptt-start') {
        remoteCallStartedRef.current.set(signal.from, signal.sentAt);
        setActiveSpeaker({ id: signal.from, name: signal.senderName });
        return;
      }
      if (signal.kind === 'ptt-stop') {
        const startedAt = remoteCallStartedRef.current.get(signal.from) || signal.sentAt;
        remoteCallStartedRef.current.delete(signal.from);
        setActiveSpeaker((speaker) => speaker?.id === signal.from ? null : speaker);
        setCalls((items) => [{
          id: `${signal.from}-${signal.sentAt}`,
          senderId: signal.from,
          senderName: signal.senderName,
          startedAt,
          durationMs: Math.max(0, signal.sentAt - startedAt),
        }, ...items].slice(0, 6));
        return;
      }

      const peer = await createPeer(signal.from, false);
      if (signal.kind === 'offer' && signal.sdp) {
        if (peer.signalingState === 'have-local-offer') {
          if (cloudContext.user.id < signal.from) return;
          await peer.setLocalDescription({ type: 'rollback' });
        }
        await peer.setRemoteDescription(signal.sdp);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await sendSignal({ kind: 'answer', to: signal.from, sdp: answer });
      } else if (signal.kind === 'answer' && signal.sdp && peer.signalingState === 'have-local-offer') {
        await peer.setRemoteDescription(signal.sdp);
      } else if (signal.kind === 'ice' && signal.candidate) {
        if (peer.remoteDescription) {
          await peer.addIceCandidate(signal.candidate);
        } else {
          const queue = pendingIceRef.current.get(signal.from) || [];
          queue.push(signal.candidate);
          pendingIceRef.current.set(signal.from, queue);
        }
      }

      if (peer.remoteDescription) {
        const queued = pendingIceRef.current.get(signal.from) || [];
        pendingIceRef.current.delete(signal.from);
        for (const candidate of queued) await peer.addIceCandidate(candidate);
      }
    };

    const channel = cloudContext.supabase
      .channel(`walkie-${cloudContext.tripId}`, {
        config: { broadcast: { self: false } },
      })
      .on('broadcast', { event: 'rtc-signal' }, ({ payload }) => {
        void handleSignal(payload as RtcSignal).catch(() => {
          setError('La liaison audio temps réel a rencontré une erreur.');
        });
      })
      .subscribe((status) => {
        const ready = status === 'SUBSCRIBED';
        setChannelReady(ready);
        setIsConnecting(status === 'SUBSCRIBING');
        if (ready) {
          void sendSignal({ kind: 'hello' });
          for (const friend of friends) {
            if (friend.id !== cloudContext.user.id && cloudContext.user.id < friend.id) {
              void createPeer(friend.id, true);
            }
          }
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Canal radio indisponible. Vérifie la connexion.');
        }
      });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      remoteAudioRef.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
      });
      remoteAudioRef.current.clear();
      pendingIceRef.current.clear();
      setConnectedPeers(0);
      void cloudContext.supabase.removeChannel(channel);
    };
  }, [cloudContext, friendIdsKey]);

  useEffect(() => () => {
    window.clearTimeout(stopTimerRef.current);
    window.clearInterval(elapsedTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopRecording = async () => {
    releaseRequestedRef.current = true;
    window.clearTimeout(stopTimerRef.current);
    window.clearInterval(elapsedTimerRef.current);
    if (!isTransmittingRef.current) return;

    isTransmittingRef.current = false;
    const durationMs = Date.now() - startedAtRef.current;
    for (const peer of peersRef.current.values()) {
      const sender = peer.getTransceivers().find((item) => item.receiver.track.kind === 'audio')?.sender;
      await sender?.replaceTrack(null);
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsRecording(false);
    setElapsedMs(0);
    await sendSignal({ kind: 'ptt-stop' });
    setCalls((items) => [{
      id: `me-${Date.now()}`,
      senderId: cloudContext?.user.id || 'me',
      senderName: 'Vous',
      startedAt: startedAtRef.current,
      durationMs,
    }, ...items].slice(0, 6));
  };

  const startRecording = async () => {
    if (isTransmittingRef.current || activeSpeaker || !cloudContext || !channelReady) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setError('L’audio temps réel n’est pas pris en charge sur ce navigateur.');
      return;
    }

    setError('');
    releaseRequestedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (releaseRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      startedAtRef.current = Date.now();
      const track = stream.getAudioTracks()[0];
      for (const friend of friends) {
        if (friend.id === cloudContext.user.id) continue;
        const peer = await createPeer(friend.id, !peersRef.current.has(friend.id));
        const sender = peer.getTransceivers().find((item) => item.receiver.track.kind === 'audio')?.sender;
        await sender?.replaceTrack(track);
      }
      isTransmittingRef.current = true;
      setIsRecording(true);
      setElapsedMs(0);
      await sendSignal({ kind: 'ptt-start' });
      elapsedTimerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
      stopTimerRef.current = window.setTimeout(() => void stopRecording(), MAX_TRANSMISSION_MS);
    } catch (err) {
      setError((err as DOMException)?.name === 'NotAllowedError'
        ? 'Autorise le micro pour utiliser le talkie-walkie.'
        : 'Impossible d’accéder au micro.');
    }
  };

  const disabled = !cloudContext || !channelReady || Boolean(activeSpeaker);
  const statusLabel = !cloudContext
    ? 'Cloud requis'
    : isConnecting
      ? 'Connexion radio…'
      : channelReady
        ? `${connectedPeers}/${Math.max(0, friends.length - 1)} en direct`
        : 'Hors ligne';

  return (
    <div className="mx-auto h-full w-full max-w-3xl p-2 pb-[5.6rem] sm:p-3 sm:pb-[5.8rem]">
      <section className="relative h-full overflow-hidden rounded-[2rem] bg-[#17352b] px-5 py-5 text-white shadow-[0_24px_60px_rgba(23,53,43,.18)] sm:px-8 sm:py-6">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#eb6c32]/20 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex h-full min-h-0 flex-col">
          <header className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[#ff9a62]">
                <Radio className={`h-4 w-4 ${isRecording ? 'animate-pulse' : ''}`} />
                <span className="text-[10px] font-extrabold uppercase tracking-[.18em]">Canal privé</span>
              </div>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Talkie équipage</h2>
              <p className="mt-1 text-[11px] font-semibold text-white/45">Maintiens le bouton : ta voix part immédiatement.</p>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-[9px] font-extrabold ${
              channelReady ? 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/15' : 'bg-white/10 text-white/55'
            }`}>
              {channelReady && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              {statusLabel}
            </span>
          </header>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/[.06] px-3.5 py-2.5 ring-1 ring-white/10 sm:mt-5 sm:py-3">
            <div className="flex -space-x-2">
              {friends.slice(0, 5).map((friend) => (
                <img
                  key={friend.id}
                  src={friend.avatar}
                  alt={friend.name}
                  title={friend.name}
                  className="h-8 w-8 rounded-full border-2 border-[#17352b] object-cover"
                />
              ))}
            </div>
            <p className="text-right text-[10px] font-bold text-white/45">
              <strong className="block text-xs text-white">{friends.length} à bord</strong>
              sur le même canal
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-3 sm:py-5">
            <div className="relative grid aspect-square h-[min(31vh,16rem)] min-h-44 place-items-center">
              <span className={`absolute inset-0 rounded-full border border-white/10 ${isRecording ? 'animate-ping border-[#ff9a62]/50' : ''}`} />
              <span className="absolute inset-5 rounded-full border border-white/10" />
              <span className="absolute inset-10 rounded-full bg-white/[.03] ring-1 ring-white/10" />
              {isRecording && (
                <div className="absolute -top-2 flex h-7 items-center gap-1 rounded-full bg-[#eb6c32] px-3 text-[10px] font-extrabold shadow-lg">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  EN DIRECT · {(elapsedMs / 1000).toFixed(1)} S
                </div>
              )}

              <button
                type="button"
                disabled={disabled}
                aria-label={isRecording ? 'Relâcher pour couper le micro' : 'Maintenir pour parler en direct'}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  void startRecording();
                }}
                onPointerUp={stopRecording}
                onPointerCancel={stopRecording}
                onKeyDown={(event) => {
                  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                    event.preventDefault();
                    void startRecording();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') stopRecording();
                }}
                onContextMenu={(event) => event.preventDefault()}
                className={`relative z-10 grid h-[56%] w-[56%] min-h-28 min-w-28 touch-none select-none place-items-center rounded-full border-[6px] text-center transition-all ${
                  isRecording
                    ? 'scale-95 border-[#ffb087] bg-[#eb6c32] text-white shadow-[0_0_0_12px_rgba(235,108,50,.13),0_22px_45px_rgba(235,108,50,.4)]'
                    : disabled
                      ? 'cursor-not-allowed border-white/5 bg-white/5 text-white/25'
                      : 'border-[#fffdf8]/20 bg-[#fffdf8] text-[#17352b] shadow-[0_20px_45px_rgba(0,0,0,.25)] hover:scale-[1.03]'
                }`}
              >
                <span className="flex flex-col items-center gap-2">
                  {activeSpeaker
                    ? <Volume2 className="h-8 w-8 animate-pulse sm:h-9 sm:w-9" />
                    : disabled
                      ? <WifiOff className="h-8 w-8 sm:h-9 sm:w-9" />
                      : <Mic className={`h-9 w-9 sm:h-10 sm:w-10 ${isRecording ? 'animate-pulse' : ''}`} />}
                  <b className="text-[11px] uppercase tracking-[.08em]">
                    {isRecording
                      ? 'Tu parles en direct'
                      : activeSpeaker
                        ? `${activeSpeaker.name} parle`
                        : disabled
                          ? 'Radio inactive'
                          : 'Appuie et parle'}
                  </b>
                </span>
              </button>
            </div>
            <p className="mt-1 text-center text-[10px] font-bold text-white/35">
              Audio WebRTC direct · relâche pour couper le micro
            </p>
            {error && <p className="mt-3 rounded-xl bg-[#eb6c32]/15 px-3 py-2 text-center text-[10px] font-bold text-[#ffd0b8] ring-1 ring-[#eb6c32]/20">{error}</p>}
          </div>

          <div className="mt-auto shrink-0">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[9px] font-extrabold uppercase tracking-[.16em] text-white/35">Activité radio</p>
              {calls.length > 0 && <span className="text-[9px] font-bold text-white/30">{calls.length} appel(s)</span>}
            </div>
            {calls.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-center">
                <Volume2 className="mx-auto h-4 w-4 text-white/25" />
                <p className="mt-1.5 text-[10px] font-semibold text-white/35">Le canal est silencieux pour le moment.</p>
              </div>
            ) : (
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {calls.map((item) => (
                  <div
                    key={item.id}
                    className="flex w-full items-center justify-between rounded-2xl bg-white/[.07] px-3 py-2.5 text-left ring-1 ring-white/10 hover:bg-white/10"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#eb6c32]/15 text-[#ff9a62]">
                        <Volume2 className="h-4 w-4" />
                      </span>
                      <span>
                        <b className="block text-xs">{item.senderName}</b>
                        <small className="text-[9px] font-semibold text-white/45">
                          {new Date(item.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </span>
                    </span>
                    <span className="text-[10px] font-bold text-white/50">{Math.max(1, Math.round(item.durationMs / 1000))} s · direct</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
