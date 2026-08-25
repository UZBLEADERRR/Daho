# Daho kengaytmasi

Ochiq sahifani tahlil qiladi — YouTube videosi, Telegram suhbati,
Instagram posti yoki oddiy maqola.

## Oʻrnatish

Eng oson yoʻl — Daho serveridagi tayyor arxiv:
**`https://<sizniki>.up.railway.app/extension`** (u yerda yoʻriqnoma ham bor).

Yoki shu papkadan bevosita:

1. Chrome/Edge da `chrome://extensions` ni oching.
2. Oʻng yuqorida **Developer mode** ni yoqing.
3. **Load unpacked** → shu `extension/` papkasini tanlang.
4. Panelni ochib Gemini kalitini bir marta kiriting
   (aistudio.google.com/apikey dan bepul olinadi).

Belgini bosganda yon panel ochiladi. Yon panel yoʻq brauzerda alohida
oyna ochiladi. Kengaytmani yangilaganingizda `chrome://extensions` da
**qayta yuklash** (🔄) tugmasini bosing — eski nusxa xotirada qolib
ketmasin.

Telefondagi Chrome kengaytmalarni qoʻllab-quvvatlamaydi — buni
kompyuterda qiling (Android’da Kiwi Browser ishlaydi).

Kalit brauzeringizning oʻz omborida qoladi va hech qayerga yuborilmaydi;
soʻrov bevosita Google ga ketadi.

## Boʻlimlar

Panel ilovadagi Daho bilan bir xil tuzilgan:

| Boʻlim | Nima |
|---|---|
| **Suhbat** | Davomli suhbat — panel yopilsa ham saqlanadi |
| **Kod** | Agent yozgan fayllar; nusxalash va yuklab olish |
| **Vositalar** | Server holati, Telegram boti, saqlangan natijalar |

Yuqori oʻngda **model tanlash** — roʻyxat kalitingiz bilan Google’dan
olinadi va bir kun keshda turadi.

## Agent vositalari

| Vosita | Nima qiladi |
|---|---|
| `read_page` | Ochiq sahifa — YouTube, Telegram, Instagram, maqola |
| `open_tab` | Havolani ochib oʻqiydi, keyin varaqni yopadi |
| `write_code` | Kod yozadi va «Kod» boʻlimiga qoʻyadi |
| `save_note` | Uzun natijani saqlaydi |
| `server_status` | Daho serverining holati — «serverda nima boʻlyapti» |
| `http_get` | Ochiq havoladan JSON yoki matn |
| `telegram` | Bot orqali xabar oʻqish va yuborish |

Server va Telegram uchun sozlamalarga manzil va tokenni qoʻying
(⚙ tugmasi).

## Nima qiladi

| Sayt | Nimani oʻqiydi |
|---|---|
| YouTube | Sarlavha, kanal, koʻrishlar, tavsif, 40 tagacha izoh |
| Telegram Web | Ochiq suhbatdagi oxirgi 60 xabar (kim yozgani bilan) |
| Instagram | Post matni, muallif, izohlar |
| Boshqa saytlar | Asosiy matn |

Tayyor tugmalar: **Qisqacha**, **Izohlar** (kayfiyat tahlili),
**Konspekt**, **Foydalimi**. Yoki oʻz savolingizni yozasiz.

## Ish taqsimoti: kengaytma va ilova

Kengaytma sahifani **oʻqiydi va matn tayyorlaydi**. Haqiqiy yuborish
ishlarini ilovaning oʻzi bajaradi:

| Ish | Qayerda |
|---|---|
| Sahifani tahlil qilish, qoʻllanma yozish | Kengaytma |
| Izohlarga javob matnini tayyorlash | Kengaytma |
| Instagram izohiga JAVOB YUBORISH | Ilova (Graph API) |
| Instagram Direct’ga javob | Ilova (Graph API) |
| YouTube izohiga javob | Ilova (YouTube API) |
| Telegram guruhini kuzatish | Ilova (Bot API) |

Sabab texnik: minglab xabarga javob berish kerak boʻlsa sahifani bosib
turish ishlamaydi — soatiga 20-30 tada tiqiladi va selektorlar har
yangilanishda buziladi. Rasmiy API larda bunday chegara yoʻq va ular
aynan shu ish uchun qilingan.

Ilovada Sozlamalar → **Instagram** va **Google hisobi** boʻlimlaridan
ulanadi.

## Cheklovlar

- `chrome://` sahifalarida va Chrome Web Store da ishlamaydi (brauzer
  taqiqlaydi).
- Telegram/Instagram sahifa tuzilishini oʻzgartirsa yigʻish buzilishi
  mumkin — `src/collect.js` dagi selektorlarni yangilash kerak boʻladi.
- Sahifadagi matn juda uzun boʻlsa qisqartiriladi.
