# Daho Cloud — oʻrnatish va boshqarish

Daho ikki rejimda ishlaydi:

| | **Mahalliy rejim** | **Daho Cloud** |
|---|---|---|
| API kalit | foydalanuvchining oʻzi kiritadi | platforma kaliti (server tomonda) |
| Maʼlumot | faqat qurilmada | qurilmada + bulutda zaxira/sinxron |
| Model tanlovi | Google ochgan hamma model | admin reja ichida ochgan modellar |
| Token hisobi | Google tomonida | biz hisoblaymiz, narxni admin belgilaydi |
| Fon vazifalari | yoʻq | bor (obunada) |

Bulut **ixtiyoriy**. `.env` da `VITE_SUPABASE_URL` boʻlmasa ilova
oʻzgarishsiz, faqat mahalliy rejimda ishlayveradi.

---

## 1. Supabase loyihasini tayyorlash

1. [supabase.com](https://supabase.com) da yangi loyiha oching (region: foydalanuvchilaringizga yaqin).
2. CLI ni ulang:

```bash
npm i -g supabase
supabase login
supabase link --project-ref <PROJECT_REF>
```

3. Sxemani qoʻying:

```bash
supabase db push
```

CLI ishlatmasangiz, `supabase/migrations/` ichidagi ikkala `.sql` faylni
tartib bilan **SQL Editor** ga qoʻyib bajaring.

Nima yaratiladi:

| Jadval | Vazifasi |
|---|---|
| `profiles` | foydalanuvchi, roli (`user` / `admin`), blok holati |
| `plans` | rejalar: narx, oylik kredit, kunlik chegara, fon limitlari |
| `plan_models` | **reja ichidagi model ruxsati va token narxi** |
| `subscriptions` | kim qaysi rejada, qachongacha |
| `credit_balances` | qolgan kredit, davr boshi/oxiri |
| `usage_events` | har bir chaqiruv: model, token, kredit, manba |
| `purchase_requests` | obuna soʻrovlari (admin tasdiqlaydi) |
| `sync_items` | qurilmalararo sinxronizatsiya |
| `jobs` | fon vazifalari navbati |
| `app_settings` | global sozlamalar (gateway yoqilganmi, zaxira narx, admin pochtalari) |

Barcha jadvalda RLS yoqilgan: foydalanuvchi faqat oʻz satrini koʻradi,
admin hammasini koʻradi, kredit balansini esa **hech kim** qoʻlda
oʻzgartira olmaydi — faqat server funksiyalari.

## 2. Sirlar (secrets)

```bash
supabase secrets set GEMINI_API_KEY=AIza...          # platforma kaliti
supabase secrets set WORKER_SECRET=$(openssl rand -hex 24)
```

`GEMINI_API_KEY` — obunachilar soʻrovi shu kalit bilan Google'ga ketadi.
Bu kalit hech qachon brauzerga chiqmaydi.

## 3. Edge funksiyalarni chiqarish

```bash
supabase functions deploy ai-gateway --no-verify-jwt
supabase functions deploy jobs-worker --no-verify-jwt
```

- **ai-gateway** — Gemini proksisi. JWT ni oʻzi tekshiradi, `can_use_model`
  bilan ruxsatni soʻraydi, javob oqimini uzatib turib token hisobini
  yigʻadi va `charge_usage` orqali kreditdan yechadi.
- **jobs-worker** — navbatdagi fon vazifalarini bajaradi.
  `x-worker-secret` sarlavhasi bilan himoyalangan.

## 4. Fon vazifalarini ishga tushirish (pg_cron)

SQL Editor da bir marta:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daho-jobs',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/jobs-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', '<WORKER_SECRET>'
    ),
    body := jsonb_build_object('limit', 5)
  );
  $$
);
```

Sirni SQL ichida saqlamaslik uchun Supabase Vault dan foydalaning
(`vault.create_secret('worker_secret', '...')` va `vault.decrypted_secrets`).

Toʻxtatish: `select cron.unschedule('daho-jobs');`

## 5. Frontend sozlamasi

`.env` (namuna — `.env.example`):

```
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

