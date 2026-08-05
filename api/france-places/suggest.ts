import type { IncomingMessage, ServerResponse } from 'node:http';
import { suggestFrancePlaces } from '../../src/server/sleepSearchApi';

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

  try {
    const payload = await suggestFrancePlaces(query);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('France places suggestion error:', error);
    return res.status(502).json({ error: 'La liste des communes est momentanément indisponible.' });
  }
}
