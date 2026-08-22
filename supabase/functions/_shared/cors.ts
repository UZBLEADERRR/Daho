/** Ilova, veb va kengaytma turli manzillardan keladi — hammasiga ruxsat. */
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, http-referer, x-title',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function fail(message: string, status = 400, code = ''): Response {
  return json({ error: { message, code, type: 'daho_error' } }, status);
}
