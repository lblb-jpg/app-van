import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BedDouble,
  Check,
  ChevronDown,
  Clock3,
  Droplets,
  ExternalLink,
  Info,
  LoaderCircle,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { FrancePlace, VanSleepSearchResult, VanSleepSpot } from '../types';
import { searchVanSleepSpots, suggestFrenchPlaces } from '../services/vanSpots';

interface VanSleepSearchProps {
  onSelectOnMap: (lat: number, lng: number, label?: string, emoji?: string) => void;
  onSaveSpot: (spot: VanSleepSpot) => void;
}

type Filter = 'all' | 'recommended' | 'free' | 'water';
const RECENT_KEY = 'vanlife_sleep_searches_v1';
const normalizeQuery = (value: string) => value.trim().toLocaleLowerCase('fr');

function readRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

function detailValue(value?: string) {
  if (!value) return null;
  if (value === 'yes') return 'Oui';
  if (value === 'no') return 'Non';
  return value;
}

function getSpotEmoji(spot: VanSleepSpot) {
  const description = `${spot.label} ${spot.name}`.toLowerCase();
  if (description.includes('camping')) return '⛺';
  if (description.includes('parking')) return '🅿️';
  if (description.includes('aire')) return '🚐';
  return '📍';
}

export const VanSleepSearch: React.FC<VanSleepSearchProps> = ({ onSelectOnMap, onSaveSpot }) => {
  const [query, setQuery] = useState('');
  const [radiusKm, setRadiusKm] = useState(20);
  const [result, setResult] = useState<VanSleepSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [visibleCount, setVisibleCount] = useState(12);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState(readRecentSearches);
  const [suggestions, setSuggestions] = useState<FrancePlace[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [queryEdited, setQueryEdited] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [navigationSpot, setNavigationSpot] = useState<VanSleepSpot | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const suggestionAbortRef = useRef<AbortController | null>(null);
  const skipNextSuggestionRef = useRef(false);

  useEffect(() => {
    if (skipNextSuggestionRef.current) {
      skipNextSuggestionRef.current = false;
      return;
    }
    if (!queryEdited) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2 || loading) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      suggestionAbortRef.current?.abort();
      const controller = new AbortController();
      suggestionAbortRef.current = controller;
      setSuggesting(true);
      try {
        const places = await suggestFrenchPlaces(trimmed, controller.signal);
        setSuggestions(places);
        setShowSuggestions(places.length > 0);
      } catch (suggestionError) {
        if ((suggestionError as DOMException)?.name !== 'AbortError') setSuggestions([]);
      } finally {
        if (suggestionAbortRef.current === controller) setSuggesting(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query, loading, queryEdited]);

  const runSearch = async (searchQuery = query, place?: FrancePlace) => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setError('Entre le nom d’une ville ou d’un village.');
      return;
    }

    abortRef.current?.abort();
    suggestionAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setQueryEdited(false);
    setSubmittedQuery(normalizeQuery(trimmed));
    setSuggestions([]);
    setVisibleCount(12);
    setExpandedId(null);
    setShowSuggestions(false);
    try {
      const data = await searchVanSleepSpots(trimmed, radiusKm, place, controller.signal);
      setResult(data);
      setQuery(trimmed);
      const nextRecent = [trimmed, ...recentSearches.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 5);
      setRecentSearches(nextRecent);
      localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent));
    } catch (searchError) {
      if ((searchError as DOMException)?.name !== 'AbortError') {
        setError(searchError instanceof Error ? searchError.message : 'Recherche indisponible.');
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  };

  const filteredSpots = useMemo(() => {
    const spots = result?.spots || [];
    if (filter === 'recommended') return spots.filter((spot) => spot.confidence !== 'verify');
    if (filter === 'free') return spots.filter((spot) => spot.fee === 'no' || spot.feeAmount === '0');
    if (filter === 'water') return spots.filter((spot) => (spot.amenities || []).includes('Eau potable'));
    return spots;
  }, [result, filter]);

  const saveSpot = (spot: VanSleepSpot) => {
    onSaveSpot(spot);
    setSavedIds((items) => items.includes(spot.id) ? items : [...items, spot.id]);
  };

  return (
    <div className="page-pad space-y-3 sm:space-y-4">
      <section className="relative overflow-visible rounded-[1.75rem] bg-[#17352b] p-4 text-white shadow-[0_20px_50px_rgba(23,53,43,.16)] sm:rounded-[2rem] sm:p-6 md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[#eb6c32]/20 blur-3xl sm:-right-20 sm:-top-24 sm:h-64 sm:w-64" />
        <div className="relative">
          <div className="flex items-start gap-2.5 sm:gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-[#ff9a62] ring-1 ring-white/10 sm:h-11 sm:w-11 sm:rounded-2xl">
              <BedDouble className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[8px] font-extrabold uppercase tracking-[.16em] text-[#ff9a62] sm:text-[9px] sm:tracking-[.18em]">
                Moteur de spots van
              </p>
              <h2 className="mt-0.5 text-[1.35rem] font-extrabold leading-tight tracking-tight sm:mt-1 sm:text-2xl">
                Où dormir ce soir&nbsp;?
              </h2>
              <p className="mt-1 max-w-[34ch] text-[10px] font-semibold leading-relaxed text-white/50 sm:max-w-none sm:text-[11px]">
                Entre seulement une ville&nbsp;: on cherche jusqu’à 80 lieux autour.
              </p>
            </div>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
            className="relative mt-4 flex items-stretch gap-1.5 rounded-[1.2rem] bg-white p-1.5 shadow-xl sm:mt-5 sm:gap-2 sm:rounded-[1.35rem]"
          >
            <label className="flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-2.5">
              <Search className="h-4 w-4 shrink-0 text-[#eb6c32]" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setQueryEdited(true);
                }}
                placeholder="Annecy, Chamonix, Gordes…"
                aria-label="Ville ou village"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[13px] font-bold text-[#17352b] outline-none placeholder:text-zinc-400 sm:py-2 sm:text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[0.95rem] bg-[#eb6c32] text-white shadow-md transition-all hover:bg-[#d95d29] disabled:opacity-60 sm:rounded-[1rem]"
              aria-label="Rechercher des spots"
            >
              {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            </button>

            {showSuggestions && queryEdited && normalizeQuery(query) !== submittedQuery && (
              <div className="absolute left-0 right-0 top-[calc(100%+.45rem)] z-30 max-h-[min(18rem,50dvh)] overflow-y-auto rounded-[1.2rem] border border-[#17352b]/10 bg-white p-1.5 text-[#17352b] shadow-2xl sm:max-h-72 sm:rounded-[1.35rem]">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[9px] font-extrabold uppercase tracking-[.14em] text-zinc-400">Communes de France</span>
                  {suggesting && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#eb6c32]" />}
                </div>
                {suggestions.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => {
                      skipNextSuggestionRef.current = true;
                      setQuery(place.name);
                      setSuggestions([]);
                      setShowSuggestions(false);
                      void runSearch(place.name, place);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-left transition-colors hover:bg-[#f5f1e7] sm:gap-3 sm:px-3"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-xs">{place.name} {place.postalCode && `(${place.postalCode})`}</strong>
                      <small className="mt-0.5 block truncate text-[9px] font-semibold text-zinc-400">
                        {place.department} · {place.region}
                      </small>
                    </span>
                    {place.population > 0 && (
                      <span className="hidden shrink-0 text-[8px] font-bold text-zinc-300 sm:inline">
                        {place.population.toLocaleString('fr-FR')} hab.
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </form>

          <div className="mt-3 flex flex-col gap-2.5 sm:mt-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="relative min-w-0 flex-1">
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {recentSearches.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setQuery(item);
                      void runSearch(item);
                    }}
                    title={item}
                    className="max-w-[9.5rem] shrink-0 truncate rounded-full bg-white/8 px-2.5 py-1.5 text-[9px] font-bold text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/15 sm:max-w-[11rem] sm:py-1"
                  >
                    {item}
                  </button>
                ))}
              </div>
              {recentSearches.length > 0 && (
                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#17352b] to-transparent sm:w-10" />
              )}
            </div>
            <label className="flex shrink-0 items-center justify-between gap-2 rounded-full bg-white/8 px-3 py-1.5 ring-1 ring-white/10 sm:justify-start sm:py-1">
              <span className="text-[9px] font-extrabold uppercase tracking-[.12em] text-white/45 sm:hidden">Rayon</span>
              <select
                value={radiusKm}
                onChange={(event) => setRadiusKm(Number(event.target.value))}
                aria-label="Rayon de recherche"
                className="border-0 bg-transparent text-[10px] font-extrabold text-white outline-none sm:text-[9px]"
              >
                <option value={10}>10 km</option>
                <option value={20}>20 km</option>
                <option value={30}>30 km</option>
                <option value={40}>40 km</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading && (
        <div className="rounded-[2rem] border border-[#17352b]/10 bg-white/75 p-8 text-center shadow-sm">
          <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-[#eb6c32]" />
          <h3 className="mt-3 text-sm font-extrabold text-[#17352b]">Exploration des alentours…</h3>
          <p className="mt-1 text-[10px] font-semibold text-zinc-500">Campings, aires, haltes et parkings sont analysés.</p>
        </div>
      )}

      {result && !loading && (
        <>
          <section className="rounded-[2rem] border border-[#17352b]/10 bg-white/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-[.14em] text-[#eb6c32]">Zone trouvée</p>
                <h3 className="mt-1 truncate text-base font-extrabold text-[#17352b]">{result.place?.name || result.query}</h3>
                <p className="mt-1 text-[10px] font-semibold text-zinc-500">
                  {result.count} lieu(x) dans un rayon de {result.radiusKm} km
                </p>
              </div>
              <span className="shrink-0 rounded-2xl bg-emerald-50 px-3 py-2 text-center text-emerald-800 ring-1 ring-emerald-200">
                <strong className="block text-lg font-black">{(result.spots || []).filter((spot) => spot.confidence === 'official').length}</strong>
                <small className="text-[8px] font-extrabold uppercase">officiels</small>
              </span>
            </div>

            <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {([
                ['all', `Tous (${result.count})`],
                ['recommended', 'Recommandés'],
                ['free', 'Gratuits'],
                ['water', 'Avec eau'],
              ] as [Filter, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setFilter(id);
                    setVisibleCount(12);
                  }}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-extrabold transition-colors ${
                    filter === id ? 'bg-[#17352b] text-white' : 'bg-[#f0ece2] text-[#68756d]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <div className="space-y-3">
            {filteredSpots.slice(0, visibleCount).map((spot, index) => {
              const expanded = expandedId === spot.id;
              const official = spot.confidence === 'official';
              const likely = spot.confidence === 'likely';
              return (
                <article key={spot.id} className="overflow-hidden rounded-[1.75rem] border border-[#17352b]/10 bg-white/90 shadow-[0_12px_35px_rgba(23,53,43,.06)]">
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-black ${
                        official ? 'bg-emerald-100 text-emerald-800' : likely ? 'bg-orange-100 text-orange-800' : 'bg-zinc-100 text-zinc-600'
                      }`}>
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-extrabold text-[#17352b]">{spot.name}</h3>
                            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] font-semibold text-zinc-500">
                              <MapPin className="h-3 w-3 shrink-0 text-[#eb6c32]" />
                              <span className="truncate">{spot.label} · {spot.distanceKm} km</span>
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-extrabold uppercase ${
                            official
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                              : likely
                                ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
                                : 'bg-zinc-100 text-zinc-500'
                          }`}>
                            {official ? 'Officiel' : likely ? 'Probable' : 'À vérifier'}
                          </span>
                        </div>

                        {spot.amenities?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {spot.amenities.slice(0, 5).map((amenity) => (
                              <span key={amenity} className="rounded-full bg-[#f0ece2] px-2 py-1 text-[8px] font-bold text-[#59675f]">
                                {amenity}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectOnMap(spot.lat, spot.lng, spot.name, getSpotEmoji(spot))}
                        className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-[#f0ece2] py-2 text-[9px] font-extrabold text-[#17352b]"
                      >
                        <MapPin className="h-3.5 w-3.5" /> Carte
                      </button>
                      <button
                        type="button"
                        onClick={() => setNavigationSpot(spot)}
                        className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-[#17352b] py-2 text-[9px] font-extrabold text-white"
                      >
                        <Navigation className="h-3.5 w-3.5 text-[#ff9a62]" /> Y aller
                      </button>
                      <button
                        type="button"
                        onClick={() => saveSpot(spot)}
                        className={`flex min-h-11 items-center justify-center gap-1 rounded-xl py-2 text-[9px] font-extrabold ${
                          savedIds.includes(spot.id) ? 'bg-emerald-100 text-emerald-800' : 'bg-[#eb6c32] text-white'
                        }`}
                      >
                        {savedIds.includes(spot.id) ? <Check className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {savedIds.includes(spot.id) ? 'Ajouté' : 'Étape'}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : spot.id)}
                      className="mt-2.5 flex min-h-9 w-full items-center justify-center gap-1 text-[9px] font-bold text-zinc-400 hover:text-zinc-700"
                    >
                      {expanded ? 'Moins de détails' : 'Toutes les informations'}
                      <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {expanded && (
                    <div className="border-t border-[#17352b]/8 bg-[#faf8f2] px-4 py-3">
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        {spot.fee && <Detail icon={<span>€</span>} label="Tarif" value={spot.fee === 'no' ? 'Gratuit' : spot.feeAmount || 'Payant'} />}
                        {spot.openingHours && <Detail icon={<Clock3 />} label="Horaires" value={spot.openingHours} />}
                        {spot.capacity && <Detail icon={<Info />} label="Capacité" value={spot.capacity} />}
                        {spot.maxstay && <Detail icon={<Clock3 />} label="Durée max." value={spot.maxstay} />}
                        {spot.access && <Detail icon={<ShieldCheck />} label="Accès" value={detailValue(spot.access)!} />}
                        {spot.surface && <Detail icon={<Info />} label="Sol" value={spot.surface} />}
                        {spot.amenities?.includes('Eau potable') && <Detail icon={<Droplets />} label="Eau" value="Disponible" />}
                        {spot.amenities?.includes('Électricité') && <Detail icon={<Zap />} label="Électricité" value="Disponible" />}
                      </div>
                      {spot.description && <p className="mt-3 rounded-xl bg-white p-2.5 text-[10px] leading-relaxed text-zinc-600 ring-1 ring-zinc-200">{spot.description}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {spot.website && <a href={spot.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[9px] font-bold text-[#eb6c32]"><ExternalLink className="h-3 w-3" /> Site web</a>}
                        {spot.phone && <a href={`tel:${spot.phone}`} className="text-[9px] font-bold text-[#17352b]">☎ {spot.phone}</a>}
                        <a href={spot.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[9px] font-bold text-zinc-500"><ExternalLink className="h-3 w-3" /> Voir sur OpenStreetMap</a>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

            {filteredSpots.length === 0 && (
              <div className="rounded-[2rem] border border-dashed border-zinc-300 bg-white/60 p-8 text-center">
                <BedDouble className="mx-auto h-6 w-6 text-zinc-300" />
                <p className="mt-2 text-xs font-bold text-zinc-500">Aucun lieu ne correspond à ce filtre.</p>
              </div>
            )}

            {visibleCount < filteredSpots.length && (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + 12)}
                className="w-full rounded-2xl border border-[#17352b]/10 bg-white py-3 text-xs font-extrabold text-[#17352b] shadow-sm"
              >
                Afficher 12 lieux supplémentaires
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-[10px] font-semibold leading-relaxed text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {result.notice}
            </p>
            <p className="mt-2 text-[8px] font-medium text-amber-700">{result.attribution}</p>
          </div>
        </>
      )}

      {navigationSpot && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#17352b]/45 p-4 backdrop-blur-xs sm:items-center">
          <div className="w-full max-w-sm rounded-[1.75rem] bg-white p-5 shadow-2xl">
            <p className="text-[9px] font-extrabold uppercase tracking-[.16em] text-[#eb6c32]">
              Ouvrir l’itinéraire
            </p>
            <h3 className="mt-1 min-w-0 truncate text-base font-extrabold text-[#17352b]">
              Aller à {navigationSpot.name}
            </h3>
            <p className="mt-1 text-[10px] font-semibold text-zinc-500">
              Avec quelle application veux-tu partir ?
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={`https://www.waze.com/ul?ll=${navigationSpot.lat},${navigationSpot.lng}&navigate=yes&utm_source=vanlife-club`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setNavigationSpot(null)}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#33ccff] px-3 py-3 text-xs font-extrabold text-[#17352b]"
              >
                🚙 Waze
              </a>
              <a
                href={navigationSpot.navigationUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setNavigationSpot(null)}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#17352b] px-3 py-3 text-xs font-extrabold text-white"
              >
                📍 Google Maps
              </a>
            </div>

            <button
              type="button"
              onClick={() => setNavigationSpot(null)}
              className="mt-3 w-full py-2 text-[10px] font-bold text-zinc-400"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Detail: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="rounded-xl bg-white p-2.5 ring-1 ring-zinc-200">
    <span className="flex items-center gap-1 text-[8px] font-extrabold uppercase tracking-wide text-zinc-400 [&_svg]:h-3 [&_svg]:w-3">{icon}{label}</span>
    <strong className="mt-1 block break-words text-[10px] text-[#17352b]">{value}</strong>
  </div>
);