`service_role` kaliti hech qachon frontendga yozilmaydi.

Nashr uchun GitHub Pages ish oqimi tayyor
(`.github/workflows/web.yml`) — repo sozlamalarida `VITE_SUPABASE_URL` va
`VITE_SUPABASE_ANON_KEY` secret'larini qoʻshing va Pages ni "GitHub Actions"
rejimiga oʻtkazing. Netlify/Vercel uchun: `npm run build`, natija `dist/`.

## 6. Birinchi admin

- **Birinchi** roʻyxatdan oʻtgan foydalanuvchi avtomatik admin boʻladi.
- Keyinchalik: Admin panel → Sozlama → «Admin pochtalari» roʻyxatiga
  pochta qoʻshsangiz, oʻsha pochta bilan kelgan yangi foydalanuvchi admin
  boʻladi.
- Yoki toʻgʻridan-toʻgʻri SQL bilan:

```sql
update public.profiles set role = 'admin' where email = 'siz@pochta.com';
```

## 7. Kredit va narx tizimi

Kredit — ichki hisob birligi. Har bir reja va model uchun admin uchta
raqam belgilaydi:

| Maydon | Maʼnosi |
|---|---|
| `input_credits_per_mtok` | 1 million kirish tokeni necha kredit |
| `output_credits_per_mtok` | 1 million chiqish tokeni necha kredit |
| `call_credits` | har bir chaqiruv uchun qoʻshimcha (rasm, TTS uchun qulay) |

Hisob:

```
kredit = kirish/1e6 * kirish_narxi + chiqish/1e6 * chiqish_narxi + chaqiruv_narxi
```

«Fikrlash» (thinking) tokenlari chiqish tokeniga qoʻshiladi — Google
ularni ham hisoblaydi.

Reja `credit_grant` — har 30 kunda beriladigan kredit. Davr tugaganda
balans avtomatik yangilanadi (`ensure_period`). `daily_credit_cap`
kunlik chegara qoʻyadi (bepul rejani himoyalash uchun qulay).
Admin qoʻlda qoʻshgan kredit (`extra`) davr almashganda yoʻqolmaydi.

**Narxni qanday belgilash kerak.** Google narxi 1M token uchun dollarda
berilgan. Ustama bilan hisoblang, masalan:

```
kredit_narxi = google_narxi_1M_uchun_som * ustama(1.3–2.0)
```

Soʻng rejaning oylik kredit miqdorini shunday tanlang: reja narxi
oʻrtacha sarfni qoplasin. Admin panel → Umumiy sahifasida oylik token,
kredit va daromad koʻrsatkichlari turadi.

## 8. Xavfsizlik

- `charge_usage`, `claim_jobs`, `allowed_models` funksiyalari `anon` va
  `authenticated` rollardan olib qoʻyilgan — faqat `service_role`.
- Foydalanuvchi oʻz rolini yoki blok holatini oʻzgartira olmaydi
  (`profiles_guard` trigger).
- `apiKey` va `githubToken` sinxronizatsiyaga **hech qachon** qoʻshilmaydi
  (`sync.ts` → `DEVICE_ONLY`).
- Hajmi 1.2 MB dan katta element (uzun video, katta rasm) bulutga
  yuborilmaydi — qurilmada qoladi; Hisob boʻlimida nechtasi qolgani
  koʻrinadi.
- Gateway soʻrovni faqat `generativelanguage.googleapis.com` ga uzatadi.

## 9. Tekshirish

```bash
# gateway (foydalanuvchi tokeni bilan)
curl -X POST "https://<REF>.functions.supabase.co/ai-gateway/v1beta/models/gemini-flash-latest:generateContent" \
  -H "Authorization: Bearer <USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Salom"}]}]}'

# ishchi
curl -X POST "https://<REF>.functions.supabase.co/jobs-worker" \
  -H "x-worker-secret: <WORKER_SECRET>" -d '{"limit":3}'
```

Soʻng `usage_events` jadvalida yangi satr va `credit_balances.balance`
kamayganini koʻrasiz.
