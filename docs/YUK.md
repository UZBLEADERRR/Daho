# 1000 foydalanuvchi: server nimaga tayanadi

Bu hujjat serverning yuk ostida qanday tutishini va qaysi raqamlarni
oʻzgartirish kerakligini aytadi.

## Eng katta uchta muammo va yechimi

### 1. Har soʻrovda tokenni tekshirish

Avval har bir AI soʻrovi Supabase Auth’ga borib «bu token kimniki?»
deb soʻrardi. 1000 odam ishlaganda bu daqiqasiga minglab soʻrov — va
GoTrue birinchi boʻlib tiqilardi.

Endi natija keshlanadi (5 daqiqa yoki tokenning oʻz muddatigacha), va
bir vaqtda kelgan bir xil tokenlar bitta tekshiruvni kutadi.

Oʻlchov: 100 ta bir vaqtdagi soʻrov → **Supabase’ga 1 chaqiruv**
(avval 100 ta boʻlardi).

### 2. Bitta odam serverni band qilib qoʻyishi

`AI_PER_USER` (standart **3**) — bitta foydalanuvchi bir vaqtda nechta
AI soʻrovi ocha oladi. Toʻrtinchisi navbatda kutadi.

Oʻlchov: bitta odam 12 ta soʻrov yubordi → provayderga bir vaqtda
faqat 2 tasi ketdi (sinovda `perUser=2` qoʻyilgan).

### 3. Umumiy oqim

`AI_CONCURRENCY` (standart **24**) — provayderga bir vaqtda ochiladigan
ulanish soni. Ortiqchasi **rad etilmaydi**, navbatda kutadi
(`AI_QUEUE_WAIT_MS`, standart 30 s). AI javobi baribir soniyalarda
keladi — foydalanuvchi bir necha soniya kutganini sezmaydi, server esa
tiqilmaydi.

Oʻlchov: 30 ta bir vaqtdagi soʻrov, `max=6` → hammasi bajarildi,
provayderda bir vaqtda 6 tadan oshmadi, 30 ta hisob yozuvi toʻgʻri
yozildi.

## Suiisteʼmolga qarshi

`AI_RATE_PER_MIN` (standart **90**), `AI_RATE_BURST` (standart **30**).

Chegara ataylab baland: agent bitta topshiriq uchun oʻnlab chaqiruv
qilishi mumkin. Maqsad — halol ishni boʻlish emas, skript bilan
serverni koʻmishni toʻxtatish. Chegaraga urilganda `429` va
`Retry-After` qaytadi.

## Keshlar

| Nima | Muddati | Nega |
| --- | --- | --- |
| Token tekshiruvi | 5 daqiqa | Supabase Auth’ni qutqaradi |
| `resolve_model` | 1 daqiqa | Model tavsifi kamdan-kam oʻzgaradi |
| OpenRouter katalogi | 10 daqiqa | 300+ model roʻyxati, admin uchun |
| `/api/public-config` | 5 daqiqa (brauzerda) | Har ochilishda soʻralmasin |

## Holatni koʻrish

```
GET /health
```

```json
{
  "yuk": { "active": 3, "waiting": 0, "users": 3, "max": 24, "perUser": 3 },
  "xotira_mb": 96,
  "ish_vaqti_s": 51230
}
```

`waiting` doim noldan katta boʻlsa — `AI_CONCURRENCY` ni oshirish yoki
ikkinchi nusxa qoʻshish vaqti keldi.

## Sozlamalar (Railway)

```
AI_CONCURRENCY=24        # provayderga bir vaqtda ochiq ulanish
AI_PER_USER=3            # bitta foydalanuvchiga
AI_QUEUE_WAIT_MS=30000   # navbatda eng koʻp kutish
AI_RATE_PER_MIN=90       # daqiqasiga soʻrov
AI_RATE_BURST=30         # bir zumda ruxsat etilgan portlash
```

## Chegara: bir nechta nusxa

Kesh va navbat **jarayon xotirasida**. Railway’da bitta nusxa ishlasa
shu toʻgʻri va tez. Ikki va undan koʻp nusxa qoʻyilsa har biri oʻz
chegarasini yuritadi — yaʼni umumiy chegara nusxalar soniga koʻpayadi.

Oʻsha paytda kerak boʻladi:

1. Redis (`ioredis`) — token keshi va tezlik chegarasi umumiy boʻlsin;
2. Navbatni Redis’da yuritish yoki har nusxaga `AI_CONCURRENCY` ni
   nusxalar soniga boʻlib berish (eng oddiy yechim, koʻpincha yetarli).

Hozircha 1000 foydalanuvchi uchun bitta nusxa yetadi: AI soʻrovi
asosan **kutish**, protsessor emas.
