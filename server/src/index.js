import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { loadStats, mountAi, providerStatus } from './ai.js';
import { mountOauth, oauthStatus } from './oauth.js';
import { env, missing } from './env.js';
import { allowedHosts, proxyRequest } from './proxy.js';
import { runCommand, shellLoad } from './shell.js';
import { adminClient, userFromToken } from './supabase.js';
import { startPolling, tick, workerStats } from './worker.js';

const app = express();
// Rasm biriktirilgan soʻrov katta boʻladi (base64 ~1.37×).
app.use(express.json({ limit: '25mb' }));

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

/** Server haqida qisqa maʼlumot. Ildizni veb ilova egallagani uchun `/api` da. */
function serviceInfo(_req, res) {
  res.json({
    service: 'Daho server',
    holat: missing().length ? 'sozlanmagan' : 'tayyor',
    yetishmayapti: missing(),
    terminal: env.shellEnabled,
    provayderlar: providerStatus(),
    veb: hasWeb ? 'ildizda' : 'yigʻilmagan',
  });
}

app.get('/api', serviceInfo);

/*
 * AI shlyuzi — /api/ai/... . Boshqa yoʻllardan oldin ulanadi, chunki
 * pastdagi `app.get('*')` SPA javobini beradi.
 */
mountAi(app);
mountOauth(app);

app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: missing().length === 0,
    worker: workerStats(),
    terminal: shellLoad(),
    // Yuk holati — 1000 foydalanuvchida nima boʻlayotganini koʻrish uchun.
    yuk: loadStats(),
    xotira_mb: Math.round(mem.rss / 1048576),
    ish_vaqti_s: Math.round(process.uptime()),
    yetishmayapti: missing(),
  });
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

/* ------------------------------------------------------------------ */
/*  Google OAuth qaytish manzili — telefon uchun                       */
/* ------------------------------------------------------------------ */

/*
 * Telefondagi ilova `https://localhost` ichida ishlaydi va Google bunday
 * manzilga qaytara olmaydi. Shuning uchun Google shu yerga qaytadi, biz
 * esa kodni deep link bilan ilovaga uzatamiz.
 *
 * Kod bu yerda SAQLANMAYDI va hech qayerga yozilmaydi — PKCE tufayli u
 * verifier’siz foydasiz, verifier esa faqat telefonda turadi.
 */
const APP_LINK = process.env.APP_DEEP_LINK || 'uz.daho.app://oauth';

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

