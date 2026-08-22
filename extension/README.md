# Daho — brauzer kengaytmasi

Manifest V3 kengaytma: sahifani oʻqiydi, tarjima qiladi va savolga javob
beradi. Suhbatlar Daho hisobi orqali telefon va veb bilan sinxron turadi.

## Yigʻish

```bash
DAHO_SUPABASE_URL=https://xxxx.supabase.co \
DAHO_SUPABASE_ANON_KEY=eyJhbGciOi… \
npm run ext
```

Manzil berilmasa kengaytma birinchi ochilishda sozlash sahifasini
koʻrsatadi va foydalanuvchi oʻzi kiritadi.

## Chrome ga qoʻshish

1. `chrome://extensions` ni oching
2. «Developer mode» ni yoqing
3. «Load unpacked» → `extension/dist` papkasini tanlang

## Ichida nima bor

| Fayl | Vazifasi |
| --- | --- |
| `popup.html` | Tez amallar: qisqacha, tarjima, tushuntirish |
| `sidepanel.html` | Asosiy suhbat oynasi (Alt+D) |
| `content.js` | Sahifadan asosiy matnni ajratib beradi |
| `background.js` | Oʻng tugma menyusi va panelni ochish |
| `options.html` | Server manzilini kiritish |

Sahifaning butun HTML si emas, faqat tozalangan asosiy matni yuboriladi —
javob aniqroq boʻladi va token kam sarflanadi.
