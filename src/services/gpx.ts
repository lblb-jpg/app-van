import { GpsTrack, GpsPoint } from '../types';

export function exportTrackToGpx(track: GpsTrack): string {
  const trkpts = track.points
    .map(
      (p) => `      <trkpt lat="${p.lat}" lon="${p.lng}">
        ${p.altitude ? `<ele>${p.altitude}</ele>` : ''}
        <time>${new Date(p.timestamp).toISOString()}</time>
        ${p.speed ? `<extensions><speed>${(p.speed / 3.6).toFixed(2)}</speed></extensions>` : ''}
      </trkpt>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VanLife GPS Companion" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(track.title)}</name>
    <time>${new Date(track.startTime).toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(track.title)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function downloadGpxFile(track: GpsTrack) {
  const gpxXml = exportTrackToGpx(track);
  const blob = new Blob([gpxXml], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${track.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${track.date}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseGpxXml(gpxContent: string, titleHint = 'Trace GPX Importée'): { title: string; points: GpsPoint[]; distanceKm: number } {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxContent, 'text/xml');
  const nameEl = xmlDoc.querySelector('name');
  const trackTitle = nameEl?.textContent || titleHint;

  const trkptNodes = Array.from(xmlDoc.querySelectorAll('trkpt, wpt'));
  const points: GpsPoint[] = [];

  let totalDist = 0;

  trkptNodes.forEach((node, idx) => {
    const lat = parseFloat(node.getAttribute('lat') || '0');
    const lng = parseFloat(node.getAttribute('lon') || '0');
    const eleNode = node.querySelector('ele');
    const timeNode = node.querySelector('time');

    const altitude = eleNode ? parseFloat(eleNode.textContent || '0') : undefined;
    const timestamp = timeNode ? new Date(timeNode.textContent || '').getTime() : Date.now() + idx * 5000;

    if (idx > 0) {
      const prev = points[idx - 1];
      totalDist += calculateHaversineDistance(prev.lat, prev.lng, lat, lng);
    }

    points.push({
      lat,
      lng,
      altitude,
      timestamp
    });
  });

  return {
    title: trackTitle,
    points,
    distanceKm: Number(totalDist.toFixed(2))
  };
}

export function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
