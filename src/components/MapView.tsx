import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapPin,
  Layers,
  Locate,
  Plus,
  Filter,
  Crosshair,
  Navigation2,
  ChevronUp,
  ChevronDown,
  Gauge,
  Mountain,
} from 'lucide-react';
import {
  Poi,
  PoiType,
  Friend,
  GpsPoint,
  GpsTrack,
  TripPhoto,
  VanSleepSpot,
  Waypoint,
  JournalNote,
} from '../types';
import { FRANCE_MAP_CENTER, FRANCE_MAP_ZOOM, LOCAL_MAP_ZOOM } from '../lib/mapDefaults';
import { getSleepSpotEmoji, hasValidCoords, sleepSpotBorderColor, toLeafletCoords } from '../lib/mapCoords';
import { SimpleFormModal } from './SimpleFormModal';
import {
  CompactFormChip,
  CompactFormField,
  CompactFormHero,
  CompactFormRoot,
  CompactFormSection,
  CompactFormTextInput,
  FormModalFooter,
} from './CompactFormLayout';
import { MapInfoPanel, MapSelection } from './MapInfoPanel';

interface MapViewProps {
  pois: Poi[];
  friends: Friend[];
  currentFriendId: string;
  photos: TripPhoto[];
  waypoints: Waypoint[];
  journal?: JournalNote[];
  sleepSpots?: VanSleepSpot[];
  pastTracks?: GpsTrack[];
  activeTrackPoints?: GpsPoint[];
  userLocation: GpsPoint | null;
  focusLocation: {
    lat: number;
    lng: number;
    requestId: number;
    label?: string;
    emoji?: string;
  } | null;
  mapVisible?: boolean;
  onAddPoi: (newPoi: Omit<Poi, 'id' | 'createdAt'>) => void;
  onAddPhoto: (newPhoto: Omit<TripPhoto, 'id'>) => void;
}

const TILE_LAYERS = {
  outdoor: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    name: 'Standard OpenStreetMap',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data &copy; OpenStreetMap, SRTM | Map style &copy; OpenTopoMap',
    name: 'Relief Topographique (Rando)',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    name: 'Satellite HD',
  },
};

function getPoiIconConfig(type: PoiType) {
  switch (type) {
    case 'van_spot':
      return { emoji: '🚐', bg: '#059669', label: 'Spot Van' };
    case 'water':
      return { emoji: '🚰', bg: '#0284c7', label: "Point d'eau" };
    case 'viewpoint':
      return { emoji: '📸', bg: '#d97706', label: 'Panorama' };
    case 'camping':
      return { emoji: '⛺', bg: '#7c3aed', label: 'Camping' };
    case 'fuel':
      return { emoji: '⛽', bg: '#dc2626', label: 'Station' };
    default:
      return { emoji: '📍', bg: '#475569', label: "Point d'intérêt" };
  }
}

function waypointMarkerStyle(status: Waypoint['status']) {
  if (status === 'done') return { bg: '#64748b', border: '#94a3b8' };
  if (status === 'active') return { bg: '#eb6c32', border: '#fbbf24' };
  return { bg: '#17352b', border: '#fbbf24' };
}

