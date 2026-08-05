import React, { useState } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Download, 
  Upload, 
  Gauge, 
  History,
  Trash2,
  Satellite,
  AlertTriangle,
  LoaderCircle,
} from 'lucide-react';
import { GpsTrack, GpsPoint } from '../types';
import { downloadGpxFile, parseGpxXml } from '../services/gpx';
import { formatDistanceKm, maxSpeedKmH } from '../services/gpsMetrics';
import type { GeoStatus } from '../services/geolocation';

interface GpsTrackerProps {
  isRecording: boolean;
  isPaused: boolean;
  activeTrackPoints: GpsPoint[];
  currentSpeed: number; // km/h
  currentAltitude: number | null; // m
  totalDistanceKm: number; // km
  elapsedSeconds: number;
  gpsAccuracyM: number | null;
  geoStatus: GeoStatus;
  pastTracks: GpsTrack[];
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onStopAndSaveRecording: (title: string) => void;
  onImportGpx: (track: GpsTrack) => void;
  onDeleteTrack: (trackId: string) => void;
}

function formatTime(totalSecs: number) {
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const GpsTracker: React.FC<GpsTrackerProps> = ({
  isRecording,
  isPaused,
  activeTrackPoints,
  currentSpeed,
  currentAltitude,
  totalDistanceKm,
  elapsedSeconds,
  gpsAccuracyM,
  geoStatus,
  pastTracks,
  onStartRecording,
  onPauseRecording,
  onStopAndSaveRecording,
  onImportGpx,
  onDeleteTrack
}) => {
  const [trackTitleInput, setTrackTitleInput] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);

  const distance = formatDistanceKm(totalDistanceKm);
  const gpsReady = geoStatus.state === 'ready';
  const gpsLocating = geoStatus.state === 'locating' || geoStatus.state === 'idle';
  const accuracyLabel =
    gpsAccuracyM != null
      ? gpsAccuracyM <= 12
        ? `±${gpsAccuracyM} m · excellent`
        : gpsAccuracyM <= 30
          ? `±${gpsAccuracyM} m · bon`
          : `±${gpsAccuracyM} m · moyen`
      : null;

  const handleFinishClick = () => {
    setTrackTitleInput(`Étape Van - ${new Date().toLocaleDateString('fr-FR')}`);
    setShowSaveModal(true);
  };

  const handleConfirmSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackTitleInput.trim()) return;
    onStopAndSaveRecording(trackTitleInput.trim());
    setShowSaveModal(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const gpxContent = event.target?.result as string;
      if (gpxContent) {
        try {
          const parsed = parseGpxXml(gpxContent, file.name.replace('.gpx', ''));
          const speeds = parsed.points.map((p) => p.speed || 0);
          const maxSpd = Math.max(0, ...speeds);
          const durationH =
            parsed.points.length > 1
              ? (parsed.points[parsed.points.length - 1].timestamp - parsed.points[0].timestamp) /
                3_600_000
              : 0;
          const avgSpd = durationH > 0 ? parsed.distanceKm / durationH : 0;
          const newTrack: GpsTrack = {
            id: 'gpx_' + Date.now(),
            title: parsed.title,
            date: new Date().toISOString().split('T')[0],
            startTime: parsed.points[0]?.timestamp || Date.now(),
            distanceKm: parsed.distanceKm,
            avgSpeedKmH: Number(avgSpd.toFixed(1)),
            maxSpeedKmH: Number(maxSpd.toFixed(1)),
            points: parsed.points,
            createdByFriendId: 'f1'
          };
          onImportGpx(newTrack);
          alert(`Trace GPX "${parsed.title}" importée avec succès ! (${parsed.distanceKm} km)`);
        } catch (err) {
          alert("Erreur lors de la lecture du fichier GPX.");
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const statusBadge = () => {
    if (isRecording && isPaused) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-amber-50 text-amber-800 ring-1 ring-amber-200">
          EN PAUSE
        </span>
      );
    }
    if (isRecording) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 flex items-center gap-1 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span> REC
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200">
        PRÊT
      </span>
    );
  };

  return (
    <div className="page-pad space-y-3 sm:space-y-4">
      <div className="bg-white border border-zinc-200 rounded-[1.5rem] p-4 shadow-xs relative overflow-hidden text-center sm:rounded-[1.75rem] sm:p-5">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 border border-zinc-100 rounded-full pointer-events-none"></div>

        <div className="flex items-center justify-between mb-2 relative z-10">
          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 text-emerald-600" /> Compteur GPS Van
          </span>
          {statusBadge()}
        </div>

        <div className="relative z-10 mb-0.5 flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 px-1 text-center text-[10px] font-semibold">
          {gpsReady ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Satellite className="w-3 h-3" />
              GPS live{accuracyLabel ? ` · ${accuracyLabel}` : ''}
            </span>
          ) : gpsLocating ? (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <LoaderCircle className="w-3 h-3 animate-spin" />
              Acquisition GPS…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-red-600">
              <AlertTriangle className="w-3 h-3" />
              {geoStatus.state === 'error' ? geoStatus.message : 'GPS indisponible'}
            </span>
          )}
        </div>

        <div className="my-2 relative z-10">
          <div className="text-4xl font-black text-zinc-900 tracking-tight font-mono tabular-nums sm:text-5xl">
            {Math.round(currentSpeed)}
            <span className="text-base font-bold text-zinc-400 ml-1">km/h</span>
          </div>
          <p className="text-[10px] text-zinc-500 font-medium mt-0.5">
            Vitesse instantanée
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1.5 mt-3 pt-3 border-t border-zinc-100 relative z-10">
          <div className="bg-zinc-50 px-2 py-2 rounded-xl border border-zinc-200">
            <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-wider block">Distance</span>
            <span className="text-sm font-black text-zinc-900 font-mono tabular-nums">{distance.value}</span>
            <span className="text-[9px] text-zinc-500 font-medium ml-0.5">{distance.unit}</span>
          </div>

          <div className="bg-zinc-50 px-2 py-2 rounded-xl border border-zinc-200">
            <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-wider block">Altitude</span>
            <span className="text-sm font-black text-emerald-700 font-mono tabular-nums">
              {currentAltitude != null ? currentAltitude : '—'}
            </span>
            <span className="text-[9px] text-zinc-500 font-medium ml-0.5">m</span>
          </div>

          <div className="bg-zinc-50 px-2 py-2 rounded-xl border border-zinc-200">
            <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-wider block">Durée</span>
            <span className="text-sm font-black text-zinc-900 font-mono leading-5 tabular-nums">
              {formatTime(elapsedSeconds)}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 relative z-10">
          {!isRecording ? (
            <button
              type="button"
              onClick={onStartRecording}
              disabled={!gpsReady}
              className="w-full min-h-12 py-3 px-4 bg-zinc-900 text-white font-extrabold text-xs rounded-xl shadow-md hover:bg-zinc-800 transition-all flex items-center justify-center gap-1.5 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4 fill-current text-emerald-400" /> Démarrer la Trace GPS
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onPauseRecording}
                className={`flex-1 min-h-12 py-3 px-3 font-bold text-[11px] rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                  isPaused
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-200'
                }`}
              >
                {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                {isPaused ? 'Reprendre' : 'Pause'}
              </button>

              <button
                type="button"
                onClick={handleFinishClick}
                className="flex-1 min-h-12 py-3 px-3 bg-red-600 hover:bg-red-700 text-white font-bold text-[11px] rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5"
              >
                <Square className="w-3.5 h-3.5 fill-current" /> Sauvegarder
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-[2rem] p-5 shadow-xs space-y-3">
        <h3 className="font-bold text-xs text-zinc-900 uppercase tracking-wider flex items-center gap-1.5">
          Fichiers & Tracés GPX
        </h3>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex items-center justify-center gap-2 py-3 px-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold text-xs rounded-2xl cursor-pointer transition-colors border border-zinc-200">
            <Upload className="w-4 h-4 text-emerald-600" /> Importer GPX
            <input type="file" accept=".gpx" onChange={handleFileUpload} className="hidden" />
          </label>

          <button
            onClick={() => {
              if (pastTracks.length > 0) {
                downloadGpxFile(pastTracks[0]);
              } else {
                alert("Aucune trace disponible à exporter.");
              }
            }}
            disabled={pastTracks.length === 0}
            className="flex items-center justify-center gap-2 py-3 px-3 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs rounded-2xl transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-emerald-400" /> Exporter GPX
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-[2rem] p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-sm text-zinc-900 flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-emerald-600 shrink-0" /> Historique des Trajets
          </h3>
          <span className="shrink-0 text-xs font-semibold text-zinc-600 bg-zinc-100 ring-1 ring-zinc-200 px-3 py-0.5 rounded-full">
            {pastTracks.length} tracé(s)
          </span>
        </div>

        {pastTracks.length === 0 ? (
          <div className="py-6 text-center text-zinc-400 text-xs font-medium">
            Aucun trajet enregistré pour l'instant. Lancez le compteur GPS ci-dessus !
          </div>
        ) : (
          <div className="space-y-2">
            {pastTracks.map((track) => (
              <div
                key={track.id}
                className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-xs text-zinc-900 truncate">{track.title}</h4>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-500 font-medium mt-1 font-mono">
                    <span>{track.date}</span>
                    <span>{formatDistanceKm(track.distanceKm).value} {formatDistanceKm(track.distanceKm).unit}</span>
                    <span>Max {Math.round(track.maxSpeedKmH || maxSpeedKmH(track.points))} km/h</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => downloadGpxFile(track)}
                    className="touch-target flex items-center justify-center min-h-11 min-w-11 text-zinc-500 hover:text-zinc-900 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-zinc-200"
                    title="Télécharger GPX"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDeleteTrack(track.id)}
                    className="touch-target flex items-center justify-center min-h-11 min-w-11 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    title="Supprimer la trace"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSaveModal && (
        <div className="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-[2rem] p-6 shadow-2xl border border-zinc-200 animate-in fade-in zoom-in-95">
            <h3 className="font-bold text-sm text-zinc-900 mb-2">Sauvegarder la Trace GPS</h3>
            <form onSubmit={handleConfirmSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Nom de la trace</label>
                <input
                  type="text"
                  required
                  value={trackTitleInput}
                  onChange={(e) => setTrackTitleInput(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 focus:outline-hidden focus:ring-2 focus:ring-zinc-900 bg-zinc-50"
                />
              </div>

              <div className="text-xs text-emerald-800 bg-emerald-50 p-3 rounded-2xl border border-emerald-200 space-y-1">
                <p>
                  <strong>{distance.value} {distance.unit}</strong> · {formatTime(elapsedSeconds)} ·{' '}
                  {activeTrackPoints.length} points GPS
                </p>
                <p className="text-emerald-700/80">
                  Max {Math.round(maxSpeedKmH(activeTrackPoints))} km/h
                  {gpsAccuracyM != null ? ` · précision ±${gpsAccuracyM} m` : ''}
                </p>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaveModal(false)}
                  className="min-h-11 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="min-h-11 px-4 py-2 text-xs font-bold bg-zinc-900 text-white rounded-xl shadow-xs hover:bg-zinc-800"
                >
                  Confirmer et Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
