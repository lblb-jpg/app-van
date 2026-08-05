import React from 'react';
import { 
  Navigation as GpsIcon, 
  Milestone, 
  Receipt, 
  Camera, 
  Radio, 
  MapPin, 
  Compass, 
  ArrowUpRight,
  TrendingUp,
  Droplets,
  Award
} from 'lucide-react';
import { TabType, Friend, Waypoint, Expense, TripPhoto } from '../types';

interface BentoDashboardProps {
  onNavigateTab: (tab: TabType) => void;
  waypoints: Waypoint[];
  expenses: Expense[];
  photos: TripPhoto[];
  friends: Friend[];
  totalDistanceKm: number;
  isGpsRecording: boolean;
}

export const BentoDashboard: React.FC<BentoDashboardProps> = ({
  onNavigateTab,
  waypoints,
  expenses,
  photos,
  friends,
  totalDistanceKm,
  isGpsRecording
}) => {
  const activeWaypoint = waypoints.find((w) => w.status === 'active') || waypoints[0];
  const totalSpent = expenses.reduce((acc, curr) => acc + curr.amount, 0);
  const latestPhoto = photos[0];

  return (
    <div className="w-full max-w-lg mx-auto p-4 space-y-4 pb-28">
      {/* Hero Welcome Card - Geometric Balance Dark Metric Card */}
      <div className="bg-zinc-900 text-white rounded-[2rem] p-6 border border-zinc-800 shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-800">
            Road Trip Van 🚐
          </span>
          <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-emerald-400 animate-spin" style={{ animationDuration: '12s' }} />
            {friends.length} Copains à bord
          </span>
        </div>

        <div className="mt-4">
          <h2 className="text-2xl font-black tracking-tight">Alpes & Lacs 2026 🏔️</h2>
          <p className="text-xs text-zinc-400 font-medium mt-1">
            Suivi GPS en direct, spots de bivouac & gestion du budget vanlife.
          </p>
        </div>

        {/* Quick Geometric Bento Stats Bar */}
        <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-zinc-800">
          <div>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold block">Distance GPS</span>
            <span className="text-base font-black font-mono text-emerald-400">{totalDistanceKm.toFixed(1)} km</span>
          </div>
          <div>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold block">Budget Total</span>
            <span className="text-base font-black font-mono text-white">{totalSpent.toFixed(0)} €</span>
          </div>
          <div>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold block">Étapes</span>
            <span className="text-base font-black font-mono text-amber-400">{waypoints.length} arrêt(s)</span>
          </div>
        </div>
      </div>

      {/* Bento Grid Layout - Geometric Balance 2-Column Grid */}
      <div className="grid grid-cols-2 gap-3.5">
        {/* Tile 1: GPS Live Tracker Quick View */}
        <div
          onClick={() => onNavigateTab('gps')}
          className="bg-white rounded-[2rem] border border-zinc-200 p-5 shadow-xs hover:border-zinc-300 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 flex items-center justify-center font-bold">
                <GpsIcon className="w-5 h-5 text-emerald-600" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-zinc-400" />
            </div>
            <h3 className="font-extrabold text-sm text-zinc-900">Tracé GPS</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {isGpsRecording ? 'Enregistrement actif' : 'Prêt à enregistrer'}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between text-xs font-bold text-emerald-700">
            <span>{isGpsRecording ? '🔴 REC ACTIF' : '▶ Lancer'}</span>
          </div>
        </div>

        {/* Tile 2: Next Stage Highlight */}
        <div
          onClick={() => onNavigateTab('waypoints')}
          className="bg-white rounded-[2rem] border border-zinc-200 p-5 shadow-xs hover:border-zinc-300 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 ring-1 ring-amber-200 text-amber-700 flex items-center justify-center font-bold">
                <Milestone className="w-5 h-5 text-amber-600" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-zinc-400" />
            </div>
            <h3 className="font-extrabold text-sm text-zinc-900 line-clamp-1">
              {activeWaypoint ? activeWaypoint.title : 'Étape active'}
            </h3>
            <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-zinc-400 shrink-0" />
              <span className="truncate">{activeWaypoint ? activeWaypoint.locationName : 'Aucun arrêt'}</span>
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-100 text-[11px] font-bold text-amber-700">
            {activeWaypoint?.vanSpotType || 'Voir étapes'}
          </div>
        </div>

        {/* Tile 3: VanPay Budget Splitter */}
        <div
          onClick={() => onNavigateTab('budget')}
          className="bg-white rounded-[2rem] border border-zinc-200 p-5 shadow-xs hover:border-zinc-300 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-2xl bg-zinc-100 ring-1 ring-zinc-200 text-zinc-800 flex items-center justify-center font-bold">
                <Receipt className="w-5 h-5 text-zinc-700" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-zinc-400" />
            </div>
            <h3 className="font-extrabold text-sm text-zinc-900">Tricount Van</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {expenses.length} dépense(s) partagée(s)
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-100 text-xs font-black font-mono text-zinc-900">
            {(totalSpent / Math.max(1, friends.length)).toFixed(2)} € / pers
          </div>
        </div>

        {/* Tile 4: Live Radar */}
        <div
          onClick={() => onNavigateTab('radar')}
          className="bg-white rounded-[2rem] border border-zinc-200 p-5 shadow-xs hover:border-zinc-300 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 flex items-center justify-center font-bold">
                <Radio className="w-5 h-5 text-emerald-600" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-zinc-400" />
            </div>
            <h3 className="font-extrabold text-sm text-zinc-900">Radar Copains</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">Positions live de l’équipage</p>
          </div>
          <div className="mt-4 pt-3 border-t border-zinc-100 text-xs font-bold text-emerald-700">
            Ouvrir le radar ➔
          </div>
        </div>
      </div>

      {/* Latest Media Souvenir Tile */}
      {latestPhoto && (
        <div
          onClick={() => onNavigateTab('journal')}
          className="relative rounded-[2rem] overflow-hidden shadow-xs border border-zinc-200 h-48 group cursor-pointer"
        >
          <img
            src={latestPhoto.url}
            alt={latestPhoto.caption}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/85 via-zinc-950/20 to-transparent p-5 flex flex-col justify-end text-white">
            <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400">Dernier souvenir</span>
            <h4 className="font-extrabold text-sm leading-snug mt-0.5">{latestPhoto.caption || 'Photo de voyage'}</h4>
            <p className="text-[11px] text-zinc-300 font-medium mt-0.5">📍 {latestPhoto.locationName || 'Road trip'}</p>
          </div>
        </div>
      )}
    </div>
  );
};
