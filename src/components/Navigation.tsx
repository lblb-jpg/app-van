import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Map,
  Milestone,
  BookOpen,
  Receipt,
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
  Menu,
  RefreshCw,
} from 'lucide-react';
import { TabType, Friend } from '../types';
import { isIosDevice, isStandalonePwa } from '../lib/pwa';
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
  badge?: boolean;
}[] = [
  { id: 'map', label: 'Carte', hint: 'Spots & itinéraire', icon: <Map className="h-5 w-5" /> },
  { id: 'sleep', label: 'Dormir', hint: 'Spots bivouac', icon: <BedDouble className="h-5 w-5" /> },
  { id: 'waypoints', label: 'Étapes', hint: 'Arrêts du voyage', icon: <Milestone className="h-5 w-5" /> },
  { id: 'journal', label: 'Journal', hint: 'Notes & photos', icon: <BookOpen className="h-5 w-5" /> },
  { id: 'budget', label: 'VanPay', hint: 'Budget équipage', icon: <Receipt className="h-5 w-5" /> },
];

function tabLabel(tab: TabType) {
  return NAV_ITEMS.find((item) => item.id === tab)?.label ?? 'Vanlife Club';
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  friends,
  currentFriendId,
  setCurrentFriendId,
  geoStatus,
  hasUserLocation = false,
  booting = false,
  isRefreshing = false,
  syncError = '',
  onDismissSyncError,
  onRefresh,
  immersive = false,
}) => {
  const status: GeoStatus = geoStatus ?? { state: 'idle' };
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
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
    if (!menuOpen) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
    if (!standalone && !dismissed && isIosDevice()) {
      setShowInstallHint(true);
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
    setShowIosHelp(true);
  };

  const navigateTo = (tab: TabType) => {
    setActiveTab(tab);
    setMenuOpen(false);
  };

  const menu = menuOpen && (
    <div className="van-menu" role="presentation">
      <button
        type="button"
        className="van-menu__backdrop"
        aria-label="Fermer le menu"
        onClick={() => setMenuOpen(false)}
      />
      <aside className="van-menu__panel" role="dialog" aria-modal="true" aria-label="Menu principal">
        <div className="van-menu__head">
          <div>
            <p className="van-menu__kicker">Navigation</p>
            <h2 className="van-menu__title">Vanlife Club</h2>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="van-menu__close"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="van-menu__list" aria-label="Sections de l'application">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`van-menu__item ${isActive ? 'is-active' : ''}`}
              >
                <span className="van-menu__item-icon">{item.icon}</span>
                <span className="van-menu__item-text">
                  <span className="van-menu__item-label">{item.label}</span>
                  <span className="van-menu__item-hint">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="van-menu__foot">
          <div className="van-menu__status">
            {isOnline ? (
              <span className="text-[#36866b]"><Wifi className="inline h-3.5 w-3.5" /> En ligne</span>
            ) : (
              <span className="text-amber-700"><WifiOff className="inline h-3.5 w-3.5" /> Hors-ligne</span>
            )}
            {hasUserLocation && (
              <span className="text-[#36866b]"><MapPin className="inline h-3.5 w-3.5" /> GPS actif</span>
            )}
          </div>
        </div>
      </aside>
    </div>
  );

  return (
    <>
      <header className={`van-header ${immersive ? 'van-header--immersive' : ''}`}>
        <div className={`van-header__inner ${immersive ? 'van-header__inner--immersive' : ''}`}>
          <div className="van-header__title min-w-0 flex-1">
            <p className="van-header__kicker">Vanlife Club</p>
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
              title="Rafraîchir l\u2019application"
              aria-label="Rafraîchir l\u2019application"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            {!standalone && (
              <button
                type="button"
                onClick={() => void handleInstallPwa()}
                className="van-header__icon-btn"
                title="Installer sur l\u2019écran d\u2019accueil"
                aria-label="Installer l\u2019application"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            <div className="van-header__user">
              {currentFriend ? (
                <img src={currentFriend.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <User className="h-4 w-4 text-[#68756d]" />
              )}
              <select
                value={currentFriendId}
                onChange={(e) => setCurrentFriendId(e.target.value)}
                disabled={!hasFriends}
                aria-label="Changer d\u2019utilisateur"
                className="max-w-[5rem] cursor-pointer appearance-none bg-transparent pl-1 text-xs font-bold text-[#17352b] focus:outline-hidden sm:max-w-[7rem]"
              >
                {!hasFriends && <option value={currentFriendId}>…</option>}
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="van-burger"
            aria-label="Ouvrir le menu"
            aria-expanded={menuOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {(booting || isRefreshing || status.state === 'locating') && (
          <p className="van-header__status">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            {booting ? 'Connexion…' : isRefreshing ? 'Rafraîchissement…' : 'Localisation…'}
          </p>
        )}
      </header>

      {menuOpen && typeof document !== 'undefined' && createPortal(menu, document.body)}

      {showInstallHint && !standalone && (
        <div className="van-install-banner">
          <div className="van-install-sheet flex flex-wrap items-center gap-3 rounded-2xl px-3.5 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#17352b] text-white">
              <Download className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-[#17352b]">Installer Vanlife Club</p>
              <p className="text-[0.7rem] font-medium leading-snug text-[#6f786f]">
                Sur l\u2019écran d\u2019accueil · GPS hors-ligne
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

      <ModalShell isOpen={showIosHelp} onClose={() => setShowIosHelp(false)} maxWidth="sm">
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-[#17352b]">Ajouter à l\u2019écran d\u2019accueil</h3>
              <p className="mt-1 text-[0.75rem] font-medium leading-relaxed text-[#6f786f]">
                Pour l\u2019utiliser comme une vraie app mobile.
              </p>
            </div>
            <button type="button" onClick={() => setShowIosHelp(false)} className="touch-target min-h-10 min-w-10 text-[#6f786f]">
              <X className="h-5 w-5" />
            </button>
          </div>
          <ol className="space-y-2.5">
            {[
              { icon: <Share className="h-4 w-4" />, text: 'Touche Partager (carré avec flèche)' },
              { icon: <Plus className="h-4 w-4" />, text: 'Choisis « Sur l\u2019écran d\u2019accueil »' },
              { icon: <Download className="h-4 w-4" />, text: 'Valide — l\u2019icône Vanlife Club apparaît' },
            ].map((step, i) => (
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
    </>
  );
};