export const MapView: React.FC<MapViewProps> = ({
  pois,
  friends,
  currentFriendId,
  activeTrackPoints = [],
  pastTracks = [],
  photos,
  waypoints,
  journal = [],
  sleepSpots = [],
  userLocation,
  focusLocation,
  mapVisible = true,
  onAddPoi,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const hasFlownToUserRef = useRef(false);
  const onSelectRef = useRef<(sel: MapSelection | null) => void>(() => {});

  const [activeTile, setActiveTile] = useState<'outdoor' | 'topo' | 'satellite'>('satellite');
  const [selectedPoiTypeFilter, setSelectedPoiTypeFilter] = useState<string>('all');
  const [selectedFriendFilter, setSelectedFriendFilter] = useState<string>('all');
  const [clickCoords, setClickCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<MapSelection | null>(null);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const pickingLocationRef = useRef(false);

  const [newPoiTitle, setNewPoiTitle] = useState('');
  const [newPoiDesc, setNewPoiDesc] = useState('');
  const [newPoiType, setNewPoiType] = useState<PoiType>('van_spot');
  const [newPoiAmenities, setNewPoiAmenities] = useState<string[]>(['eau', 'gratuit']);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    pickingLocationRef.current = isPickingLocation;
  }, [isPickingLocation]);

  useEffect(() => {
    onSelectRef.current = setSelectedFeature;
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      const initialLat = userLocation?.lat ?? FRANCE_MAP_CENTER.lat;
      const initialLng = userLocation?.lng ?? FRANCE_MAP_CENTER.lng;
      const initialZoom = userLocation ? LOCAL_MAP_ZOOM : FRANCE_MAP_ZOOM;

      const map = L.map(mapContainerRef.current, { zoomControl: false }).setView(
        [initialLat, initialLng],
        initialZoom
      );

      L.control.zoom({ position: 'bottomleft' }).addTo(map);

      const tileLayer = L.tileLayer(TILE_LAYERS[activeTile].url, {
        attribution: TILE_LAYERS[activeTile].attribution,
        maxZoom: 19,
      }).addTo(map);

      tileLayerRef.current = tileLayer;
      layerGroupRef.current = L.layerGroup().addTo(map);

      map.on('click', (e: L.LeafletMouseEvent) => {
        if (pickingLocationRef.current) {
          setClickCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
          setIsPickingLocation(false);
          setShowAddModal(true);
          return;
        }
        onSelectRef.current(null);
      });

      mapRef.current = map;
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    const newTileLayer = L.tileLayer(TILE_LAYERS[activeTile].url, {
      attribution: TILE_LAYERS[activeTile].attribution,
      maxZoom: 19,
    }).addTo(mapRef.current);
    tileLayerRef.current = newTileLayer;
  }, [activeTile]);

  useEffect(() => {
    if (!mapRef.current || !focusLocation || !mapVisible) return;
    hasFlownToUserRef.current = true;
    const map = mapRef.current;
    const { lat, lng } = focusLocation;

    const centerOnSpot = () => {
      map.invalidateSize({ animate: false });
      map.flyTo([lat, lng], 17, { duration: 0.85 });
    };

    centerOnSpot();
    const retryTimer = window.setTimeout(centerOnSpot, 180);
    return () => window.clearTimeout(retryTimer);
  }, [mapVisible, focusLocation?.requestId, focusLocation?.lat, focusLocation?.lng]);

  useEffect(() => {
    if (!mapRef.current || !userLocation || hasFlownToUserRef.current || focusLocation || !mapVisible) return;
    hasFlownToUserRef.current = true;
    mapRef.current.invalidateSize({ animate: false });
    mapRef.current.flyTo([userLocation.lat, userLocation.lng], 14, { duration: 1.1 });
  }, [userLocation, focusLocation, mapVisible]);

  // Auto-select focused spot
  useEffect(() => {
    if (!focusLocation) return;
    const matchSpot = sleepSpots.find(
      (s) =>
        Math.abs(s.lat - focusLocation.lat) < 0.00001 &&
        Math.abs(s.lng - focusLocation.lng) < 0.00001
    );
    if (matchSpot) {
      setSelectedFeature({ type: 'sleepSpot', id: matchSpot.id });
      return;
    }
    const matchWp = waypoints.find(
      (w) =>
        hasValidCoords(w.lat, w.lng) &&
        Math.abs(w.lat - focusLocation.lat) < 0.00001 &&
        Math.abs(w.lng - focusLocation.lng) < 0.00001
    );
    if (matchWp) {
      setSelectedFeature({ type: 'waypoint', id: matchWp.id });
    }
  }, [focusLocation?.requestId, sleepSpots, waypoints]);

  // Update markers & layers
  useEffect(() => {
    if (!mapRef.current || !layerGroupRef.current) return;
    const layerGroup = layerGroupRef.current;
    layerGroup.clearLayers();

    // Waypoint route polyline
    const sortedWps = [...waypoints]
      .filter((wp) => hasValidCoords(wp.lat, wp.lng))
      .sort((a, b) => a.order - b.order);
    if (sortedWps.length > 1) {
      const routeCoords: [number, number][] = sortedWps.map((wp) => [wp.lat, wp.lng]);
      L.polyline(routeCoords, {
        color: '#eb6c32',
        weight: 3,
        opacity: 0.55,
        dashArray: '8, 12',
        lineCap: 'round',
      }).addTo(layerGroup);
    }

    // Past tracks
    pastTracks.forEach((track) => {
      if (track.points && track.points.length > 1) {
        const coords: [number, number][] = track.points.map((p) => [p.lat, p.lng]);
        L.polyline(coords, {
          color: '#64748b',
          weight: 4,
          opacity: 0.6,
          dashArray: '6, 8',
        })
          .on('click', () => onSelectRef.current({ type: 'track', id: track.id }))
          .addTo(layerGroup);
      }
    });

    // Active GPS track
    if (activeTrackPoints.length > 1) {
      const coords: [number, number][] = activeTrackPoints.map((p) => [p.lat, p.lng]);
      L.polyline(coords, {
        color: '#059669',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);
    }

    // User GPS marker
    if (userLocation) {
      const liveIcon = L.divIcon({
        className: 'custom-live-marker',
        html: `<div class="relative flex items-center justify-center">
          <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-5 w-5 bg-emerald-600 border-2 border-white shadow-md"></span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      L.marker([userLocation.lat, userLocation.lng], { icon: liveIcon })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectRef.current({ type: 'user' });
        })
        .addTo(layerGroup);
    }

    // Friends
    friends.forEach((friend) => {
      if (
        (selectedFriendFilter === 'all' || selectedFriendFilter === friend.id) &&
        friend.liveLat != null &&
        friend.liveLng != null
      ) {
        const isCurrentUser = friend.id === currentFriendId;
        const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(friend.color) ? friend.color : '#059669';

        const avatarIcon = L.divIcon({
          className: 'map-profile-marker',
          html: `<div class="profile-marker ${isCurrentUser ? 'profile-marker--current' : ''}" style="--profile-color: ${safeColor}">
            <div class="profile-marker__pulse"></div>
            <div class="profile-marker__avatar-wrap">
              <img src="${friend.avatar}" alt="" class="profile-marker__avatar" />
              <span class="profile-marker__presence"></span>
            </div>
          </div>`,
          iconSize: [54, 54],
          iconAnchor: [27, 27],
        });

        L.marker([friend.liveLat, friend.liveLng], { icon: avatarIcon })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            onSelectRef.current({ type: 'friend', id: friend.id });
          })
          .addTo(layerGroup);
      }
    });

    // Sleep spots
    sleepSpots.forEach((spot) => {
      if (!hasValidCoords(spot.lat, spot.lng)) return;
      const isFocused =
        focusLocation &&
        Math.abs(focusLocation.lat - spot.lat) < 0.00001 &&
        Math.abs(focusLocation.lng - spot.lng) < 0.00001;
      const borderColor = sleepSpotBorderColor(spot.confidence);
      const emoji = getSleepSpotEmoji(spot);

      const spotIcon = L.divIcon({
        className: 'sleep-spot-marker',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:#fff;border:2px solid ${borderColor};box-shadow:0 4px 14px rgba(23,53,43,.18);font-size:15px;line-height:1;${isFocused ? 'transform:scale(1.15);' : ''}">${emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      L.marker(toLeafletCoords(spot.lat, spot.lng), {
        icon: spotIcon,
        zIndexOffset: isFocused ? 900 : 0,
      })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectRef.current({ type: 'sleepSpot', id: spot.id });
        })
        .addTo(layerGroup);
    });

    // Waypoints
    waypoints.forEach((wp) => {
      if (!hasValidCoords(wp.lat, wp.lng)) return;
      const style = waypointMarkerStyle(wp.status);

      const wpIcon = L.divIcon({
        className: 'wp-marker',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:${style.bg};color:white;font-weight:900;font-size:11px;border:2px solid ${style.border};box-shadow:0 4px 12px rgba(23,53,43,.2);">${wp.order}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      L.marker([wp.lat, wp.lng], { icon: wpIcon })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectRef.current({ type: 'waypoint', id: wp.id });
        })
        .addTo(layerGroup);
    });

    // POIs
    pois.forEach((poi) => {
      if (selectedPoiTypeFilter !== 'all' && poi.type !== selectedPoiTypeFilter) return;
      if (selectedFriendFilter !== 'all' && poi.createdByFriendId !== selectedFriendFilter) return;

      const iconDetails = getPoiIconConfig(poi.type);
      const poiIcon = L.divIcon({
        className: 'poi-custom-marker',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:1rem;background:${iconDetails.bg};border:2px solid white;box-shadow:0 4px 12px rgba(23,53,43,.18);font-size:16px;">${iconDetails.emoji}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      L.marker([poi.lat, poi.lng], { icon: poiIcon })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectRef.current({ type: 'poi', id: poi.id });
        })
        .addTo(layerGroup);
    });

    // Photos
    photos.forEach((photo) => {
      if (!photo.lat || !photo.lng) return;
      if (selectedFriendFilter !== 'all' && photo.friendId !== selectedFriendFilter) return;

      const photoIcon = L.divIcon({
        className: 'photo-marker',
        html: `<div style="width:32px;height:32px;border-radius:8px;border:2px solid white;box-shadow:0 4px 12px rgba(23,53,43,.18);overflow:hidden;background:#17352b;"><img src="${photo.url}" style="width:100%;height:100%;object-fit:cover;" /></div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      L.marker([photo.lat, photo.lng], { icon: photoIcon })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectRef.current({ type: 'photo', id: photo.id });
        })
        .addTo(layerGroup);
    });

    // Journal notes with coords
    journal.forEach((note) => {
      if (!note.lat || !note.lng) return;
      if (selectedFriendFilter !== 'all' && note.friendId !== selectedFriendFilter) return;

      const noteIcon = L.divIcon({
        className: 'journal-marker',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:#7c3aed;border:2px solid white;box-shadow:0 4px 12px rgba(23,53,43,.18);font-size:14px;">📝</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      L.marker([note.lat, note.lng], { icon: noteIcon })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectRef.current({ type: 'journal', id: note.id });
        })
        .addTo(layerGroup);
    });

    // Focus highlight
    if (focusLocation && hasValidCoords(focusLocation.lat, focusLocation.lng)) {
      const focusEmoji = focusLocation.emoji || '📍';
      const focusIcon = L.divIcon({
        className: 'sleep-spot-focus-marker',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:12px;background:#fff;border:3px solid #eb6c32;box-shadow:0 6px 20px rgba(235,108,50,.35);font-size:18px;line-height:1;animation:map-focus-pulse 1.5s ease-in-out infinite;">${focusEmoji}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      L.marker([focusLocation.lat, focusLocation.lng], {
        icon: focusIcon,
        zIndexOffset: 1000,
      }).addTo(layerGroup);
    }
  }, [
    pois,
    friends,
    pastTracks,
    activeTrackPoints,
    userLocation,
    photos,
    waypoints,
    journal,
    sleepSpots,
    focusLocation,
    selectedPoiTypeFilter,
    selectedFriendFilter,
    currentFriendId,
  ]);

  const handleRecenter = useCallback(() => {
    if (!mapRef.current) return;
    if (userLocation) {
      mapRef.current.flyTo([userLocation.lat, userLocation.lng], 14, { duration: 1.2 });
    } else {
      const firstWaypoint = waypoints.find((wp) => hasValidCoords(wp.lat, wp.lng));
      if (firstWaypoint) {
        mapRef.current.flyTo(toLeafletCoords(firstWaypoint.lat, firstWaypoint.lng), 12);
      }
    }
  }, [userLocation, waypoints]);

  const getDefaultCoords = () => {
    if (userLocation) return { lat: userLocation.lat, lng: userLocation.lng };
    const center = mapRef.current?.getCenter();
    if (center) return { lat: center.lat, lng: center.lng };
    return { lat: FRANCE_MAP_CENTER.lat, lng: FRANCE_MAP_CENTER.lng };
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
    setNewPoiAmenities((prev) =>
      prev.includes(item) ? prev.filter((a) => a !== item) : [...prev, item]
    );
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
  const layerCount =
    pois.length +
    waypoints.filter((w) => hasValidCoords(w.lat, w.lng)).length +
    sleepSpots.length +
    photos.filter((p) => p.lat && p.lng).length +
    journal.filter((n) => n.lat && n.lng).length;

  return (
    <div className="map-view">
      <div ref={mapContainerRef} className="map-view__canvas" />

      {/* Compact floating toolbar */}
      <div className={`map-toolbar ${toolbarExpanded ? 'map-toolbar--expanded' : ''}`}>
        <button
          type="button"
          onClick={() => setToolbarExpanded((v) => !v)}
          className="map-toolbar__toggle"
          aria-expanded={toolbarExpanded}
        >
          <Filter className="h-3.5 w-3.5 text-[#eb6c32]" />
          <span>{layerCount} repères</span>
          {toolbarExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {toolbarExpanded && (
          <div className="map-toolbar__body">
            <div className="map-toolbar__row">
              <Layers className="h-3.5 w-3.5 text-[#eb6c32] shrink-0" />
              {(['outdoor', 'topo', 'satellite'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setActiveTile(mode)}
                  className={`map-toolbar__chip ${activeTile === mode ? 'map-toolbar__chip--active' : ''}`}
                >
                  {mode === 'outdoor' ? 'Plan' : mode === 'topo' ? 'Topo' : 'Satellite'}
                </button>
              ))}
            </div>

            <div className="map-toolbar__row">
              <select
                value={selectedPoiTypeFilter}
                onChange={(e) => setSelectedPoiTypeFilter(e.target.value)}
                className="map-toolbar__select"
              >
                <option value="all">Tous les spots</option>
                <option value="van_spot">🚐 Spots Van</option>
                <option value="water">🚰 Eau</option>
                <option value="viewpoint">📸 Panoramas</option>
                <option value="camping">⛺ Campings</option>
                <option value="fuel">⛽ Carburant</option>
              </select>
            </div>

            {friends.length > 0 && (
              <div className="map-crew-bar map-crew-bar--compact">
                <button
                  type="button"
                  onClick={() => setSelectedFriendFilter('all')}
                  className={`map-crew-filter ${selectedFriendFilter === 'all' ? 'map-crew-filter--active' : ''}`}
                >
                  <span className="map-crew-filter__all">{friends.length}</span>
                  <span className="map-crew-filter__meta">
                    <b>Tous</b>
                    <small>
                      <i className={liveCrewCount > 0 ? 'is-live' : 'is-off'} />
                      {liveCrewCount > 0 ? `${liveCrewCount} en ligne` : 'Hors ligne'}
                    </small>
                  </span>
                </button>
                {friends.map((friend) => {
                  const isSelected = selectedFriendFilter === friend.id;
                  const isLive = friend.liveLat != null && friend.liveLng != null;
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => setSelectedFriendFilter(isSelected ? 'all' : friend.id)}
                      className={`map-crew-filter ${isSelected ? 'map-crew-filter--active' : ''}`}
                    >
                      <span
                        className={`map-crew-filter__avatar ${isLive ? 'is-live' : 'is-off'}`}
                        style={{ borderColor: friend.color }}
                      >
                        <img src={friend.avatar} alt="" />
                        {isLive && <i />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* GPS HUD when nothing selected */}
      {!selectedFeature && userLocation && (
        <button
          type="button"
          onClick={() => setSelectedFeature({ type: 'user' })}
          className="map-gps-hud"
        >
          <span className="map-gps-hud__dot" />
          <span className="map-gps-hud__label">GPS actif</span>
          {userLocation.altitude != null && (
            <span className="map-gps-hud__stat"><Mountain className="h-3 w-3" /> {userLocation.altitude}m</span>
          )}
          {userLocation.speed != null && (
            <span className="map-gps-hud__stat"><Gauge className="h-3 w-3" /> {Math.round(userLocation.speed)} km/h</span>
          )}
        </button>
      )}

      {/* FABs */}
      <div className={`map-fabs ${selectedFeature ? 'map-fabs--raised' : ''}`}>
        <button type="button" onClick={openAddPoiForm} className="map-fab map-fab--primary" aria-label="Ajouter un point">
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" onClick={handleRecenter} className="map-fab map-fab--accent" aria-label="Centrer sur ma position">
          <Locate className="h-5 w-5" />
        </button>
      </div>

      {/* Pick location banner */}
      {isPickingLocation && (
        <div className="map-pick-banner">
          <Crosshair className="h-4 w-4 text-emerald-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold truncate">Touche la carte pour placer le point</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsPickingLocation(false);
              setShowAddModal(true);
            }}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-white/10"
          >
            Retour
          </button>
        </div>
      )}

      {/* Dynamic info panel */}
      {selectedFeature && (
        <MapInfoPanel
          selection={selectedFeature}
          onClose={() => setSelectedFeature(null)}
          pois={pois}
          waypoints={waypoints}
          sleepSpots={sleepSpots}
          friends={friends}
          photos={photos}
          journal={journal}
          tracks={pastTracks}
          userLocation={userLocation}
          currentFriendId={currentFriendId}
        />
      )}

      {/* Add POI modal */}
      {showAddModal && clickCoords && (
        <SimpleFormModal
          isOpen={showAddModal}
          onClose={closeAddPoiForm}
          title="Ajouter un point"
          subtitle="Nom · type · emplacement"
          icon={<MapPin className="h-4 w-4" />}
          titleId="add-poi-title"
          onSubmit={handleCreatePoiSubmit}
          footer={
            <FormModalFooter
              onCancel={closeAddPoiForm}
              submitLabel="Enregistrer"
              canSubmit={Boolean(newPoiTitle.trim() && clickCoords)}
            />
          }
        >
          <CompactFormRoot>
            <CompactFormHero>
              <CompactFormField label="Nom *" tone="hero">
                <CompactFormTextInput
                  tone="hero"
                  required
                  placeholder="Bivouac, fontaine, belvédère…"
                  value={newPoiTitle}
                  onChange={(e) => setNewPoiTitle(e.target.value)}
                  className="font-extrabold"
                />
              </CompactFormField>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-white/45">Type</p>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {poiTypes.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => setNewPoiType(t.id)}
                      className={`rounded-lg px-1 py-1.5 text-[10px] font-bold transition-colors ${
                        newPoiType === t.id
                          ? 'bg-white text-[#17352b]'
                          : 'bg-white/10 text-white/80'
                      }`}
                    >
                      <span className="block text-sm leading-none">{t.emoji}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </CompactFormHero>

            <CompactFormSection>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[#68756d]">
                    Emplacement
                  </p>
                  <span className="truncate font-mono text-[9px] text-[#68756d]">
                    {clickCoords.lat.toFixed(4)}, {clickCoords.lng.toFixed(4)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={useMyLocation}
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-white px-1 py-1.5 text-[9px] font-bold text-[#17352b] ring-1 ring-[#17352b]/8"
                  >
                    <Navigation2 className="h-3 w-3 text-[#eb6c32]" />
                    Ma pos.
                  </button>
                  <button
                    type="button"
                    onClick={useMapCenter}
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-white px-1 py-1.5 text-[9px] font-bold text-[#17352b] ring-1 ring-[#17352b]/8"
                  >
                    <Crosshair className="h-3 w-3 text-[#eb6c32]" />
                    Centre
                  </button>
                  <button
                    type="button"
                    onClick={startPickOnMap}
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-[#17352b] px-1 py-1.5 text-[9px] font-bold text-white"
                  >
                    <MapPin className="h-3 w-3 text-emerald-300" />
                    Carte
                  </button>
                </div>
              </div>

              <CompactFormField label="Note">
                <CompactFormTextInput
                  placeholder="Ombre, calme, 4G…"
                  value={newPoiDesc}
                  onChange={(e) => setNewPoiDesc(e.target.value)}
                />
              </CompactFormField>

              <div>
                <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#68756d]">
                  Commodités
                </p>
                <div className="flex flex-wrap gap-1">
                  {[
                    { id: 'eau', label: '🚰 Eau' },
                    { id: 'ombre', label: '🌲 Ombre' },
                    { id: 'gratuit', label: '🆓 Gratuit' },
                    { id: 'wc', label: '🚽 WC' },
                    { id: 'douche', label: '🚿 Douche' },
                    { id: 'vue_panoramique', label: '🏔️ Vue' },
                  ].map((item) => (
                    <CompactFormChip
                      key={item.id}
                      active={newPoiAmenities.includes(item.id)}
                      onClick={() => toggleAmenity(item.id)}
                    >
                      {item.label}
                    </CompactFormChip>
                  ))}
                </div>
              </div>
            </CompactFormSection>

            {formError && (
              <p className="rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800">
                {formError}
              </p>
            )}
          </CompactFormRoot>
        </SimpleFormModal>
      )}
    </div>
  );
};
