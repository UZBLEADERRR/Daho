# Maʼlumotlar: nima saqlanadi va qayerda

Savol aniq edi — «maʼlumotlar saqlanyaptimi, API kalitlar qayerda?».
Quyida haqiqiy holat. Barcha jadvallar `supabase/migrations/` da, RLS
(qatorlar himoyasi) hammasida yoqilgan.

## Bazani sozlash

Supabase → SQL Editor ga **`supabase/setup.sql`** ni qoʻyib «Run» bosing.
Bitta fayl — toʻqqizta migratsiyani tartib bilan oʻz ichiga oladi.

Bir necha marta ishga tushirsa ham xavfsiz. Eski, yarim yaratilgan bazada
ham ishlaydi: yetishmagan ustunlar oʻzi toʻldiriladi.

### «Pochtasiz roʻyxatdan oʻtgan» holati

Sxema oʻrnatilishidan OLDIN roʻyxatdan oʻtgan odamda `auth.users` da qator
bor, lekin `public.profiles` da yoʻq: oʻsha paytda `handle_new_user()`
triggeri hali yaratilmagan edi. Natijada ilova pochtani ham, rolni ham
koʻrsatolmaydi va «tizimda 0 ta admin bor» deb yozadi.

Ikki tomondan yopildi:

* `setup.sql` ishga tushganda `auth.users` dagi hamma hisob uchun profil,
  obuna va balans yaratiladi; pochtasi `admin_emails` da boʻlsa — admin.
* Har kirishda `my_account()` → `ensure_profile()` profilni tekshiradi va
  yetishmasa oʻsha zahoti yaratadi. Pochta tokendan olinadi.

## Jadvallar

| Jadval | Nima turadi | Kim koʻradi |
| --- | --- | --- |
| `profiles` | Pochta, ism, rol, blok holati | Oʻzi + admin |
| `plans` | Tariflar: narx, kredit, oyna-limitlari | Hamma (faol boʻlsa) |
| `plan_models` | Qaysi rejaga qaysi model ochiq va narxi | Admin |
| `subscriptions` | Kim qaysi rejada, muddati | Oʻzi + admin |
| `credit_balances` | Obuna krediti va **hisobdagi pul** (`wallet`) | Oʻzi + admin |
| `wallet_events` | Hisob toʻldirish va sarf tarixi | Oʻzi + admin |
| `usage_events` | Har soʻrov: model, token, kredit | Oʻzi + admin |
| `daily_model_usage` | Bepul Daho Daily dan kunlik foydalanish | Oʻzi + admin |
| `purchase_requests` | Obuna soʻrovlari | Oʻzi + admin |
| `jobs` | Fon vazifalari navbati | Oʻzi + admin |
| `sync_items` | Qurilmalar orasidagi sinxron maʼlumot | Faqat oʻzi |
| `bot_tokens` | Telegram bot tokeni | Faqat oʻzi |
| `app_settings` | Ichki sozlamalar | Admin (ochiq kalitlardan tashqari) |

## API kalitlar qayerda

Bu eng muhim savol, shuning uchun aniq javob:

| Kalit | Qayerda turadi | Kim koʻra oladi |
| --- | --- | --- |
| **Sizning OpenRouter / Gemini kalitingiz** | Supabase Edge Function siri (`GEMINI_API_KEY`) | Hech kim. Kod ham koʻrmaydi, faqat ishlatadi |
| `SUPABASE_SERVICE_ROLE_KEY` | Server va edge function siri | Hech kim |
| `SUPABASE_ANON_KEY` | Ilovaga yigʻiladi — **ochiq boʻlishi kerak** | Hamma. Himoya RLS da |
| **Foydalanuvchining oʻz Gemini kaliti** | Faqat oʻsha qurilmaning `localStorage` ida | Faqat oʻzi. Serverga umuman yuborilmaydi |
| Telegram bot tokeni | `bot_tokens` jadvali, RLS bilan | Faqat egasi |

Foydalanuvchining kaliti bazaga **hech qachon** yozilmaydi. Obuna bilan
ishlaganda esa kalit umuman soʻralmaydi — soʻrov `ai-gateway` orqali
sizning kalitingiz bilan ketadi.

## Sarf qanday hisoblanadi

```
soʻrov → can_use_model()  →  ruxsat + qaysi hamyondan yechish
                          →  Google/OpenRouter ga yuboriladi
                          →  charge_usage()  →  usage_events ga yoziladi
                                            →  kredit yoki pul yechiladi
```

Uch xil hamyon:

- **`plan`** — obuna krediti. Har davrda yangilanadi, qoldigʻi kuyadi.
- **`wallet`** — hisobdagi pul. Kuymaydi, obuna limiti tugagach ishlatiladi.
- **`daily`** — bepul Daho Daily. Hech narsa yechilmaydi, faqat kunlik
  xabarlar soni oshadi.

## Foydalanuvchi nimani koʻradi

Token yoki kredit soni **koʻrsatilmaydi** — u raqamning nimani anglatishini
bilmaydi va bekorga xavotir oladi. Oʻrniga foizli koʻrsatkich:

- Soatlik limit: 80%
- Kunlik limit: 45%
- Haftalik limit: 92%
- Obuna davri: 61%

Model narxi ham raqam emas: «tejamkor», «oʻrtacha», «limitni tez yeydi».

## Tekshirish

Migratsiyalar haqiqiy PostgreSQL 16 da ishga tushirilib sinaladi:

```bash
# lokal klaster koʻtarish va migratsiyalarni yugurtirish
initdb -D /var/tmp/dahopg/data -A trust
pg_ctl -D /var/tmp/dahopg/data -o "-k /var/tmp/dahopg -p 5433" start
psql -h /var/tmp/dahopg -p 5433 -c 'create database daho'
# auth sxemasi taqlidi + migratsiyalar tartib bilan
```

Sinalgan holatlar: admin roli, obuna krediti → kunlik limit → hisobdagi
pul → bepul model → bepul ham tugadi → Pro cheksiz, uch xil yechish
yoʻli va sozlamalarning koʻrinishi.
