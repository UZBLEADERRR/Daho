import express from 'express';
import { env, missing } from './env.js';
import { allowedHosts, proxyRequest } from './proxy.js';
import { runCommand } from './shell.js';
import { adminClient, userFromToken } from './supabase.js';
import { startPolling, tick, workerStats } from './worker.js';

const app = express();
app.use(express.json({ limit: '8mb' }));

// Ilova boshqa manzildan (GitHub Pages, Capacitor) soʻrov yuboradi.
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-worker-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

/** Foydalanuvchi tokeni yoki umumiy maxfiy soʻz. */
async function authorize(req) {
  const secret = req.get('x-worker-secret') || '';
  if (env.workerSecret && secret === env.workerSecret) return { kind: 'server', id: 'server' };

  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await userFromToken(token);
  return user ? { kind: 'user', id: user.id, email: user.email } : null;
}

app.get('/', (_req, res) => {
  res.json({
    service: 'Daho server',
    holat: missing().length ? 'sozlanmagan' : 'tayyor',
    yetishmayapti: missing(),
    terminal: env.shellEnabled,
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: missing().length === 0, worker: workerStats(), yetishmayapti: missing() });
});

/** Navbatni qoʻlda turtish — Railway cron yoki tashqi chaqiruv uchun. */
app.post('/tick', async (req, res) => {
  const who = await authorize(req);
  if (!who) return res.status(401).json({ error: 'Ruxsat yoʻq' });
  res.json(await tick(Math.max(1, Math.min(10, Number(req.body?.limit) || env.batchSize))));
});

/** Vazifa qoʻshish. Reja tekshiruvi Supabase tomonida (enqueue_job). */
app.post('/jobs', async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Avval tizimga kiring' });

  const { kind, title, payload, model } = req.body ?? {};
  if (!kind) return res.status(400).json({ error: 'kind kerak' });

  // Foydalanuvchi nomidan chaqiramiz — limitlar va obuna tekshiriladi.
  const { data, error } = await adminClient().rpc('enqueue_job', {
    p_kind: kind,
    p_title: String(title ?? '').slice(0, 200),
    p_payload: payload ?? {},
    p_model: model ?? null,
  }, { head: false });

  if (error) return res.status(400).json({ error: error.message });

  // Kutib qolmasin — darhol bajarishga urinamiz.
  void tick(1);
  res.json({ job: data });
});

app.get('/jobs/:id', async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Avval tizimga kiring' });

  const { data, error } = await adminClient()
    .from('jobs')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ job: data });
});

/**
 * Tashqi API ga proxy — brauzer CORS tufayli bevosita chaqira olmaydigan
 * xizmatlar uchun (Supabase Management, Google API va h.k.).
 */
app.post('/proxy', async (req, res) => {
  const who = await authorize(req);
  if (!who) return res.status(401).json({ error: 'Ruxsat yoʻq' });
  res.json(await proxyRequest(req.body ?? {}));
});

app.get('/proxy/hosts', async (req, res) => {
  const who = await authorize(req);
  if (!who) return res.status(401).json({ error: 'Ruxsat yoʻq' });
  res.json({ xostlar: allowedHosts() });
});

/** HAQIQIY terminal — Daho Code shu orqali npm/node/git ishlatadi. */
app.post('/run', async (req, res) => {
  const who = await authorize(req);
  if (!who) return res.status(401).json({ error: 'Ruxsat yoʻq' });

  const { command, cwd, timeout } = req.body ?? {};
  const result = await runCommand(who.id, command, { cwd, timeoutMs: timeout });
  res.json(result);
});

const gaps = missing();
if (gaps.length) {
  console.warn(`[daho] sozlanmagan: ${gaps.join(', ')} — worker ishga tushmaydi`);
} else {
  startPolling();
}

app.listen(env.port, () => {
  console.log(`[daho] server ${env.port} portda`);
  console.log(`[daho] terminal: ${env.shellEnabled ? 'yoqilgan' : 'oʻchiq'}`);
});
