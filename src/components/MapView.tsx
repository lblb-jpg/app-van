import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { 
  MapPin, 
  Layers, 
  Locate, 
  Plus, 
  Filter,
  X,
  Crosshair,
  Navigation2
} from 'lucide-react';
import { Poi, PoiType, Friend, GpsTrack, GpsPoint, TripPhoto, Waypoint } from '../types';

interface MapViewProps {
  pois: Poi[];
  friends: Friend[];
  currentFriendId: string;
  activeTrackPoints: GpsPoint[];
  pastTracks: GpsTrack[];
  photos: TripPhoto[];
  waypoints: Waypoint[];
  userLocation: GpsPoint | null;
  focusLocation: {
    lat: number;
    lng: number;
    requestId: number;
    label?: string;
    emoji?: string;
  } | null;
  onAddPoi: (newPoi: Omit<Poi, 'id' | 'createdAt'>) => void;
  onAddPhoto: (newPhoto: Omit<TripPhoto, 'id'>) => void;
}

const TILE_LAYERS = {
  outdoor: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    name: 'Standard OpenStreetMap'
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data &copy; OpenStreetMap, SRTM | Map style &copy; OpenTopoMap',
    name: 'Relief Topographique (Rando)'
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    name: 'Satellite HD'
  }
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] || character);

const withoutSource = (notes?: string) =>
  notes
    ?.replace(/\s*·?\s*Source OpenStreetMap\s*:\s*https?:\/\/\S+/gi, '')
    .trim() || '';

