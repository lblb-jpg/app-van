import React, { useState, useEffect } from 'react';
import {
  Radio,
  ArrowUpRight,
  Copy,
  Check,
  Users,
  Link2,
  MapPin,
  MapPinOff,
  Navigation2,
  LoaderCircle,
  UserRound,
  Camera,
  Settings2,
  X,
} from 'lucide-react';
import { Friend, GpsPoint } from '../types';
import { calculateHaversineDistance } from '../services/gpx';
import type { CloudContext } from '../services/supabaseRepo';
import type { GeoStatus } from '../services/geolocation';
import { toUserFacingError } from '../lib/userFacingError';

interface LiveRadarProps {
  friends: Friend[];
  currentFriendId: string;
  userLocation: GpsPoint | null;
  cloudContext: CloudContext | null;
  geoStatus?: GeoStatus;
  onFetchInviteCode?: () => Promise<string>;
  onJoinTripByCode?: (code: string) => Promise<void>;
  onUpdateFriendProfile?: (id: string, changes: { name: string; avatar?: string }) => void;
}

function formatDistance(distanceKm: number) {
  return distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m`
    : `${distanceKm.toFixed(1)} km`;
}

function formatCoords(lat: number, lng: number) {
  return `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
}

function resizeProfilePhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Photo illisible'));
        return;
      }
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Photo illisible'));
    };
    image.src = objectUrl;
  });
}