app.get('/oauth/callback', (req, res) => {
  const code = String(req.query.code || '');
  const error = String(req.query.error || '');
  if (!code && !error) return res.status(400).send('Kod yoʻq.');

  /*
   * `state` ichida qaysi xizmat va qayerga qaytish yozilgan. Shu tufayli
   * har bir xizmatda ROʻYXATDAN OʻTKAZILADIGAN MANZIL BITTA — shu sahifa.
   * Vebda oʻz manzilimizga, telefonda deep link bilan ilovaga qaytamiz.
   */
  let provider = '';
  let back = '';
  try {
    const raw = JSON.parse(
      Buffer.from(String(req.query.state || ''), 'base64url').toString('utf8'),
    );
    provider = String(raw.p || '');
    back = String(raw.back || '');
  } catch {
    /* state boʻlmasa eski yoʻl bilan ishlaymiz */
  }

  const here = `${req.protocol}://${req.get('host')}`;
  const query = new URLSearchParams(code ? { code } : { error });
  if (provider) query.set('provider', provider);

  // Faqat oʻz manzilimizga qaytaramiz — ochiq yoʻnaltirish boʻlmasin.
  const safeBack = back.startsWith(`${here}/`) || back === here ? back : '';
  const link = safeBack
    ? `${safeBack}${safeBack.includes('?') ? '&' : '?'}${query}`
    : `${APP_LINK}?${query}`;
  const safeLink = escapeHtml(link);

  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daho — Google ulanishi</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;
      background:#09090b;color:#fafafa;
      font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 .card{max-width:22rem;padding:2rem 1.5rem;text-align:center}
 h1{font-size:1.25rem;margin:0 0 .5rem}
 p{color:#a1a1aa;margin:0 0 1.5rem}
 a.btn{display:block;padding:.85rem 1rem;border-radius:.75rem;
       background:#6366f1;color:#fff;text-decoration:none;font-weight:600}
 code{display:block;margin-top:1.5rem;padding:.75rem;border-radius:.5rem;
      background:#18181b;color:#71717a;font-size:.75rem;word-break:break-all}
</style></head><body><div class="card">
 <h1>${error ? 'Ulanish bekor qilindi' : 'Daho’ga qaytmoqda…'}</h1>
 <p>${error ? escapeHtml(error) : 'Bir soniya kutib turing.'}</p>
 <a class="btn" href="${safeLink}">Daho’ni ochish</a>
 ${error ? '' : '<code>Ilova ochilmasa yuqoridagi tugmani bosing.</code>'}
</div>
<script>setTimeout(function(){location.replace(${JSON.stringify(link)})},400)</script>
</body></html>`);
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

/* ------------------------------------------------------------------ */
/*  Brauzer kengaytmasi                                                */
/* ------------------------------------------------------------------ */

/*
 * Arxivning oʻzi `public/daho-extension.zip` da turadi va static orqali
 * beriladi. Bu sahifa — oʻrnatish yoʻriqnomasi, chunki Chrome arxivni
 * oʻzi oʻrnata olmaydi: avval ochib, keyin «Load unpacked» qilinadi.
 */
/**
 * Kengaytma uchun ochiq sozlama.
 *
 * Kengaytma qaysi Supabase loyihasiga kirishini bilishi kerak. Bu ikki
 * qiymat ochiq boʻlishi uchun moʻljallangan — himoya RLS siyosatlarida.
 * Shuning uchun kengaytmaga qoʻlda hech narsa yozilmaydi: u serveridan
 * soʻraydi va shu bilan hisobga kira oladi.
 */
app.get('/api/public-config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    supabaseUrl: env.supabaseUrl,
    supabaseAnonKey: env.anonKey,
    /*
     * Shlyuz endi shu serverda: bitta manzil ortida ham Google, ham
     * OpenRouter turadi. Edge funksiyasi zaxira sifatida qoladi.
     */
    gateway: `${base}/api/ai`,
    server: base,
    providers: providerStatus(),
    /*
     * Ulanish uchun mijoz ID lari. Bular OCHIQ boʻlishi moʻljallangan —
     * himoya sirda emas, qaytish manzilida. Sir serverda qoladi.
     */
    oauth: oauthStatus(base),
  });
});

app.get('/extension', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daho kengaytmasi</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;padding:2rem 1.25rem;background:#09090b;color:#fafafa;
      font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 main{max-width:34rem;margin:0 auto}
 h1{font-size:1.5rem;margin:0 0 .25rem}
 p.sub{color:#a1a1aa;margin:0 0 2rem}
 a.btn{display:block;padding:.9rem 1rem;border-radius:.75rem;background:#6366f1;
       color:#fff;text-decoration:none;font-weight:600;text-align:center;margin-bottom:2rem}
 ol{padding-left:1.25rem;margin:0 0 2rem}
 li{margin-bottom:.85rem}
 code{background:#18181b;padding:.15rem .4rem;border-radius:.3rem;font-size:.9em}
 .note{border-left:3px solid #f59e0b;padding:.75rem 1rem;background:#18181b;
       border-radius:.4rem;color:#d4d4d8;font-size:.9rem}
</style></head><body><main>
<h1>Daho kengaytmasi</h1>
<p class="sub">Ochiq sahifani oʻqiydi va tushuntiradi — YouTube videosining
subtitrigacha. Daho hisobingiz bilan ishlaydi.</p>

<a class="btn" href="${env.storeUrl || '#'}"${env.storeUrl ? '' : ' style="opacity:.5;pointer-events:none"'}>
  ${env.storeUrl ? 'Chrome Web Store dan oʻrnatish' : 'Doʻkonga joylash jarayonda'}
</a>

<h2 style="font-size:1.05rem;margin:0 0 .5rem">Hozircha qoʻlda oʻrnatish</h2>
<p style="color:#a1a1aa;margin:0 0 1rem;font-size:.92rem">
Chrome 2018 yildan beri Doʻkondan tashqari kengaytmani bir bosishda
oʻrnatishga ruxsat bermaydi. Doʻkonga joylanmaguncha quyidagi yoʻl ishlaydi —
bu vaqtinchalik, lekin xavfsiz.</p>

<a class="btn" href="/daho-extension.zip" download style="background:#27272a">Arxivni yuklab olish</a>

<ol>
 <li>Arxivni yuklab oling va <b>papkaga chiqaring</b> (unzip).</li>
 <li>Chrome yoki Edge’da <code>chrome://extensions</code> ni oching.</li>
 <li>Oʻng yuqorida <b>Developer mode</b> ni yoqing.</li>
 <li><b>Load unpacked</b> → chiqargan papkani tanlang.</li>
 <li>Kengaytma belgisini bosing va <b>Daho hisobingizga kiring</b> —
     obunangizdagi modellar shu yerda ham ishlaydi. Kalit kiritish shart emas.</li>
</ol>

<p class="note"><b>Diqqat:</b> telefondagi Chrome kengaytmalarni
qoʻllab-quvvatlamaydi. Buni kompyuterda qiling. Android’da xohlasangiz
Kiwi Browser ishlaydi.</p>
</main></body></html>`);
});

/* ------------------------------------------------------------------ */
/*  Veb ilova                                                          */
/* ------------------------------------------------------------------ */

/*
 * Dockerfile veb ilovani yigʻib `public/` ga qoʻyadi. Shunda Railway
 * manzili — Daho’ning oʻzi: telefonsiz, brauzerdan ham kirsa boʻladi.
 * Papka boʻlmasa (mahalliy ishga tushirishda) server oddiy JSON qaytaradi.
 *
 * Diqqat: bu barcha API yoʻllaridan KEYIN turadi, aks holda `*` ular
 * ustidan oʻtib ketardi.
 */
const WEB_DIR = path.join(process.cwd(), 'public');
const hasWeb = existsSync(path.join(WEB_DIR, 'index.html'));

/** API yoʻllari — bularga SPA javobi berilmasin, 404 chiqsin. */
const API_PATHS = /^\/(api|health|tick|jobs|proxy|run|oauth|extension)(\/|$)/;

if (hasWeb) {
  app.use(express.static(WEB_DIR, { maxAge: '1h' }));

  // Ilova ichidagi yoʻllar (masalan /agent) ham index.html ni olsin.
  app.get('*', (req, res, next) => {
    if (API_PATHS.test(req.path)) return next();
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
} else {
  app.get('/', serviceInfo);
}

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