export const MapView: React.FC<MapViewProps> = ({
  pois,
  friends,
  currentFriendId,
  activeTrackPoints,
  pastTracks,
  photos,
  waypoints,
  userLocation,
  focusLocation,
  onAddPoi,
  onAddPhoto
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const activePolylineRef = useRef<L.Polyline | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const hasFlownToUserRef = useRef(false);

  const [activeTile, setActiveTile] = useState<'outdoor' | 'topo' | 'satellite'>('outdoor');
  const [selectedPoiTypeFilter, setSelectedPoiTypeFilter] = useState<string>('all');
  const [selectedFriendFilter, setSelectedFriendFilter] = useState<string>('all');
  const [clickCoords, setClickCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const pickingLocationRef = useRef(false);

  // New POI state
  const [newPoiTitle, setNewPoiTitle] = useState('');
  const [newPoiDesc, setNewPoiDesc] = useState('');
  const [newPoiType, setNewPoiType] = useState<PoiType>('van_spot');
  const [newPoiAmenities, setNewPoiAmenities] = useState<string[]>(['eau', 'gratuit']);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    pickingLocationRef.current = isPickingLocation;
  }, [isPickingLocation]);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      const initialLat = userLocation?.lat || 45.8992;
      const initialLng = userLocation?.lng || 6.1294;

      const map = L.map(mapContainerRef.current, {
        zoomControl: false
      }).setView([initialLat, initialLng], 11);

      L.control.zoom({ position: 'bottomleft' }).addTo(map);

      const tileLayer = L.tileLayer(TILE_LAYERS[activeTile].url, {
        attribution: TILE_LAYERS[activeTile].attribution,
        maxZoom: 19
      }).addTo(map);

      tileLayerRef.current = tileLayer;

      const layerGroup = L.layerGroup().addTo(map);
      layerGroupRef.current = layerGroup;

      map.on('click', (e: L.LeafletMouseEvent) => {
        if (!pickingLocationRef.current) return;
        setClickCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
        setIsPickingLocation(false);
        setShowAddModal(true);
      });

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update Tile Layer
  useEffect(() => {
    if (!mapRef.current) return;
    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }
    const newTileLayer = L.tileLayer(TILE_LAYERS[activeTile].url, {
      attribution: TILE_LAYERS[activeTile].attribution,
      maxZoom: 19
    }).addTo(mapRef.current);
    tileLayerRef.current = newTileLayer;
  }, [activeTile]);

  // Fly to a waypoint selected from the itinerary.
  useEffect(() => {
    if (!mapRef.current || !focusLocation) return;
    mapRef.current.flyTo([focusLocation.lat, focusLocation.lng], 14, { duration: 0.9 });
  }, [focusLocation]);

  // Center the map once when GPS becomes available.
  useEffect(() => {
    if (!mapRef.current || !userLocation || hasFlownToUserRef.current) return;
    hasFlownToUserRef.current = true;
    mapRef.current.flyTo([userLocation.lat, userLocation.lng], 14, { duration: 1.1 });
  }, [userLocation]);

  // Update Markers, Polylines and Layers
  useEffect(() => {
    if (!mapRef.current || !layerGroupRef.current) return;

    const layerGroup = layerGroupRef.current;
    layerGroup.clearLayers();

    // 1. Draw Past Tracks
    pastTracks.forEach((track) => {
      if (track.points && track.points.length > 1) {
        const coords: [number, number][] = track.points.map((p) => [p.lat, p.lng]);
        L.polyline(coords, {
          color: '#64748b',
          weight: 4,
          opacity: 0.6,
          dashArray: '6, 8'
        })
          .bindTooltip(`Trace GPX : ${track.title} (${track.distanceKm} km)`, { sticky: true })
          .addTo(layerGroup);
      }
    });

    // 2. Draw Active GPS Track Recording Polyline
    if (activeTrackPoints.length > 1) {
      const coords: [number, number][] = activeTrackPoints.map((p) => [p.lat, p.lng]);
      L.polyline(coords, {
        color: '#059669', // Emerald
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(layerGroup);
    }

    // 3. Draw User Current GPS Location marker
    if (userLocation) {
      const liveIcon = L.divIcon({
        className: 'custom-live-marker',
        html: `<div class="relative flex items-center justify-center">
          <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-5 w-5 bg-emerald-600 border-2 border-white shadow-md"></span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      L.marker([userLocation.lat, userLocation.lng], { icon: liveIcon })
        .bindTooltip('Votre Van / GPS Position', { permanent: false })
        .addTo(layerGroup);
    }

    // 4. Draw Friends as live profile markers
    friends.forEach((friend) => {
      if (
        (selectedFriendFilter === 'all' || selectedFriendFilter === friend.id) &&
        friend.liveLat != null &&
        friend.liveLng != null
      ) {
        const isCurrentUser = friend.id === currentFriendId;
        const safeName = escapeHtml(friend.name);
        const safeRole = escapeHtml(friend.role || 'Membre de l’équipage');
        const safeAvatar = escapeHtml(friend.avatar);
        const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(friend.color) ? friend.color : '#059669';
        const battery = Math.max(0, Math.min(100, friend.battery ?? 85));
        const activity = escapeHtml(friend.lastActive || 'En direct');

        const avatarIcon = L.divIcon({
          className: 'map-profile-marker',
          html: `<div class="profile-marker ${isCurrentUser ? 'profile-marker--current' : ''}" style="--profile-color: ${safeColor}">
            <div class="profile-marker__pulse"></div>
            <div class="profile-marker__avatar-wrap">
              <img src="${safeAvatar}" alt="${safeName}" class="profile-marker__avatar" />
              <span class="profile-marker__presence"></span>
            </div>
            <div class="profile-marker__label">
              <strong>${isCurrentUser ? 'Vous' : safeName}</strong>
              <span>${isCurrentUser ? 'Position GPS' : activity}</span>
            </div>
          </div>`,
          iconSize: [180, 58],
          iconAnchor: [29, 29]
        });

        L.marker([friend.liveLat, friend.liveLng], { icon: avatarIcon })
          .bindPopup(`
            <div class="profile-popup">
              <div class="profile-popup__hero" style="--profile-color: ${safeColor}">
                <img src="${safeAvatar}" alt="${safeName}" class="profile-popup__avatar" />
                <div>
                  <div class="profile-popup__eyebrow">${isCurrentUser ? 'MON VAN' : 'ÉQUIPIER EN DIRECT'}</div>
                  <h3>${safeName}</h3>
                  <p>${safeRole}</p>
                </div>
              </div>
              <div class="profile-popup__stats">
                <span><b>${battery}%</b> batterie</span>
                <span class="profile-popup__live"><i></i>${activity}</span>
              </div>
            </div>
          `, { className: 'map-profile-popup', closeButton: false, offset: [0, -24] })
          .addTo(layerGroup);
      }
    });

    // 5. Draw Waypoints (Stages)
    waypoints.forEach((wp) => {
      const visibleNotes = withoutSource(wp.notes);
      const wpIcon = L.divIcon({
        className: 'wp-marker',
        html: `<div class="flex items-center justify-center w-7 h-7 rounded-full bg-slate-900 text-white font-black text-xs border-2 border-amber-400 shadow-md">
          ${wp.order}
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      L.marker([wp.lat, wp.lng], { icon: wpIcon })
        .bindPopup(`
          <div class="p-1 font-sans">
            <span class="text-[10px] uppercase font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Étape ${wp.order}</span>
            <h4 class="font-bold text-sm text-slate-900 mt-1">${escapeHtml(wp.title)}</h4>
            <p class="text-xs text-slate-600 mt-0.5">${escapeHtml(wp.locationName)}</p>
            ${visibleNotes ? `<p class="text-xs italic text-slate-500 mt-1 border-t pt-1 border-slate-100">${escapeHtml(visibleNotes)}</p>` : ''}
          </div>
        `)
        .addTo(layerGroup);
    });

    // 6. Draw POIs
    pois.forEach((poi) => {
      if (selectedPoiTypeFilter !== 'all' && poi.type !== selectedPoiTypeFilter) return;
      if (selectedFriendFilter !== 'all' && poi.createdByFriendId !== selectedFriendFilter) return;

      const creator = friends.find((f) => f.id === poi.createdByFriendId);
      const iconDetails = getPoiIconConfig(poi.type);

      const poiIcon = L.divIcon({
        className: 'poi-custom-marker',
        html: `<div class="flex items-center justify-center rounded-2xl p-1.5 shadow-md border-2 border-white text-white font-bold transition-transform hover:scale-110 cursor-pointer" style="background-color: ${iconDetails.bg}; width: 34px; height: 34px;">
          <span style="font-size: 16px;">${iconDetails.emoji}</span>
        </div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      const popupHtml = `
        <div class="p-1 font-sans max-w-[220px]">
          <div class="flex items-center gap-1.5 mb-1">
            <span class="text-xs font-bold px-2 py-0.5 rounded-full text-white" style="background-color: ${iconDetails.bg}">${iconDetails.label}</span>
          </div>
          <h4 class="font-extrabold text-sm text-slate-900">${poi.title}</h4>
          ${poi.description ? `<p class="text-xs text-slate-600 mt-1">${poi.description}</p>` : ''}
          ${
            poi.photoUrl
              ? `<img src="${poi.photoUrl}" class="w-full h-24 object-cover rounded-xl mt-2 border border-slate-200" />`
              : ''
          }
          <div class="flex items-center gap-1 mt-2 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
            <span>Ajouté par</span>
            <strong style="color: ${creator?.color || '#059669'}">${creator?.name || 'Copain'}</strong>
          </div>
        </div>
      `;

      L.marker([poi.lat, poi.lng], { icon: poiIcon })
        .bindPopup(popupHtml)
        .addTo(layerGroup);
    });

    // 7. Draw Photo pins
    photos.forEach((photo) => {
      if (photo.lat && photo.lng) {
        if (selectedFriendFilter !== 'all' && photo.friendId !== selectedFriendFilter) return;

        const photoIcon = L.divIcon({
          className: 'photo-marker',
          html: `<div class="w-8 h-8 rounded-lg border-2 border-white shadow-md overflow-hidden bg-slate-900">
            <img src="${photo.url}" class="w-full h-full object-cover" />
          </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        L.marker([photo.lat, photo.lng], { icon: photoIcon })
          .bindPopup(`
            <div class="p-1 font-sans max-w-[200px]">
              <img src="${photo.url}" class="w-full h-28 object-cover rounded-xl mb-1 border border-slate-200" />
              <p class="text-xs font-medium text-slate-800">${photo.caption || 'Photo souvenir Vanlife'}</p>
            </div>
          `)
          .addTo(layerGroup);
      }
    });

    // 8. Highlight the exact sleeping spot selected from search results.
    if (focusLocation?.emoji) {
      const focusIcon = L.divIcon({
        className: 'sleep-spot-focus-marker',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:12px;background:#fff;border:2px solid #eb6c32;box-shadow:0 6px 18px rgba(23,53,43,.22);font-size:17px;line-height:1;">${escapeHtml(focusLocation.emoji)}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 28],
      });

      const marker = L.marker([focusLocation.lat, focusLocation.lng], {
        icon: focusIcon,
        zIndexOffset: 1000,
      }).addTo(layerGroup);

      if (focusLocation.label) {
        marker.bindTooltip(escapeHtml(focusLocation.label), {
          direction: 'top',
          offset: [0, -24],
        });
      }
    }

  }, [pois, friends, pastTracks, activeTrackPoints, userLocation, photos, waypoints, focusLocation, selectedPoiTypeFilter, selectedFriendFilter]);

  const handleRecenter = () => {
    if (!mapRef.current) return;
    if (userLocation) {
      mapRef.current.flyTo([userLocation.lat, userLocation.lng], 14, { duration: 1.2 });
    } else if (waypoints.length > 0) {
      mapRef.current.flyTo([waypoints[0].lat, waypoints[0].lng], 12);
    }
  };

  const getDefaultCoords = () => {
    if (userLocation) return { lat: userLocation.lat, lng: userLocation.lng };
    const center = mapRef.current?.getCenter();
    if (center) return { lat: center.lat, lng: center.lng };
    return { lat: 45.8992, lng: 6.1294 };
  };

  const resetPoiForm = () => {
    setNewPoiTitle('');
    setNewPoiDesc('');
    setNewPoiType('van_spot');
    setNewPoiAmenities(['eau', 'gratuit']);
    setFormError('');
  };

  const openAddPoiForm = () => {
    resetPoiForm();
    setClickCoords(getDefaultCoords());
    setIsPickingLocation(false);
    setShowAddModal(true);
  };

  const closeAddPoiForm = () => {
    setShowAddModal(false);
    setIsPickingLocation(false);
    setFormError('');
  };

  const useMyLocation = () => {
    if (!userLocation) {
      setFormError('Position GPS indisponible pour le moment.');
      return;
    }
    setClickCoords({ lat: userLocation.lat, lng: userLocation.lng });
    setFormError('');
    mapRef.current?.flyTo([userLocation.lat, userLocation.lng], 15, { duration: 0.7 });
  };

  const useMapCenter = () => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    setClickCoords({ lat: center.lat, lng: center.lng });
    setFormError('');
  };

  const startPickOnMap = () => {
    setShowAddModal(false);
    setIsPickingLocation(true);
    setFormError('');
  };

  const handleCreatePoiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!newPoiTitle.trim()) {
      setFormError('Donne un nom au spot.');
      return;
    }
    if (!clickCoords) {
      setFormError('Choisis un emplacement sur la carte.');
      return;
    }

    onAddPoi({
      title: newPoiTitle.trim(),
      description: newPoiDesc.trim(),
      type: newPoiType,
      lat: clickCoords.lat,
      lng: clickCoords.lng,
      createdByFriendId: currentFriendId,
      amenities: newPoiAmenities,
    });

    resetPoiForm();
    setShowAddModal(false);
    setIsPickingLocation(false);
  };

  const toggleAmenity = (item: string) => {
    if (newPoiAmenities.includes(item)) {
      setNewPoiAmenities(newPoiAmenities.filter((a) => a !== item));
    } else {
      setNewPoiAmenities([...newPoiAmenities, item]);
    }
  };

  const poiTypes = [
    { id: 'van_spot' as const, label: 'Van spot', emoji: '🚐' },
    { id: 'water' as const, label: 'Eau', emoji: '🚰' },
    { id: 'viewpoint' as const, label: 'Vue', emoji: '📸' },
    { id: 'camping' as const, label: 'Camping', emoji: '⛺' },
    { id: 'fuel' as const, label: 'Carburant', emoji: '⛽' },
    { id: 'other' as const, label: 'Autre', emoji: '📍' },
  ];

  const liveCrewCount = friends.filter((f) => f.liveLat != null && f.liveLng != null).length;

  return (
    <div className="relative mt-1 w-full h-[calc(100dvh-7.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[420px] bg-[#dfe6dc] overflow-hidden sm:mt-2 sm:mx-auto sm:h-[calc(100dvh-116px)] sm:min-h-[560px] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-[2rem] sm:border sm:border-[#17352b]/10 sm:shadow-[0_24px_60px_rgba(23,53,43,.14)]">
      {/* Leaflet Container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Top Filter Overlay Pill */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex max-w-full min-w-0 flex-1 items-center gap-1.5 bg-[#fffdf8]/92 backdrop-blur-xl px-3.5 py-2 rounded-[1rem] border border-[#17352b]/10 shadow-[0_8px_24px_rgba(23,53,43,.12)] pointer-events-auto sm:flex-none">
          <Filter className="w-3.5 h-3.5 text-[#eb6c32] shrink-0" />
          <select
            value={selectedPoiTypeFilter}
            onChange={(e) => setSelectedPoiTypeFilter(e.target.value)}
            className="min-w-0 max-w-[10.5rem] bg-transparent text-xs font-extrabold text-[#17352b] focus:outline-hidden cursor-pointer sm:max-w-none"
          >
            <option value="all">Tous les spots</option>
            <option value="van_spot">🚐 Spots Van dodo</option>
            <option value="water">🚰 Points d'eau</option>
            <option value="viewpoint">📸 Panoramas & Vues</option>
            <option value="camping">⛺ Campings</option>
            <option value="fuel">⛽ Carburant / Gaz</option>
          </select>
        </div>

        {/* Layer Tile Selector Dropdown */}
        <div className="flex items-center gap-1 bg-[#fffdf8]/92 backdrop-blur-xl px-2 py-1.5 rounded-[1rem] border border-[#17352b]/10 shadow-[0_8px_24px_rgba(23,53,43,.12)] pointer-events-auto">
          <Layers className="w-3.5 h-3.5 text-[#eb6c32] ml-1" />
          {(['outdoor', 'topo', 'satellite'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setActiveTile(mode)}
              className={`min-h-9 px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-colors ${
                activeTile === mode
                  ? 'bg-[#17352b] text-white shadow-xs'
                  : 'text-[#68756d] hover:bg-[#eee9de]'
              }`}
            >
              {mode === 'outdoor' ? 'Plan' : mode === 'topo' ? 'Topo' : 'Sat'}
            </button>
          ))}
        </div>
      </div>

      {/* Live crew selector */}
      {friends.length > 0 && (
        <div className="absolute top-16 left-3 right-3 z-10 pointer-events-none">
          <div className="map-crew-bar pointer-events-auto">
            <button
              type="button"
              onClick={() => setSelectedFriendFilter('all')}
              className={`map-crew-filter ${selectedFriendFilter === 'all' ? 'map-crew-filter--active' : ''}`}
              title="Afficher tout l'équipage"
            >
              <span className="map-crew-filter__all">{friends.length}</span>
              <span className="map-crew-filter__meta">
                <b>Équipage</b>
                <small>
                  <i className={liveCrewCount > 0 ? 'is-live' : 'is-off'} />
                  {liveCrewCount > 0 ? `${liveCrewCount} en ligne` : 'Hors ligne'}
                </small>
              </span>
            </button>
            {friends.map((friend) => {
              const isSelected = selectedFriendFilter === friend.id;
              const isCurrentUser = friend.id === currentFriendId;
              const isLive = friend.liveLat != null && friend.liveLng != null;
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => setSelectedFriendFilter(isSelected ? 'all' : friend.id)}
                  className={`map-crew-filter ${isSelected ? 'map-crew-filter--active' : ''}`}
                  title={`Afficher les repères de ${friend.name}`}
                >
                  <span
                    className={`map-crew-filter__avatar ${isLive ? 'is-live' : 'is-off'}`}
                    style={{ borderColor: friend.color }}
                  >
                    <img src={friend.avatar} alt="" />
                    {isLive && <i />}
                  </span>
                  <span className="map-crew-filter__meta">
                    <b>{isCurrentUser ? 'Vous' : friend.name}</b>
                    <small>
                      <i className={isLive ? 'is-live' : 'is-off'} />
                      {isLive ? friend.lastActive || 'En direct' : 'Hors ligne'}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating actions: add POI + recenter */}
      <div className="absolute bottom-[calc(7.25rem+env(safe-area-inset-bottom))] right-4 z-10 flex flex-col gap-2">
        <button
          type="button"
          onClick={openAddPoiForm}
          className="p-3.5 bg-[#17352b] text-white rounded-[1.1rem] shadow-[0_10px_25px_rgba(23,53,43,.28)] border border-white/20 hover:bg-[#285849] active:scale-95 transition-all"
          title="Ajouter un point sur la carte"
          aria-label="Ajouter un point sur la carte"
        >
          <Plus className="w-5 h-5 text-white" />
        </button>
        <button
          type="button"
          onClick={handleRecenter}
          className="p-3.5 bg-[#eb6c32] text-white rounded-[1.1rem] shadow-[0_10px_25px_rgba(235,108,50,.34)] border border-white/30 hover:bg-[#d95d29] active:scale-95 transition-all"
          title="Centrer sur mon Van / Ma Position"
        >
          <Locate className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Pick location banner */}
      {isPickingLocation && (
        <div className="absolute inset-x-3 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] z-20 pointer-events-none">
          <div className="mx-auto max-w-sm rounded-2xl bg-[#17352b] text-white px-4 py-3 shadow-xl pointer-events-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <Crosshair className="w-4 h-4 text-emerald-300" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-extrabold truncate">Touche la carte pour placer</p>
                <p className="text-[10px] text-white/65 font-medium">Le point sera ajouté à cet endroit</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsPickingLocation(false);
                setShowAddModal(true);
              }}
              className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15"
            >
              Retour
            </button>
          </div>
        </div>
      )}

      {/* Add POI form */}
      {showAddModal && clickCoords && (
        <div className="fixed inset-0 z-50 bg-[#17352b]/35 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[#fffdf8] rounded-t-[1.75rem] sm:rounded-[2rem] p-5 sm:p-6 shadow-2xl border border-[#17352b]/10 animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#17352b]/15 sm:hidden" />

            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#17352b] text-white flex items-center justify-center shadow-md">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-[#17352b] text-base leading-tight">Ajouter un point</h3>
                  <p className="text-[11px] text-[#68756d] font-medium mt-0.5">Spot visible par tout l’équipage</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAddPoiForm}
                className="touch-target flex items-center justify-center min-h-11 min-w-11 rounded-full text-[#68756d] hover:bg-[#17352b]/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePoiSubmit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold text-[#17352b]">Nom du spot</span>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="Bivouac lac, fontaine, belvédère…"
                  value={newPoiTitle}
                  onChange={(e) => setNewPoiTitle(e.target.value)}
                  className="w-full text-sm font-semibold px-3.5 py-3 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#17352b]"
                />
              </label>

              <div>
                <span className="block text-[11px] font-bold text-[#17352b] mb-2">Type</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {poiTypes.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => setNewPoiType(t.id)}
                      className={`py-2.5 px-2 rounded-2xl text-[10px] leading-tight font-bold border transition-all ${
                        newPoiType === t.id
                          ? 'border-[#17352b] bg-[#17352b] text-white shadow-sm'
                          : 'border-[#17352b]/10 bg-white text-[#3d4a42] hover:bg-[#f5f1e7]'
                      }`}
                    >
                      <span className="block text-base leading-none mb-1">{t.emoji}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[#17352b]/10 bg-white p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[#17352b]">Emplacement</p>
                    <p className="text-[11px] font-mono text-[#68756d] truncate">
                      {clickCoords.lat.toFixed(5)}, {clickCoords.lng.toFixed(5)}
                    </p>
                  </div>
                  <MapPin className="w-4 h-4 text-[#eb6c32] shrink-0" />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={useMyLocation}
                    className="flex flex-col items-center gap-1 rounded-xl bg-[#f5f1e7] px-2 py-2 text-[10px] font-bold text-[#17352b] hover:bg-[#ebe4d4]"
                  >
                    <Navigation2 className="w-3.5 h-3.5 text-[#eb6c32]" />
                    Ma pos.
                  </button>
                  <button
                    type="button"
                    onClick={useMapCenter}
                    className="flex flex-col items-center gap-1 rounded-xl bg-[#f5f1e7] px-2 py-2 text-[10px] font-bold text-[#17352b] hover:bg-[#ebe4d4]"
                  >
                    <Crosshair className="w-3.5 h-3.5 text-[#eb6c32]" />
                    Centre
                  </button>
                  <button
                    type="button"
                    onClick={startPickOnMap}
                    className="flex flex-col items-center gap-1 rounded-xl bg-[#17352b] px-2 py-2 text-[10px] font-bold text-white hover:bg-[#285849]"
                  >
                    <MapPin className="w-3.5 h-3.5 text-emerald-300" />
                    Sur carte
                  </button>
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-[11px] font-bold text-[#17352b]">Note <span className="font-medium text-[#68756d]">(optionnel)</span></span>
                <input
                  type="text"
                  placeholder="Ombre, calme, 4G…"
                  value={newPoiDesc}
                  onChange={(e) => setNewPoiDesc(e.target.value)}
                  className="w-full text-xs font-medium px-3.5 py-2.5 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#17352b]"
                />
              </label>

              <div>
                <span className="block text-[11px] font-bold text-[#17352b] mb-2">Commodités</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'eau', label: '🚰 Eau' },
                    { id: 'ombre', label: '🌲 Ombre' },
                    { id: 'gratuit', label: '🆓 Gratuit' },
                    { id: 'wc', label: '🚽 WC' },
                    { id: 'douche', label: '🚿 Douche' },
                    { id: 'vue_panoramique', label: '🏔️ Vue' },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => toggleAmenity(item.id)}
                      className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
                        newPoiAmenities.includes(item.id)
                          ? 'bg-[#17352b] text-white'
                          : 'bg-white text-[#3d4a42] ring-1 ring-[#17352b]/12'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  {formError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeAddPoiForm}
                  className="flex-1 px-4 py-3 rounded-2xl text-xs font-bold text-[#68756d] hover:bg-[#17352b]/5"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-[1.5] px-4 py-3 rounded-2xl text-xs font-bold bg-[#eb6c32] text-white shadow-[0_8px_20px_rgba(235,108,50,.28)] hover:bg-[#d95d29]"
                >
                  Enregistrer le spot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

function getPoiIconConfig(type: PoiType) {
  switch (type) {
    case 'van_spot':
      return { emoji: '🚐', bg: '#059669', label: 'Spot Van' };
    case 'water':
      return { emoji: '🚰', bg: '#0284c7', label: 'Point d\'Eau' };
    case 'viewpoint':
      return { emoji: '📸', bg: '#d97706', label: 'Panorama' };
    case 'camping':
      return { emoji: '⛺', bg: '#7c3aed', label: 'Camping' };
    case 'fuel':
      return { emoji: '⛽', bg: '#dc2626', label: 'Station' };
    default:
      return { emoji: '📍', bg: '#475569', label: 'Point d\'intérêt' };
  }
}
