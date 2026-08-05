import React from 'react';
import { Mic, Radio, Volume2, WifiOff } from 'lucide-react';
import type { WalkieRadioApi } from '../hooks/useWalkieRadio';

type WalkieTalkieProps = WalkieRadioApi;

export const WalkieTalkie: React.FC<WalkieTalkieProps> = ({
  isConnecting,
  channelReady,
  isTransmitting,
  elapsedMs,
  onlineCount,
  error,
  activeSpeaker,
  calls,
  audioUnlocked,
  friends,
  disabled,
  unlockAudio,
  startTransmission,
  stopTransmission,
}) => {
  const statusLabel = !channelReady && !isConnecting
    ? 'Cloud requis'
    : isConnecting
      ? 'Connexion radio…'
      : channelReady
        ? `${onlineCount}/${Math.max(0, friends.length - 1)} à l’écoute`
        : 'Hors ligne';

  return (
    <div className="mx-auto h-full w-full max-w-3xl p-2 pb-[5.6rem] sm:p-3 sm:pb-[5.8rem]">
      <section className="relative h-full overflow-hidden rounded-[2rem] bg-[#17352b] px-5 py-5 text-white shadow-[0_24px_60px_rgba(23,53,43,.18)] sm:px-8 sm:py-6">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#eb6c32]/20 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex h-full min-h-0 flex-col">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[#ff9a62]">
                <Radio className={`h-4 w-4 shrink-0 ${isTransmitting ? 'animate-pulse' : ''}`} />
                <span className="text-[10px] font-extrabold uppercase tracking-[.18em]">Canal privé</span>
              </div>
              <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Talkie équipage</h2>
              <p className="mt-1 text-[11px] font-semibold text-white/45">
                Maintiens le bouton : ta voix sort tout de suite sur leurs téléphones.
              </p>
            </div>
            <span className={`max-w-[42%] shrink-0 text-right leading-tight rounded-full px-3 py-1.5 text-[9px] font-extrabold ${
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
              radio temps réel
            </p>
          </div>

          {!audioUnlocked && channelReady && (
            <button
              type="button"
              onClick={() => void unlockAudio()}
              className="mt-3 rounded-2xl bg-[#eb6c32]/15 px-3 py-2.5 text-center text-[11px] font-extrabold text-[#ffd0b8] ring-1 ring-[#eb6c32]/25"
            >
              Activer le haut-parleur (obligatoire une fois)
            </button>
          )}

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-3 sm:py-5">
            <div className="relative grid aspect-square h-[min(31vh,16rem)] min-h-44 place-items-center">
              <span className={`absolute inset-0 rounded-full border border-white/10 ${isTransmitting ? 'animate-ping border-[#ff9a62]/50' : ''}`} />
              <span className="absolute inset-5 rounded-full border border-white/10" />
              <span className="absolute inset-10 rounded-full bg-white/[.03] ring-1 ring-white/10" />
              {isTransmitting && (
                <div className="absolute -top-2 flex h-7 items-center gap-1 rounded-full bg-[#eb6c32] px-3 text-[10px] font-extrabold shadow-lg">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  EN DIRECT · {(elapsedMs / 1000).toFixed(1)} S
                </div>
              )}

              <button
                type="button"
                disabled={disabled}
                aria-label={isTransmitting ? 'Relâcher pour couper le micro' : 'Maintenir pour parler en direct'}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  void unlockAudio();
                  void startTransmission();
                }}
                onPointerUp={() => void stopTransmission()}
                onPointerCancel={() => void stopTransmission()}
                onLostPointerCapture={() => void stopTransmission()}
                onKeyDown={(event) => {
                  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                    event.preventDefault();
                    void unlockAudio();
                    void startTransmission();
                  }
                }}
                onKeyUp={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') void stopTransmission();
                }}
                onContextMenu={(event) => event.preventDefault()}
                className={`relative z-10 grid h-[56%] w-[56%] min-h-28 min-w-28 touch-none select-none place-items-center rounded-full border-[6px] text-center transition-all ${
                  isTransmitting
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
                      : <Mic className={`h-9 w-9 sm:h-10 sm:w-10 ${isTransmitting ? 'animate-pulse' : ''}`} />}
                  <b className="max-w-[90%] truncate text-[11px] uppercase tracking-[.08em]">
                    {isTransmitting
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
              Push-to-talk · relâche pour couper le micro
            </p>
            {error && (
              <p className="mt-3 rounded-xl bg-[#eb6c32]/15 px-3 py-2 text-center text-[10px] font-bold text-[#ffd0b8] ring-1 ring-[#eb6c32]/20">
                {error}
              </p>
            )}
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
                    className="flex w-full items-center justify-between rounded-2xl bg-white/[.07] px-3 py-2.5 text-left ring-1 ring-white/10"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#eb6c32]/15 text-[#ff9a62]">
                        <Volume2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <b className="block truncate text-xs">{item.senderName}</b>
                        <small className="text-[9px] font-semibold text-white/45">
                          {new Date(item.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </span>
                    </span>
                    <span className="text-[10px] font-bold text-white/50">
                      {Math.max(1, Math.round(item.durationMs / 1000))} s · direct
                    </span>
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
