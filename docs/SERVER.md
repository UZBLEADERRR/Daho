# Daho serverini ishga tushirish

Ilova endi foydalanuvchidan API kalit soʻramaydi. Barcha soʻrov sizning
serveringizdan oʻtadi: u yerda tarif, kvota va token hisobi tekshiriladi.
Quyidagi olti qadam bir marta bajariladi.

---

## 1. Supabase loyihasi

1. [supabase.com](https://supabase.com) da yangi loyiha oching (bepul tarif yetadi).
2. **Project Settings → API** dan ikkita qiymatni yozib oling:
   - `Project URL` — masalan `https://abcdefgh.supabase.co`
   - `anon public` kaliti

> `service_role` kalitini hech qayerga yozmang. U faqat serverning oʻzida
> qoladi va uni Supabase avtomatik beradi.

## 2. Jadvallarni yaratish

**SQL Editor** ni oching va `supabase/migrations/20260822000100_daho_saas.sql`
faylining butun matnini qoʻyib **Run** bosing.

Bu quyidagilarni yaratadi:

| Jadval | Nima uchun |
| --- | --- |
| `plans` | Tariflar: nomi, narxi, oylik token |
| `profiles` | Foydalanuvchi, uning tarifi va sarflangan tokeni |
| `daho_models` | Daho modellari va ular ortidagi haqiqiy model |
| `usage_events` | Har bir soʻrovning token hisobi |
| `subscription_requests` | Obuna soʻrovlari |
| `chats` | Qurilmalar orasidagi sinxron suhbatlar |
| `app_settings` | Aloqa maʼlumotlari va yuklab olish havolalari |

Migratsiya namunaviy 4 ta tarif va 6 ta Daho modelini ham qoʻshadi —
keyin admin panelda istagancha oʻzgartirasiz.

## 3. Oʻzingizni admin qilish

Migratsiya ichida `owner_emails` roʻyxati bor. Oʻsha pochta bilan
roʻyxatdan oʻtsangiz **avtomatik admin** boʻlasiz. Boshqa pochta kerak
boʻlsa, SQL Editor da:

```sql
update public.app_settings
   set value = '["sizning@pochtangiz.com"]'::jsonb
 where key = 'owner_emails';
```

Roʻyxatdan oʻtib boʻlgan boʻlsangiz:

```sql
update public.profiles set role = 'admin' where email = 'sizning@pochtangiz.com';
```

## 4. AI proxy ni joylashtirish

```bash
npm i -g supabase
supabase login
supabase link --project-ref <loyiha-ref>

# OpenRouter kaliti — FAQAT shu yerda turadi, ilovaga tushmaydi
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...

supabase functions deploy ai --no-verify-jwt
```

`--no-verify-jwt` kerak: funksiya tokenni oʻzi tekshiradi va xatoni
oʻzbekcha qaytaradi.

## 5. Ilovani yigʻish

`.env` fayl yarating (`.env.example` dan nusxa oling):

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi…
```

APK ni GitHub Actions yigʻadi. Buning uchun repozitoriyda
**Settings → Secrets and variables → Actions** boʻlimiga qoʻshing:

| Turi | Nomi | Qiymati |
| --- | --- | --- |
| Secret | `SUPABASE_URL` | Project URL |
| Secret | `SUPABASE_ANON_KEY` | anon public kalit |
| Variable | `APK_URL` | APK havolasi (ixtiyoriy) |
| Variable | `EXTENSION_URL` | Kengaytma havolasi (ixtiyoriy) |

## 6. Email tasdiqlash

Supabase → **Authentication → Providers → Email** boʻlimida:

- tasdiqlash xatini yoqib qoʻysangiz ishonchliroq boʻladi;
- sinov davrida oʻchirib qoʻysangiz roʻyxatdan oʻtish darhol ishlaydi.

---

## Kundalik ish: admin panel

Ilovada oʻng yuqoridagi hisob belgisi → **Admin panel**.

**Modellar.** «Yangi model» → foydalanuvchi koʻradigan nom (`DahoX`),
qisqa izoh va ortidagi haqiqiy model (`qwen/qwen3-max`). Foydalanuvchi
faqat Daho nomini koʻradi.

- **Eng kam tarif darajasi** — 0 boʻlsa bepul foydalanuvchiga ham ochiq.
- **Token koeffitsiyenti** — qimmat model uchun 2–4 qoʻying: 1000 token
  sarflansa foydalanuvchi hisobidan 2000–4000 yechiladi.

**Tariflar.** Narx va oylik token chegarasini oʻzgartirasiz.

**Soʻrovlar.** Foydalanuvchi obuna soʻraganda shu yerda koʻrinadi.
Toʻlovni qabul qilgach «Tasdiqlash» — tarif oʻsha zahoti ochiladi.

**Aloqa.** Telegram, telefon va email — foydalanuvchi toʻlov uchun shu
yerdagi maʼlumot orqali bogʻlanadi.

---

## Xarajat nazorati

Sarf ikki joyda hisoblanadi:

1. `usage_events` — har bir soʻrov: nechta kirish/chiqish tokeni ketgan.
2. `profiles.tokens_used` — oylik yigʻindi, har oy boshida nolga tushadi.

Chegara tugasa foydalanuvchi «Oylik token chegarangiz tugadi» degan
xabarni koʻradi va soʻrov OpenRouter’ga umuman yuborilmaydi — demak
sizdan pul yechilmaydi.
