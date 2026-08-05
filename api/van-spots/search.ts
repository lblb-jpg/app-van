import type { IncomingMessage, ServerResponse } from 'node:http';
import { searchVanSleepSpots } from '../../src/server/sleepSearchApi';

type ApiRequest = IncomingMessage & { query?: Record<string, string | string[] | undefined> };
type ApiResponse = ServerResponse & {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const query = String(req.query.q || '').trim();
  const radiusKm = Number(req.query.radius) || 20;
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const label = typeof req.query.label === 'string' ? req.query.label : undefined;

  try {
    const payload = await searchVanSleepSpots({
      query,
      radiusKm,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      label,
    });
    return res.status(200).json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Recherche de spots indisponible.';
    const status = message.includes('introuvable') ? 404 : 502;
    return res.status(status).json({ error: message });
  }
}
