import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Map,
  Navigation as GpsIcon,
  Milestone,
  BookOpen,
  Receipt,
  Radio,
  Mic2,
  Compass,
  User,
  Download,
  Wifi,
  WifiOff,
  Plus,
  Share,
  X,
  LoaderCircle,
  MapPin,
  AlertTriangle,
  BedDouble,
} from 'lucide-react';
import { motion } from 'motion/react';
import { TabType, Friend } from '../types';
import { isIosDevice, isStandalonePwa } from '../lib/pwa';
import type { GeoStatus } from '../services/geolocation';

interface NavigationProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  friends: Friend[];
  currentFriendId: string;
  setCurrentFriendId: (id: string) => void;
  isGpsRecording: boolean;
  geoStatus?: GeoStatus;
  hasUserLocation?: boolean;
  booting?: boolean;
  syncError?: string;
  onDismissSyncError?: () => void;
}

const INSTALL_DISMISS_KEY = 'van_install_dismissed_v1';

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  friends,
  currentFriendId,
  setCurrentFriendId,
  isGpsRecording,
  geoStatus,
  hasUserLocation = false,
  booting = false,
  syncError = '',
  onDismissSyncError,
}) => {
  const status: GeoStatus = geoStatus ?? { state: 'idle' };
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissedGeoError, setDismissedGeoError] = useState('');
  const standalone = isStandalonePwa();

  const currentFriend = friends.find((f) => f.id === currentFriendId) || friends[0];
  const hasFriends = Boolean(currentFriend);

  const geoErrorText = status.state === 'error' ? status.message : '';
  const showGeoToast = Boolean(geoErrorText && geoErrorText !== dismissedGeoError);
  const showSyncToast = Boolean(syncError);

  useEffect(() => {
    if (status.state !== 'error') setDismissedGeoError('');
  }, [status]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
    if (!standalone && !dismissed) {
      if (isIosDevice()) {
        setShowInstallHint(true);
      }
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!dismissed && !standalone) setShowInstallHint(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', () => {
      setShowInstallHint(false);
      setDeferredPrompt(null);
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, [standalone]);

  const dismissInstall = () => {
    setShowInstallHint(false);
    setShowIosHelp(false);
    localStorage.setItem(INSTALL_DISMISS_KEY, '1');
  };

  const handleInstallPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setShowInstallHint(false);
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
      return;
    }
    if (isIosDevice()) {
      setShowIosHelp(true);
      return;
    }
    setShowIosHelp(true);
  };

  const navItems: { id: TabType; label: string; icon: React.ReactNode; badge?: boolean }[] = [
    { id: 'map', label: 'Carte', icon: <Map /> },
    { id: 'sleep', label: 'Dormir', icon: <BedDouble /> },
    { id: 'gps', label: 'GPS', icon: <GpsIcon />, badge: isGpsRecording },
    { id: 'radio', label: 'Talkie', icon: <Mic2 /> },
    { id: 'waypoints', label: 'Étapes', icon: <Milestone /> },
    { id: 'journal', label: 'Journal', icon: <BookOpen /> },
    { id: 'budget', label: 'VanPay', icon: <Receipt /> },
    { id: 'radar', label: 'Radar', icon: <Radio /> },
  ];

  return (
    <>
      <header className="van-header fixed inset-x-0 top-0 z-40 w-full px-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-6 sm:pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="van-header__inner mx-auto flex max-w-6xl items-center justify-between rounded-[1.35rem] px-3 py-2 sm:rounded-[1.6rem] sm:px-4 sm:py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="van-brand-mark relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[1rem] text-white sm:h-11 sm:w-11 sm:rounded-[1.1rem]">
              <Compass className="relative z-10 h-5 w-5" />
              <span className="absolute -bottom-3 -right-3 h-8 w-8 rounded-full bg-orange-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="van-wordmark truncate text-[16px] font-extrabold leading-none tracking-[-0.04em] text-[#17352b] sm:text-[17px]">
                  Vanlife <span className="text-[#eb6c32]">Club</span>
                </h1>
                {isGpsRecording && (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-extrabold text-red-600 ring-1 ring-red-200 animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> REC
                  </span>
                )}
                {standalone && (
                  <span className="hidden xs:inline text-[9px] font-extrabold uppercase tracking-wider text-[#36866b] bg-[#e6f3eb] px-1.5 py-0.5 rounded-full">
                    App
                  </span>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-bold tracking-wide text-[#6f786f] min-w-0">
                {booting ? (
                  <span className="flex items-center gap-1 text-[#6f786f]">
                    <LoaderCircle className="h-3 w-3 animate-spin" /> Connexion…
                  </span>
                ) : !hasUserLocation && status.state === 'locating' ? (
                  <span className="flex items-center gap-1 text-[#6f786f]">
                    <LoaderCircle className="h-3 w-3 animate-spin" /> GPS…
                  </span>
                ) : hasUserLocation ? (
                  <span className="flex items-center gap-1 text-[#36866b]">
                    <MapPin className="h-3 w-3" /> GPS
                  </span>
                ) : status.state === 'error' ? (
                  <span className="flex items-center gap-1 text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> GPS off
                  </span>
                ) : null}
                {(booting || hasUserLocation || status.state === 'locating' || status.state === 'error') && (
                  <span className="text-[#c5cbc4]">·</span>
                )}
                {isOnline ? (
                  <span className="flex items-center gap-1 text-[#36866b]">
                    <Wifi className="h-3 w-3" /> En ligne
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-700">
                    <WifiOff className="h-3 w-3" /> Hors-ligne
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!standalone && (
              <button
                type="button"
                onClick={() => void handleInstallPwa()}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[#17352b] text-white"
                title="Installer sur l’écran d’accueil"
                aria-label="Installer l’application"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
            <div className="relative flex items-center bg-zinc-100 rounded-full p-1 ring-1 ring-zinc-200">
              {currentFriend ? (
                <img
                  src={currentFriend.avatar}
                  alt={currentFriend.name}
                  className="w-6 h-6 rounded-full object-cover ring-1 ring-white"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-white text-zinc-400 flex items-center justify-center ring-1 ring-zinc-200">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
              <select
                value={currentFriendId}
                onChange={(e) => setCurrentFriendId(e.target.value)}
                disabled={!hasFriends}
                aria-label="Changer d’utilisateur"
                title="Changer d’utilisateur"
                className="bg-transparent text-xs font-bold text-zinc-800 focus:outline-hidden pl-1.5 pr-5 max-w-20 sm:max-w-32 cursor-pointer appearance-none"
              >
                {!hasFriends && <option value={currentFriendId}>…</option>}
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>
      <div
        aria-hidden="true"
        className="shrink-0 w-full h-[calc(4.35rem+env(safe-area-inset-top))] sm:h-[calc(4.85rem+env(safe-area-inset-top))]"
      />

      {showInstallHint && !standalone && (
        <div className="mx-3 mt-2 sm:mx-6">
          <div className="van-install-sheet flex flex-wrap items-center gap-3 rounded-2xl px-3.5 py-3">
            <div className="w-9 h-9 rounded-xl bg-[#17352b] text-white flex items-center justify-center shrink-0">
              <Download className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-[#17352b]">Installer Vanlife Club</p>
              <p className="text-[11px] font-medium text-[#6f786f] leading-snug">
                Sur l’écran d’accueil · GPS même hors-ligne
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleInstallPwa()}
              className="shrink-0 min-h-11 px-3 py-2 rounded-xl bg-[#eb6c32] text-white text-[11px] font-bold"
            >
              Installer
            </button>
            <button
              type="button"
              onClick={dismissInstall}
              className="touch-target flex items-center justify-center min-h-11 min-w-11 text-[#6f786f]"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showIosHelp && (
        <div className="fixed inset-0 z-50 bg-[#17352b]/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm van-install-sheet rounded-[1.75rem] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-base text-[#17352b]">Ajouter à l’écran d’accueil</h3>
                <p className="text-[12px] text-[#6f786f] font-medium mt-1 leading-relaxed">
                  Pour l’utiliser comme une vraie app mobile.
                </p>
              </div>
              <button type="button" onClick={() => setShowIosHelp(false)} className="touch-target flex items-center justify-center min-h-11 min-w-11 text-[#6f786f]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ol className="space-y-2.5">
              {[
                { icon: <Share className="w-4 h-4" />, text: 'Touche Partager (carré avec flèche)' },
                { icon: <Plus className="w-4 h-4" />, text: 'Choisis « Sur l’écran d’accueil »' },
                { icon: <Download className="w-4 h-4" />, text: 'Valide — l’icône Vanlife Club apparaît' },
              ].map((step, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-2xl bg-[#f5f1e7] px-3 py-2.5 text-[12px] font-semibold text-[#17352b]"
                >
                  <span className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-[#eb6c32] shrink-0">
                    {step.icon}
                  </span>
                  <span>
                    <span className="text-[10px] font-bold text-[#6f786f] mr-1">{i + 1}.</span>
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={dismissInstall}
              className="w-full py-3 rounded-2xl bg-[#17352b] text-white text-xs font-bold"
            >
              Compris
            </button>
          </div>
        </div>
      )}

      {(showGeoToast || showSyncToast) && (
        <div className="fixed inset-x-0 bottom-[calc(3.85rem+env(safe-area-inset-bottom))] z-40 px-3 pointer-events-none sm:bottom-[calc(4.25rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-3xl space-y-2 pointer-events-auto">
            {showSyncToast && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-lg">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="flex-1 text-[11px] font-semibold text-amber-900 leading-snug">{syncError}</p>
                {onDismissSyncError && (
                  <button type="button" onClick={onDismissSyncError} className="p-0.5 text-amber-700" aria-label="Fermer">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            {showGeoToast && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-lg">
                <MapPin className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="flex-1 text-[11px] font-semibold text-amber-900 leading-snug">{geoErrorText}</p>
                <button
                  type="button"
                  onClick={() => setDismissedGeoError(geoErrorText)}
                  className="p-0.5 text-amber-700"
                  aria-label="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {typeof document !== 'undefined' &&
        createPortal(
          <nav className="van-bottom-nav pointer-events-none" aria-label="Navigation principale">
            <div className="flex w-full items-stretch justify-around gap-0.5 px-1 py-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pointer-events-auto sm:gap-1 sm:px-2 sm:pb-[max(0.45rem,env(safe-area-inset-bottom))]">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2 sm:rounded-[1.1rem]"
                  >
                    {isActive && (
                      <motion.span
                        layoutId="van-nav-bubble"
                        className="absolute inset-0 rounded-xl bg-[#17352b] shadow-[0_6px_16px_rgba(23,53,43,.2)] sm:rounded-[1.1rem]"
                        transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.6 }}
                      />
                    )}

                    <span className="relative z-10 flex h-5 w-5 items-center justify-center sm:h-6 sm:w-6">
                      {React.cloneElement(item.icon as React.ReactElement<{ className?: string }>, {
                        className: `w-4 h-4 sm:w-[17px] sm:h-[17px] transition-colors duration-200 ${
                          isActive ? 'text-[#ff9a62]' : 'text-[#7d857d]'
                        }`,
                      })}
                      {item.badge && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white animate-pulse" />
                      )}
                    </span>

                    <span
                      className={`relative z-10 max-w-full truncate px-0.5 text-[8px] leading-none tracking-tight sm:text-[9px] ${
                        isActive ? 'font-bold text-white' : 'font-semibold text-[#737d74]'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>,
          document.body
        )}
    </>
  );
};
