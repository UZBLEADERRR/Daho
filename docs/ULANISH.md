# Ulanish va qaytish manzillari (redirect URL)

Qisqa javob: **hamma xizmat uchun bitta manzil** —

```
https://daho-production-82e9.up.railway.app/oauth/callback
```

Bu sahifa kodni qabul qilib, vebda ilovaga, telefonda esa
`uz.daho.app://oauth` deep link orqali APK ga qaytaradi. Shuning uchun
har bir xizmatda faqat shu bitta manzilni roʻyxatdan oʻtkazish yetarli.

Quyida qayerga nima yozilishi aniq koʻrsatilgan.

---

## 1. Supabase — foydalanuvchi kirishi (Auth)

Bu ilovaning OʻZ roʻyxatdan oʻtishi: pochta tasdiqlash, parol tiklash.

**Supabase → Authentication → URL Configuration**

| Maydon | Qiymat |
| --- | --- |
| Site URL | `https://daho-production-82e9.up.railway.app` |
| Redirect URLs | `https://daho-production-82e9.up.railway.app/**` |
| Redirect URLs (yana) | `uz.daho.app://oauth` |
| Redirect URLs (ishlab chiqish) | `http://localhost:5173/**` |

`/**` muhim: parol tiklash havolasi ilovaning ichki yoʻliga qaytadi.
Usiz Supabase «redirect not allowed» deb xato beradi.

---

## 2. Supabase — Daho loyiha ocha olishi (Management API)

Bu boshqa narsa: agent SQL bajarishi, jadval yaratishi uchun.

**Supabase → tashkilot sozlamalari → OAuth Apps → Create app**

| Maydon | Qiymat |
| --- | --- |
| Redirect URI | `https://daho-production-82e9.up.railway.app/oauth/callback` |

Chiqqan `Client ID` va `Client Secret` ni Railway’ga qoʻyasiz:

```
SUPABASE_OAUTH_CLIENT_ID=...
SUPABASE_OAUTH_CLIENT_SECRET=...
```

Shundan keyin ilovada «Supabase bilan ulash» tugmasi paydo boʻladi va
foydalanuvchidan `sbp_…` token soʻralmaydi.

---

## 3. GitHub

**GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**

| Maydon | Qiymat |
| --- | --- |
| Homepage URL | `https://daho-production-82e9.up.railway.app` |
| Authorization callback URL | `https://daho-production-82e9.up.railway.app/oauth/callback` |

Railway:

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Endi Daho Code repo ocha oladi, push qiladi, PR yaratadi — foydalanuvchi
token yasamaydi.

---

## 4. Google (Gmail, Drive, Calendar, YouTube)

**Google Cloud Console → APIs & Services → Credentials → OAuth client ID
→ Web application**

| Maydon | Qiymat |
| --- | --- |
| Authorized redirect URIs | `https://daho-production-82e9.up.railway.app/oauth/callback` |

Railway:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## 5. AI provayderlari

Bularda OAuth yoʻq — oddiy kalit, va u faqat Railway’da turadi:

```
OPENROUTER_API_KEY=sk-or-v1-...
GEMINI_API_KEY=...
```

Kalitlar bazaga yozilmaydi, admin panelda koʻrinmaydi va brauzerga
chiqmaydi. Panel faqat «ulangan / yoʻq» ni koʻrsatadi.

---

## Qanday ishlaydi

1. Foydalanuvchi «Ulash» tugmasini bosadi (yoki AI suhbat ichida taklif
   qiladi — `connect_service` vositasi).
2. Ilova serverning `/api/oauth/start/<xizmat>` manziliga oʻtadi. Mijoz
   ID va ruxsatlar shu yerda qoʻshiladi — ilova ularni bilishi shart emas.
3. Xizmat sahifasida foydalanuvchi «Allow» bosadi.
4. Xizmat `/oauth/callback` ga kod bilan qaytadi.
5. Sahifa kodni ilovaga uzatadi, ilova `/api/oauth/exchange` orqali uni
   tokenga almashtiradi. **Client secret brauzerga hech qachon chiqmaydi.**
6. Token qurilmada saqlanadi.

## Xatolar

| Xato | Sababi |
| --- | --- |
| `redirect_uri_mismatch` | Xizmatdagi manzil yuqoridagi bilan aynan bir xil emas (`/` yoki `http/https` farqi ham hisobga olinadi). |
| «ulanishi hali sozlanmagan» | Railway’da oʻsha xizmatning `CLIENT_ID` / `CLIENT_SECRET` i yoʻq. |
| Telefonda ilova qaytmadi | APK da `uz.daho.app` sxemasi roʻyxatdan oʻtmagan. |
