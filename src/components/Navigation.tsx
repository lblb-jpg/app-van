import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Map,
  Milestone,
  BookOpen,
  Receipt,
  User,
  Download,
  Plus,
  Share,
  X,
  LoaderCircle,
  MapPin,
  AlertTriangle,
  BedDouble,
  RefreshCw,
} from 'lucide-react';
import { TabType, Friend } from '../types';
import { isAndroidDevice, isIosDevice, isMobileDevice, isStandalonePwa } from '../lib/pwa';
import type { GeoStatus } from '../services/geolocation';
import { wasGeoGranted } from '../lib/permissions';
import { ModalShell } from './ModalShell';

interface NavigationProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  friends: Friend[];
  currentFriendId: string;
  setCurrentFriendId: (id: string) => void;
  geoStatus?: GeoStatus;
  hasUserLocation?: boolean;
  booting?: boolean;
  isRefreshing?: boolean;
  syncError?: string;
  onDismissSyncError?: () => void;
  onRefresh?: () => void;
  immersive?: boolean;
}

const INSTALL_DISMISS_KEY = 'van_install_dismissed_v1';

const NAV_ITEMS: {
  id: TabType;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  { id: 'map', label: 'Carte', hint: 'Spots & itinéraire', icon: <Map className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.25} /> },
  { id: 'sleep', label: 'Dormir', hint: 'Spots bivouac', icon: <BedDouble className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.25} /> },
  { id: 'waypoints', label: 'Étapes', hint: 'Arrêts du voyage', icon: <Milestone className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.25} /> },
  { id: 'journal', label: 'Journal', hint: 'Notes & photos', icon: <BookOpen className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.25} /> },
  { id: 'budget', label: 'VanPay', hint: 'Budget équipage', icon: <Receipt className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.25} /> },
  { id: 'profile', label: 'Profil', hint: 'Photo & prénom', icon: <User className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.25} /> },
];

