# Kengaytmani Chrome Web Store ga chiqarish

Chrome 2018 yildan beri Doʻkondan tashqari kengaytmani bir bosishda
oʻrnatishga ruxsat bermaydi. «Load unpacked» — vaqtinchalik yoʻl.
Haqiqiy oʻrnatish uchun Doʻkonga joylash shart. Quyida aynan nima
kerakligi.

## 1. Arxivni tayyorlash

```bash
DAHO_SERVER_URL=https://daho-production-82e9.up.railway.app npm run ext
```

Natija: `public/daho-extension.zip`. Skript avval manifestni tekshiradi
(versiya, tavsif uzunligi, ikonkalar, koʻrsatilgan fayllar bormi) —
Doʻkon rad qiladigan xatolar shu yerda ushlanadi.

Server manzili arxiv ichidagi `config.json` ga yoziladi. Shuning uchun
foydalanuvchi kengaytmada hech qanday manzil yoki token kiritmaydi.

## 2. Ishlab chiquvchi hisobi

1. https://chrome.google.com/webstore/devconsole
2. Bir martalik toʻlov: **$5**.
3. «New item» → `daho-extension.zip` ni yuklash.

## 3. Doʻkon soʻraydigan maʼlumot

| Maydon | Nima yozish |
| --- | --- |
| Nomi | Daho |
| Qisqa tavsif | Ochiq sahifani oʻqiydi va tushuntiradi — YouTube videosining subtitrigacha. |
| Toifa | Productivity |
| Til | Uzbek (oʻzbek) |
| Ekran rasmlari | 1280×800 yoki 640×400, kamida bittasi |
| Ikonka | 128×128 (arxiv ichida bor) |
| Maxfiylik siyosati | Majburiy — pastga qarang |

### Ruxsatlarni izohlash (majburiy)

Doʻkon har bir ruxsat nima uchun kerakligini soʻraydi. Javoblar:

| Ruxsat | Izoh |
| --- | --- |
| `activeTab` | Foydalanuvchi kengaytma belgisini bosganda oʻsha varaqni oʻqish uchun. |
| `scripting` | Sahifadagi matnni va YouTube subtitrini yigʻish uchun. |
| `storage` | Suhbat tarixi va kirish sessiyasini qurilmada saqlash uchun. |
| `sidePanel` | Interfeys yon panelda ochiladi. |
| `contextMenus` | Belgilangan matnni oʻng tugma orqali Dahoʻga yuborish uchun. |
| `host_permissions: https://*/*` | Foydalanuvchi soʻraganda istalgan sahifani tahlil qilish. Maʼlumot faqat foydalanuvchi oʻzi soʻraganda oʻqiladi va faqat Daho serveriga yuboriladi. |

`https://*/*` keng ruxsat — Doʻkon buni qoʻshimcha tekshiradi. Izohda
aynan yuqoridagi jumlani yozing: «faqat foydalanuvchi soʻraganda».

## 4. Maxfiylik siyosati

Doʻkon uchun ochiq havola kerak. Sahifa quyidagilarni aytishi shart:

- qanday maʼlumot yigʻiladi (ochiq sahifa matni — faqat foydalanuvchi
  soʻraganda; pochta va parol — hisob uchun);
- qayerga yuboriladi (Daho serveri va AI provayderi);
- nima saqlanadi (suhbat tarixi qurilmada; sarflangan token hisobi
  serverda);
- sotilmasligi va reklama uchun ishlatilmasligi.

`docs/DATA.md` da hammasi bor — shuni ochiq sahifa qilib qoʻyish yetadi.

## 5. Koʻrib chiqish

Odatda 1–3 kun, keng ruxsat bilan 1–2 hafta boʻlishi mumkin. Tasdiqlangach
Railway’ga qoʻying:

```
EXTENSION_STORE_URL=https://chromewebstore.google.com/detail/<id>
```

Shundan keyin `/extension` sahifasidagi tugma «Load unpacked» yoʻriqnomasi
oʻrniga toʻgʻridan-toʻgʻri Doʻkonga olib boradi.

## 6. Keyingi versiyalar

`manifest.json` dagi `version` ni oshiring (Doʻkon bir xil raqamni
qabul qilmaydi), qayta paketlang, «Package» → «Upload new package».