export const LiveRadar: React.FC<LiveRadarProps> = ({
  friends,
  currentFriendId,
  userLocation,
  cloudContext,
  geoStatus,
  onFetchInviteCode,
  onJoinTripByCode,
  onUpdateFriendProfile,
}) => {
  const status: GeoStatus = geoStatus ?? { state: 'idle' };
  const [inviteCode, setInviteCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [crewMessage, setCrewMessage] = useState('');
  const [crewError, setCrewError] = useState('');
  const [editingFriend, setEditingFriend] = useState<Friend | null>(null);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [photoError, setPhotoError] = useState('');
  const currentFriend = friends.find((f) => f.id === currentFriendId) || friends[0];

  useEffect(() => {
    if (!cloudContext || !onFetchInviteCode) return;
    let cancelled = false;
    void onFetchInviteCode()
      .then((code) => {
        if (!cancelled) setInviteCode(code);
      })
      .catch(() => {
        if (!cancelled) setInviteCode('');
      });
    return () => {
      cancelled = true;
    };
  }, [cloudContext, onFetchInviteCode]);

  if (!currentFriend) {
    return (
      <div className="w-full max-w-lg mx-auto p-4 pb-28 text-center text-sm text-zinc-500">
        Chargement de l’équipage…
      </div>
    );
  }

  const referencePosition =
    userLocation ||
    (currentFriend.liveLat != null && currentFriend.liveLng != null
      ? { lat: currentFriend.liveLat, lng: currentFriend.liveLng }
      : null);

  const getDistance = (friend: Friend) => {
    if (
      !referencePosition ||
      friend.id === currentFriendId ||
      friend.liveLat == null ||
      friend.liveLng == null
    ) {
      return 0;
    }
    return calculateHaversineDistance(
      referencePosition.lat,
      referencePosition.lng,
      friend.liveLat,
      friend.liveLng
    );
  };

  const getBearing = (friend: Friend) => {
    if (!referencePosition || friend.liveLat == null || friend.liveLng == null) return '—';
    const lat1 = (referencePosition.lat * Math.PI) / 180;
    const lat2 = (friend.liveLat * Math.PI) / 180;
    const deltaLng = ((friend.liveLng - referencePosition.lng) * Math.PI) / 180;
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    const degrees = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(degrees / 45) % 8];
  };

  const others = friends.filter((friend) => friend.id !== currentFriendId);
  const nearbyFriends = referencePosition
    ? others.filter((friend) => friend.liveLat != null && friend.liveLng != null)
    : [];
  const offlineOthers = others.filter(
    (friend) => friend.liveLat == null || friend.liveLng == null
  );
  const radarRangeKm = Math.max(0.3, ...nearbyFriends.map(getDistance), 0.3) * 1.15;
  const sharingOwnGps = Boolean(userLocation);
  const locating = status.state === 'locating' && !userLocation;
  const geoErrorMessage = status.state === 'error' ? status.message : '';

  const handleCopyInvite = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setCrewMessage('Code copié — envoie-le à ton équipage.');
      setCrewError('');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCrewError('Impossible de copier le code.');
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onJoinTripByCode || !joinCode.trim()) return;
    setJoinBusy(true);
    setCrewError('');
    setCrewMessage('');
    try {
      await onJoinTripByCode(joinCode.trim());
      setCrewMessage('Voyage rejoint — les positions live arrivent.');
      setJoinCode('');
    } catch (err) {
      setCrewError(toUserFacingError(err, 'Impossible de rejoindre ce voyage.'));
    } finally {
      setJoinBusy(false);
    }
  };

  const handleRefreshInvite = async () => {
    if (!onFetchInviteCode) return;
    setInviteBusy(true);
    setCrewError('');
    try {
      const code = await onFetchInviteCode();
      setInviteCode(code);
    } catch (err) {
      setCrewError(toUserFacingError(err, 'Code invitation indisponible.'));
    } finally {
      setInviteBusy(false);
    }
  };

  const openProfileSettings = (friend: Friend) => {
    setEditingFriend(friend);
    setEditName(friend.name);
    setEditAvatar(friend.avatar);
    setPhotoError('');
  };

  const handleProfilePhoto = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('Choisis une image.');
      return;
    }
    try {
      setEditAvatar(await resizeProfilePhoto(file));
      setPhotoError('');
    } catch {
      setPhotoError('Impossible de lire cette photo.');
    }
  };

  const saveProfileSettings = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingFriend || !editName.trim() || !onUpdateFriendProfile) return;
    onUpdateFriendProfile(editingFriend.id, {
      name: editName.trim(),
      avatar: editAvatar,
    });
    setEditingFriend(null);
  };

  return (
    <div className="w-full max-w-lg mx-auto p-4 space-y-4 pb-28">
      <div className="bg-white border border-zinc-200 rounded-[2rem] p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#17352b] text-white flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-extrabold text-base text-zinc-900">Où est l’équipage ?</h2>
            <p className="text-[12px] text-zinc-500 font-medium mt-0.5 leading-relaxed">
              Voir la distance et la direction de chaque copain en live.
            </p>
          </div>
        </div>
      </div>

      {/* Clear proximity panel */}
      <div className="rounded-[2rem] border border-[#17352b]/10 bg-[#17352b] text-white overflow-hidden shadow-xs">
        {!sharingOwnGps ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                {locating ? (
                  <LoaderCircle className="w-5 h-5 text-emerald-300 animate-spin" />
                ) : (
                  <MapPinOff className="w-5 h-5 text-amber-300" />
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/90">
                  {locating ? 'Recherche GPS' : 'GPS requis'}
                </p>
                <h3 className="font-extrabold text-lg mt-1 leading-tight">
                  {locating ? 'On cherche ta position…' : 'Active ta localisation'}
                </h3>
                <p className="text-[12px] text-white/65 font-medium mt-1.5 leading-relaxed">
                  {geoErrorMessage ||
                    (locating
                      ? 'Autorise la localisation si le navigateur te le demande.'
                      : 'Sans GPS, on ne peut ni te placer ni calculer les distances avec les autres.')}
                </p>
              </div>
            </div>

            <ol className="space-y-2 rounded-2xl bg-white/5 border border-white/10 p-3.5">
              {[
                'Autorise la localisation pour ce site',
                'Attends le premier signal GPS',
                'Invite un copain avec le code plus bas',
              ].map((step, index) => (
                <li key={step} className="flex items-start gap-2.5 text-[12px] font-semibold text-white/80">
                  <span className="w-5 h-5 rounded-full bg-white/10 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ) : nearbyFriends.length === 0 ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="relative shrink-0">
                  <img
                    src={currentFriend.avatar}
                    alt=""
                    className="w-12 h-12 rounded-2xl object-cover ring-2 ring-emerald-400/80"
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[#17352b]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                    Toi · en ligne
                  </p>
                  <h3 className="font-extrabold text-lg mt-0.5">Position reçue</h3>
                  <p className="text-[11px] font-mono text-white/55 mt-1 truncate">
                    {formatCoords(userLocation!.lat, userLocation!.lng)}
                  </p>
                </div>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-extrabold text-emerald-300 ring-1 ring-emerald-300/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                GPS OK
              </span>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-emerald-300">
                <Users className="w-4 h-4" />
                <p className="text-xs font-extrabold">
                  {others.length === 0
                    ? 'Personne d’autre sur ce voyage'
                    : `${offlineOthers.length} copain${offlineOthers.length > 1 ? 's' : ''} hors ligne`}
                </p>
              </div>
              <p className="text-[12px] text-white/65 font-medium leading-relaxed">
                {others.length === 0
                  ? 'Partage le code d’invitation ci-dessous. Dès qu’un ami rejoint et active son GPS, il apparaît ici avec la distance.'
                  : 'Ils doivent ouvrir l’app et autoriser la localisation pour apparaître sur le radar.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="relative min-h-[320px] p-4">
            <div className="relative z-20 flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                  Radar live
                </p>
                <p className="text-xs font-semibold text-white/70 mt-0.5">
                  {nearbyFriends.length} proche{nearbyFriends.length > 1 ? 's' : ''} · portée{' '}
                  {formatDistance(radarRangeKm)}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-extrabold text-emerald-300 ring-1 ring-emerald-300/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                EN DIRECT
              </span>
            </div>

            <div className="absolute left-1/2 top-[54%] w-60 h-60 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500/20" />
            <div className="absolute left-1/2 top-[54%] w-40 h-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500/30" />
            <div className="absolute left-1/2 top-[54%] w-20 h-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500/40" />
            <div className="absolute left-1/2 top-[54%] h-[240px] -translate-y-1/2 border-l border-emerald-500/10" />
            <div className="absolute left-1/2 top-[54%] w-[240px] -translate-x-1/2 border-t border-emerald-500/10" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.12),transparent_54%)] pointer-events-none" />

            <div className="absolute z-10 left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <div className="w-14 h-14 rounded-full border-2 border-emerald-400 p-0.5 shadow-lg shadow-emerald-500/40 bg-zinc-900 ring-4 ring-emerald-500/15">
                <img
                  src={currentFriend.avatar}
                  alt={currentFriend.name}
                  className="w-full h-full object-cover rounded-full"
                />
              </div>
              <span className="text-[10px] font-bold text-white mt-2 bg-zinc-800 px-2.5 py-1 rounded-full border border-zinc-700 whitespace-nowrap">
                Toi
              </span>
            </div>

            {nearbyFriends.map((friend) => {
              const deltaX =
                (((friend.liveLng! - referencePosition!.lng) *
                  Math.cos((referencePosition!.lat * Math.PI) / 180) *
                  111) /
                  radarRangeKm);
              const deltaY =
                ((friend.liveLat! - referencePosition!.lat) * 111) / radarRangeKm;
              const left = 50 + Math.max(-37, Math.min(37, deltaX * 37));
              const top = 54 - Math.max(-34, Math.min(34, deltaY * 34));
              const distance = getDistance(friend);

              return (
                <div
                  key={friend.id}
                  className="absolute z-10 flex flex-col items-center -translate-x-1/2 -translate-y-1/2"
                  style={{ top: `${top}%`, left: `${left}%` }}
                >
                  <div
                    className="w-10 h-10 rounded-full border-2 p-0.5 shadow-lg bg-zinc-900"
                    style={{ borderColor: friend.color }}
                  >
                    <img
                      src={friend.avatar}
                      alt={friend.name}
                      className="w-full h-full object-cover rounded-full"
                    />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-100 bg-zinc-950/90 px-2 py-0.5 rounded-full mt-1 whitespace-nowrap border border-zinc-700">
                    {friend.name} · {formatDistance(distance)}
                  </span>
                </div>
              );
            })}

            <div className="absolute bottom-3 left-4 right-4 z-20 flex justify-between text-[9px] font-bold text-zinc-500">
              <span>O</span>
              <span>N</span>
              <span>E</span>
            </div>
          </div>
        )}
      </div>

      {cloudContext && (
        <div className="bg-white border border-zinc-200 rounded-[2rem] p-5 shadow-xs space-y-3.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-zinc-900 text-white flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-zinc-900">Inviter l’équipage</h3>
              <p className="text-[11px] text-zinc-500 font-medium">
                Même code = même voyage = positions partagées.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Ton code
              </span>
              <button
                type="button"
                onClick={() => void handleRefreshInvite()}
                disabled={inviteBusy}
                className="text-[10px] font-bold text-emerald-700 hover:underline disabled:opacity-50"
              >
                {inviteBusy ? '…' : 'Actualiser'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-center text-lg font-black tracking-[0.28em] text-zinc-900 bg-white rounded-xl border border-zinc-200 py-2.5">
                {inviteCode || '········'}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyInvite()}
                disabled={!inviteCode}
                className="p-2.5 rounded-xl bg-zinc-900 text-white disabled:opacity-40"
                title="Copier le code"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <form onSubmit={(e) => void handleJoin(e)} className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Rejoindre avec un code
            </label>
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Ex: A1B2C3D4"
                maxLength={12}
                className="flex-1 text-xs font-bold tracking-wider px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 uppercase"
              />
              <button
                type="submit"
                disabled={joinBusy || joinCode.trim().length < 6}
                className="px-3.5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5"
              >
                <Link2 className="w-3.5 h-3.5" />
                {joinBusy ? '…' : 'Joindre'}
              </button>
            </div>
          </form>

          {crewMessage && <p className="text-[11px] font-semibold text-emerald-700">{crewMessage}</p>}
          {crewError && <p className="text-[11px] font-semibold text-amber-700">{crewError}</p>}
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-[2rem] p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-extrabold text-sm text-zinc-900">
            Équipage ({friends.length})
          </h3>
          <span className="text-[10px] font-bold text-zinc-500 bg-zinc-100 px-2 py-1 rounded-full">
            {nearbyFriends.length} en ligne
          </span>
        </div>

        <div className="space-y-2">
          {friends.map((friend) => {
            const isMe = friend.id === currentFriendId;
            const isLive =
              isMe
                ? Boolean(userLocation)
                : friend.liveLat != null && friend.liveLng != null;
            const distance = !isMe && isLive ? getDistance(friend) : null;

            return (
              <div
                key={friend.id}
                className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative shrink-0">
                    <img
                      src={friend.avatar}
                      alt={friend.name}
                      className="w-9 h-9 rounded-full object-cover ring-2 ring-white"
                    />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-zinc-50 ${
                        isLive ? 'bg-emerald-500' : 'bg-zinc-300'
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-xs text-zinc-900 truncate">
                      {isMe ? 'Toi' : friend.name}
                      {isMe && (
                        <span className="ml-1.5 text-[10px] font-semibold text-zinc-400">
                          ({friend.name})
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-zinc-500 font-medium truncate">
                      {friend.role || 'Équipier'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-right shrink-0">
                  {isMe ? (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-1 rounded-xl border ${
                        isLive
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
                          : 'text-amber-700 bg-amber-50 border-amber-100'
                      }`}
                    >
                      {isLive ? (
                        <>
                          <Navigation2 className="w-3 h-3" /> GPS actif
                        </>
                      ) : (
                        <>
                          <MapPinOff className="w-3 h-3" /> Pas de GPS
                        </>
                      )}
                    </span>
                  ) : isLive ? (
                    <div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-700 bg-white px-2.5 py-1 rounded-xl border border-zinc-200">
                        <MapPin className="w-3 h-3" />
                        {formatDistance(distance!)}
                      </span>
                      <p className="mt-1 text-[10px] font-bold text-zinc-400 flex items-center justify-end gap-1">
                        <ArrowUpRight className="w-3 h-3" />
                        {getBearing(friend)}
                        {friend.lastActive ? ` · ${friend.lastActive}` : ''}
                      </p>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-zinc-500 bg-white px-2.5 py-1 rounded-xl border border-zinc-200">
                      <UserRound className="w-3 h-3" /> Hors ligne
                    </span>
                  )}
                  {onUpdateFriendProfile && (
                    <button
                      type="button"
                      onClick={() => openProfileSettings(friend)}
                      className="grid h-8 w-8 place-items-center rounded-xl bg-white text-zinc-500 ring-1 ring-zinc-200 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                      title={`Modifier le profil de ${friend.name}`}
                      aria-label={`Modifier le profil de ${friend.name}`}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editingFriend && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#17352b]/45 p-4 backdrop-blur-xs sm:items-center">
          <form
            onSubmit={saveProfileSettings}
            className="w-full max-w-sm rounded-[1.75rem] bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[.16em] text-[#eb6c32]">
                  Réglages équipage
                </p>
                <h3 className="mt-1 text-base font-extrabold text-[#17352b]">
                  Modifier le profil
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingFriend(null)}
                className="grid h-8 w-8 place-items-center rounded-xl bg-zinc-100 text-zinc-500"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex items-center gap-4">
              <div className="relative shrink-0">
                <img
                  src={editAvatar}
                  alt=""
                  className="h-20 w-20 rounded-[1.4rem] object-cover ring-2 ring-zinc-100"
                />
                <label className="absolute -bottom-1 -right-1 grid h-8 w-8 cursor-pointer place-items-center rounded-xl bg-[#eb6c32] text-white shadow-md">
                  <Camera className="h-4 w-4" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void handleProfilePhoto(event.target.files?.[0])}
                  />
                </label>
              </div>

              <label className="min-w-0 flex-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Nom affiché
                </span>
                <input
                  autoFocus
                  required
                  maxLength={30}
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </label>
            </div>

            {photoError && (
              <p className="mt-3 text-[10px] font-semibold text-red-600">{photoError}</p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEditingFriend(null)}
                className="rounded-2xl bg-zinc-100 py-3 text-xs font-bold text-zinc-600"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!editName.trim()}
                className="rounded-2xl bg-[#17352b] py-3 text-xs font-extrabold text-white disabled:opacity-40"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
