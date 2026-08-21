# Daho kengaytmasi

Ochiq sahifani tahlil qiladi — YouTube videosi, Telegram suhbati,
Instagram posti yoki oddiy maqola.

## Oʻrnatish

1. Chrome/Edge da `chrome://extensions` ni oching.
2. Oʻng yuqorida **Developer mode** ni yoqing.
3. **Load unpacked** → shu `extension/` papkasini tanlang.
4. Panelni ochib Gemini kalitini bir marta kiriting
   (aistudio.google.com/apikey dan bepul olinadi).

Kalit brauzeringizning oʻz omborida qoladi va hech qayerga yuborilmaydi;
soʻrov bevosita Google ga ketadi.

## Nima qiladi

| Sayt | Nimani oʻqiydi |
|---|---|
| YouTube | Sarlavha, kanal, koʻrishlar, tavsif, 40 tagacha izoh |
| Telegram Web | Ochiq suhbatdagi oxirgi 60 xabar (kim yozgani bilan) |
| Instagram | Post matni, muallif, izohlar |
| Boshqa saytlar | Asosiy matn |

Tayyor tugmalar: **Qisqacha**, **Izohlar** (kayfiyat tahlili),
**Konspekt**, **Foydalimi**. Yoki oʻz savolingizni yozasiz.

## Nimani ataylab qilmadim

Kengaytma **faqat oʻqiydi**. U sizning nomingizdan xabar yubormaydi,
tugma bosmaydi, obuna boʻlmaydi.

Sabab oddiy: Telegram va Instagram avtomatlashtirilgan harakatni
aniqlaydi va hisobni bloklaydi. Ularning shartlarida ham bu taqiqlangan.
Shuning uchun tahlil qilaman, javob matnini tayyorlab beraman — yuborishni
oʻzingiz bosasiz.

Agar hisobingiz uchun rasman ruxsat berilgan yoʻl kerak boʻlsa — Telegram
Bot API bor, uni ilovaning **Ulanishlar** boʻlimidan ulash mumkin.

## Cheklovlar

- `chrome://` sahifalarida va Chrome Web Store da ishlamaydi (brauzer
  taqiqlaydi).
- Telegram/Instagram sahifa tuzilishini oʻzgartirsa yigʻish buzilishi
  mumkin — `src/collect.js` dagi selektorlarni yangilash kerak boʻladi.
- Sahifadagi matn juda uzun boʻlsa qisqartiriladi.
