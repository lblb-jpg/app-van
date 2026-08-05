/** Centre approximatif de la France — fallback carte sans GPS ni étape. */
export const FRANCE_MAP_CENTER = { lat: 46.5, lng: 2.5 } as const;

export const FRANCE_MAP_ZOOM = 6;
export const LOCAL_MAP_ZOOM = 11;

export const MAP_TILE_KEY = 'van_map_tile_v1';
export type MapTileMode = 'outdoor' | 'topo' | 'satellite';

/** OSM par défaut : tuiles légères, affichage plus rapide sur mobile. */
export function readStoredMapTile(): MapTileMode {
  try {
    const stored = localStorage.getItem(MAP_TILE_KEY);
    if (stored === 'outdoor' || stored === 'topo' || stored === 'satellite') return stored;
  } catch {
    // ignore
  }
  return 'outdoor';
}

export function saveStoredMapTile(mode: MapTileMode) {
  try {
    localStorage.setItem(MAP_TILE_KEY, mode);
  } catch {
    // ignore
  }
}
