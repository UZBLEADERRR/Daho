/*
 * OAuth — kalit oʻrniga «Ulash» tugmasi.
 *
 * Foydalanuvchidan token soʻrash notoʻgʻri: oddiy odam GitHub’da
 * Personal Access Token yasashni bilmaydi va bilishi ham shart emas.
 * Buning oʻrniga u xizmat sahifasida «Ruxsat beraman» deydi, biz esa
 * kodni tokenga almashtiramiz.
 *
 * Mijoz siri (client secret) FAQAT shu serverda turadi — brauzerga
 * chiqmaydi. Shuning uchun almashtirish ham shu yerda bajariladi.
 *
 * Qaytish manzili bitta: <server>/oauth/callback. Har bir xizmatda
 * roʻyxatdan oʻtkaziladigan yagona manzil shu.
 */

const PROVIDERS = {
  github: {
    label: 'GitHub',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'repo workflow read:user',
    pkce: false,
    env: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    // GitHub tokeni muddatsiz (klassik OAuth app) — yangilash kerak emas.
  },
  supabase: {
    label: 'Supabase',
    authorize: 'https://api.supabase.com/v1/oauth/authorize',
    token: 'https://api.supabase.com/v1/oauth/token',
    scope: 'all',
    pkce: true,
    basicAuth: true,
    env: ['SUPABASE_OAUTH_CLIENT_ID', 'SUPABASE_OAUTH_CLIENT_SECRET'],
  },
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    pkce: true,
    extra: { access_type: 'offline', prompt: 'consent' },
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
};

const idOf = (p) => process.env[PROVIDERS[p].env[0]] || '';
const secretOf = (p) => process.env[PROVIDERS[p].env[1]] || '';

/** Qaysi xizmat ulanishga tayyor. Sir hech qachon qaytarilmaydi. */
export function oauthStatus(base) {
  const out = {};
  for (const [name, p] of Object.entries(PROVIDERS)) {
    out[name] = {
      label: p.label,
      client_id: idOf(name),
      scope: p.scope,
      pkce: p.pkce,
      // Google PKCE bilan sirsiz ham ishlaydi.
      ready: Boolean(idOf(name)) && (Boolean(secretOf(name)) || (p.pkce && name === 'google')),
      redirect_uri: `${base}/oauth/callback`,
      env: p.env,
    };
  }
  return out;
}

/** Kodni tokenga almashtiradi. */
async function exchange(provider, body) {
  const p = PROVIDERS[provider];
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };

  const form = new URLSearchParams(body);
  if (p.basicAuth) {
    // Supabase mijozni Basic sarlavhada kutadi.
    headers.Authorization = `Basic ${Buffer.from(`${idOf(provider)}:${secretOf(provider)}`).toString('base64')}`;
  } else {
    form.set('client_id', idOf(provider));
    if (secretOf(provider)) form.set('client_secret', secretOf(provider));
  }

  const res = await fetch(p.token, { method: 'POST', headers, body: form.toString() });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // GitHub baʼzan `a=b&c=d` qaytaradi.
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `Almashtirib boʻlmadi (${res.status})`);
  }
  return data;
}

export function mountOauth(app) {
  const baseOf = (req) => `${req.protocol}://${req.get('host')}`;

  /** Qaysi xizmatga ulansa boʻladi — ilova shu roʻyxatni koʻrsatadi. */
  app.get('/api/oauth/providers', (req, res) => {
    res.set('Cache-Control', 'public, max-age=120');
    res.json({ providers: oauthStatus(baseOf(req)), callback: `${baseOf(req)}/oauth/callback` });
  });

  /**
   * Ulanish boshlanishi — ilova shu manzilga oʻtadi.
   *
   * Mijoz ID sini ilova bilishi shart emas: u ham shu yerda qoʻshiladi.
   */
  app.get('/api/oauth/start/:provider', (req, res) => {
    const name = String(req.params.provider);
    const p = PROVIDERS[name];
    if (!p) return res.status(404).json({ error: 'Bunday xizmat yoʻq' });
    if (!idOf(name)) {
      return res.status(503).json({
        error: `${p.label} ulanishi sozlanmagan (${p.env.join(', ')} kerak).`,
      });
    }

    const back = String(req.query.back || '');
    const params = new URLSearchParams({
      client_id: idOf(name),
      redirect_uri: `${baseOf(req)}/oauth/callback`,
      response_type: 'code',
      scope: String(req.query.scope || p.scope),
      state: Buffer.from(JSON.stringify({ p: name, back })).toString('base64url'),
      ...(p.extra ?? {}),
    });
    if (p.pkce && req.query.challenge) {
      params.set('code_challenge', String(req.query.challenge));
      params.set('code_challenge_method', 'S256');
    }
    res.redirect(`${p.authorize}?${params}`);
  });

  /** Kodni tokenga almashtirish — sir serverda qolgani uchun shu yerda. */
  app.post('/api/oauth/exchange', async (req, res) => {
    const { provider, code, verifier } = req.body ?? {};
    const p = PROVIDERS[provider];
    if (!p) return res.status(404).json({ error: 'Bunday xizmat yoʻq' });
    if (!code) return res.status(400).json({ error: 'Kod yoʻq' });

    try {
      const data = await exchange(provider, {
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: `${baseOf(req)}/oauth/callback`,
        ...(verifier ? { code_verifier: String(verifier) } : {}),
      });
      res.json({
        access_token: data.access_token ?? '',
        refresh_token: data.refresh_token ?? '',
        expires_in: Number(data.expires_in ?? 0),
        scope: data.scope ?? '',
      });
    } catch (err) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  /** Muddati tugagan tokenni yangilaydi. */
  app.post('/api/oauth/refresh', async (req, res) => {
    const { provider, refresh_token: token } = req.body ?? {};
    if (!PROVIDERS[provider]) return res.status(404).json({ error: 'Bunday xizmat yoʻq' });
    if (!token) return res.status(400).json({ error: 'refresh_token yoʻq' });
    try {
      const data = await exchange(provider, {
        grant_type: 'refresh_token',
        refresh_token: String(token),
      });
      res.json({
        access_token: data.access_token ?? '',
        refresh_token: data.refresh_token ?? String(token),
        expires_in: Number(data.expires_in ?? 0),
      });
    } catch (err) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });
}

export { PROVIDERS };
