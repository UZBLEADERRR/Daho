# Kontekst arxitekturasi

Bitta qoida: **Daho hech qachon butun tarixni modelga yubormaydi.**
Har soʻrovda «hozirgi savolga javob berish uchun nimani bilishim
kerak?» degan savolga javob yigʻiladi.

```
foydalanuvchi
     │
     ▼
Context Manager ──► Recent · Memory · Topic · Summary
     │
     ▼
Context Builder  (yigʻish)
     │
     ▼
Token Budgeter   (sigʻdirish)
     │
     ▼
Javob keshi ──► bor boʻlsa: model chaqirilmaydi
     │
     ▼
Model Router ──► arzon / oʻrta / kuchli
     │
     ▼
OpenRouter yoki Google
     │
     ▼
javob ──► xulosa va xotira yangilanadi
```

## Qayerda joylashgan

| Fayl | Vazifasi |
| --- | --- |
| `src/lib/context/budget.ts` | Token hisobi, prioritet, sigʻdirish |
| `src/lib/context/topic.ts` | Mavzu holati — «qayerda edik?» |
| `src/lib/context/summary.ts` | Tuzilmali xulosa |
| `src/lib/context/retrieve.ts` | Leksik moslik va saralash |
| `src/lib/context/cache.ts` | Javob keshi |
| `src/lib/context/builder.ts` | Hammasini yigʻadi |
| `src/lib/context/codeindex.ts` | Daho Code: simvollar va bogʻliqlik grafi |
| `src/lib/providers.ts` | Model routing (`pickForJob`) |

## Har soʻrovda nima ketadi

```
tizim koʻrsatmasi     ~1 300 token   (boʻlaklarga ajratilgan)
vosita eʼlonlari      ~1 000         (faqat ochiq guruhlar)
mavzu holati            ~150         (topic, goal, current_task)
mos xotiralar           ~120         (60 tadan 5 tagacha)
suhbat xulosasi         ~250         (tuzilmali, chegaralangan)
oxirgi 8 xabar          ~860
joriy savol              ~50
─────────────────────────────
                      ~3 700 token
```

**Bu raqam suhbat uzunligiga bogʻliq emas.** 80 xabarli suhbat ham
10 xabarlisi kabi turadi.

## Token budjeti

Ish ogʻirligiga qarab:

| Ogʻirlik | Budjet | Qachon |
| --- | --- | --- |
| oddiy | 3 000 | qisqa savol |
| normal | 8 000 | odatiy suhbat |
| murakkab | 16 000 | xato qidirish, test, optimallash |
| arxitektura | 32 000 | qayta qurish, migratsiya |

Chegaradan oshsa tartib qatʼiy:

1. 🔴 joriy savol va tizim koʻrsatmasi — hech qachon kesilmaydi
2. 🔴 yaqin xabarlar
3. 🟠 mavzu holati
4. 🟠 mos xotiralar
5. 🟢 suhbat xulosasi — birinchi boʻlib qisqaradi

Avval **qisqartiriladi** (yarim xotira yoʻq xotiradan yaxshi), keyin
butunlay tashlanadi.

## Nega vektor emas, leksik qidiruv

Embedding har matn uchun alohida soʻrov demakdir — yaʼni qidiruvning
oʻzi pul turadi va internetsiz ishlamaydi. Leksik moslik oʻzbekcha
qoʻshimchalarni hisobga oladi (`Daho` ↔ `Dahoda`, `xotira` ↔
`xotirani`) va tekin. Vektor kerak boʻlsa `retrieve.ts` ga
qoʻshiladi — qolgan kod oʻzgarmaydi.

## Daho Code

Kod loyihasi uchun oddiy chat xotirasi yetmaydi. Shuning uchun
loyiha **indekslanadi**:

```
loyiha fayllari
      │
      ▼
simvollar (funksiya, klass, komponent) + qator raqamlari
      │
      ├──► import grafi (nima nimani ishlatadi)
      └──► fayl hashi (oʻzgarmagani qayta tahlil qilinmaydi)
      │
      ▼
find_code(«Login ishlamayapti»)
      │
      ├─ 1. nom boʻyicha:      Login.tsx
      ├─ 2. bogʻliqlik boʻyicha: useAuth.ts → supabase.ts
      └─ 3. mazmun boʻyicha:    signIn, refreshToken
      │
      ▼
faqat kerakli qatorlar (~100-300 token)
```

Model 1000 qatorli faylni emas, `auth.ts:420-487` ni oladi.

## Qilinmaydigan ishlar

| ❌ | Nega |
| --- | --- |
| Butun tarixni yuborish | Narx suhbat uzunligiga qarab oʻsadi |
| Butun repozitoriyni yuborish | 100k qator — yuz minglab token |
| Barcha xotiralarni yuborish | 60 fakt, aksariyati savolga aloqasiz |
| Terminal chiqishini toʻliq saqlash | `npm install` yuzlab qator |
| Har faylni qayta indekslash | Hash bor — faqat oʻzgargani |
| Bitta ulkan prompt | Agent bosqichlarga boʻlingan |

## Keyingi qadamlar

Hozircha qilinmagan, lekin arxitektura tayyor:

- **Vektor qidiruv** — `retrieve.ts` ichida almashtiriladi;
- **Server tomonda saqlash** — hozir kontekst qurilmada; Supabase
  jadvallariga koʻchirish uchun `builder.ts` interfeysi yetarli;
- **Kesh umumiy boʻlishi** — hozir har qurilmada oʻziniki.