function tabLabel(tab: TabType) {
  return NAV_ITEMS.find((item) => item.id === tab)?.label ?? 'Vanlife Club';
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  friends,
  currentFriendId,
  setCurrentFriendId,
  geoStatus,
  booting = false,
  isRefreshing = false,
  syncError = '',
  onDismissSyncError,
  onRefresh,
  immersive = false,
}) => {
  const status: GeoStatus = geoStatus ?? { state: 'idle' };
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [showManualInstallHelp, setShowManualInstallHelp] = useState(false);
  const [installHelpPlatform, setInstallHelpPlatform] = useState<'ios' | 'android'>('ios');
  const [dismissedGeoError, setDismissedGeoError] = useState('');
  const standalone = isStandalonePwa();

  const currentFriend = friends.find((f) => f.id === currentFriendId) || friends[0];
  const hasFriends = Boolean(currentFriend);

  const geoErrorText = status.state === 'error' ? status.message : '';
  const isPermissionNag =
    /autorise|permission|localisation dans le navigateur/i.test(geoErrorText);
  const showGeoToast = Boolean(
    geoErrorText &&
      geoErrorText !== dismissedGeoError &&
      (isPermissionNag ? !wasGeoGranted() : true)
  );
  const showSyncToast = Boolean(syncError);

  useEffect(() => {
    if (status.state !== 'error') setDismissedGeoError('');
  }, [status]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      try {
        if (localStorage.getItem(INSTALL_DISMISS_KEY) !== '1') setShowInstallHint(true);
      } catch {
        setShowInstallHint(true);
      }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  useEffect(() => {
    if (standalone) return;
    if (!isMobileDevice()) return;
    try {
      if (localStorage.getItem(INSTALL_DISMISS_KEY) === '1') return;
    } catch {
      // ignore
    }
    const timer = window.setTimeout(() => {
      if (!deferredPrompt) setShowInstallHint(true);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [standalone, deferredPrompt]);

  const dismissInstall = () => {
    setShowInstallHint(false);
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    } catch {
      // ignore
    }
  };

  const handleInstallPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      dismissInstall();
      return;
    }
    setInstallHelpPlatform(isAndroidDevice() ? 'android' : isIosDevice() ? 'ios' : 'ios');
    setShowManualInstallHelp(true);
  };

  const installHelpSteps =
    installHelpPlatform === 'android'
      ? [
          { icon: <MoreIcon />, text: 'Ouvre le menu du navigateur (⋮)' },
          { icon: <Download className="h-4 w-4" />, text: 'Choisis « Installer l’application »' },
          { icon: <Plus className="h-4 w-4" />, text: 'Confirme — Vanlife Club s’ajoute à l’accueil' },
        ]
      : [
          { icon: <Share className="h-4 w-4" />, text: 'Appuie sur Partager dans Safari' },
          { icon: <Plus className="h-4 w-4" />, text: 'Choisis « Sur l’écran d’accueil »' },
          { icon: <Download className="h-4 w-4" />, text: 'Valide — l’icône Vanlife Club apparaît' },
        ];

  return (
    <>
      <header className={`van-header ${immersive ? 'van-header--immersive' : ''}`}>
        <div className={`van-header__inner ${immersive ? 'van-header__inner--immersive' : ''}`}>
          <div className="van-header__title min-w-0 flex-1">
            <p className="van-header__kicker">
              Vanlife Club
              {!isOnline && <span className="ml-1.5 text-amber-700">· hors-ligne</span>}
            </p>
            <h1 className="van-header__page truncate">{tabLabel(activeTab)}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (onRefresh) {
                  onRefresh();
                } else {
                  window.location.reload();
                }
              }}
              disabled={isRefreshing || booting}
              className="van-header__icon-btn"
              title="Rafraîchir l’application"
              aria-label="Rafraîchir l’application"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            {!standalone && (
              <button
                type="button"
                onClick={() => void handleInstallPwa()}
                className="van-header__icon-btn"
                title="Installer sur l’écran d’accueil"
                aria-label="Installer l’application"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            <div className="van-header__user">
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className="van-header__avatar-btn"
                aria-label="Ouvrir mon profil"
              >
                {currentFriend ? (
                  <img src={currentFriend.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <User className="h-4 w-4 text-[#68756d]" />
                )}
              </button>
              <select
                value={currentFriendId}
                onChange={(e) => setCurrentFriendId(e.target.value)}
                disabled={!hasFriends}
                aria-label="Changer d’utilisateur"
                className="max-w-[5rem] cursor-pointer appearance-none bg-transparent pl-1 text-xs font-bold text-[#17352b] focus:outline-hidden sm:max-w-[7rem]"
              >
                {!hasFriends && <option value={currentFriendId}>…</option>}
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {(booting || isRefreshing || status.state === 'locating') && (
          <p className="van-header__status">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            {booting ? 'Connexion…' : isRefreshing ? 'Rafraîchissement…' : 'Localisation…'}
          </p>
        )}
      </header>

      {showInstallHint && !standalone && (
        <div className="van-install-banner">
          <div className="van-install-sheet flex flex-wrap items-center gap-3 rounded-2xl px-3.5 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#17352b] text-white">
              <Download className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-[#17352b]">Installer Vanlife Club</p>
              <p className="text-[0.7rem] font-medium leading-snug text-[#6f786f]">
                Sur l’écran d’accueil · GPS hors-ligne
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleInstallPwa()}
              className="min-h-10 shrink-0 rounded-xl bg-[#eb6c32] px-3 py-2 text-[0.7rem] font-bold text-white"
            >
              Installer
            </button>
            <button type="button" onClick={dismissInstall} className="touch-target min-h-10 min-w-10 text-[#6f786f]" aria-label="Fermer">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <ModalShell isOpen={showManualInstallHelp} onClose={() => setShowManualInstallHelp(false)} maxWidth="sm">
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-[#17352b]">Ajouter à l’écran d’accueil</h3>
              <p className="mt-1 text-[0.75rem] font-medium leading-relaxed text-[#6f786f]">
                {installHelpPlatform === 'android'
                  ? 'Installe l’app pour un accès rapide, plein écran et GPS optimisé.'
                  : 'Pour l’utiliser comme une vraie app mobile.'}
              </p>
            </div>
            <button type="button" onClick={() => setShowManualInstallHelp(false)} className="touch-target min-h-10 min-w-10 text-[#6f786f]">
              <X className="h-5 w-5" />
            </button>
          </div>
          <ol className="space-y-2.5">
            {installHelpSteps.map((step, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-[#f5f1e7] px-3 py-2.5 text-[0.75rem] font-semibold text-[#17352b]">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-[#eb6c32]">{step.icon}</span>
                <span><span className="mr-1 text-[0.65rem] font-bold text-[#6f786f]">{i + 1}.</span>{step.text}</span>
              </li>
            ))}
          </ol>
          <button type="button" onClick={dismissInstall} className="w-full rounded-2xl bg-[#17352b] py-3 text-xs font-bold text-white">
            Compris
          </button>
        </div>
      </ModalShell>

      {(showGeoToast || showSyncToast) && (
        <div className="van-toast-bar">
          <div className="mx-auto max-w-3xl space-y-2">
            {showSyncToast && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-lg">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p className="flex-1 text-[0.7rem] font-semibold leading-snug text-amber-900">{syncError}</p>
                {onDismissSyncError && (
                  <button type="button" onClick={onDismissSyncError} className="text-amber-700" aria-label="Fermer">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {showGeoToast && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-lg">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p className="flex-1 text-[0.7rem] font-semibold leading-snug text-amber-900">{geoErrorText}</p>
                <button type="button" onClick={() => setDismissedGeoError(geoErrorText)} className="text-amber-700" aria-label="Fermer">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {typeof document !== 'undefined' &&
        createPortal(
          <nav
            className={`van-tabbar ${immersive ? 'van-tabbar--immersive' : ''}`}
            aria-label="Navigation principale"
          >
            <div className="van-tabbar__inner">
              {NAV_ITEMS.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.label}
                    title={item.hint}
                    className={`van-tabbar__item ${isActive ? 'is-active' : ''}`}
                  >
                    <span className="van-tabbar__icon">{item.icon}</span>
                    <span className="van-tabbar__label">{item.label}</span>
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
