# Daho

Universitet uchun shaxsiy AI yordamchi va agent. **Telefon, planshet va
kompyuterda bir xil ishlaydi** — bitta kod, bitta interfeys: Android ilovasi
(APK) va veb versiya (PWA).

Ikki rejim bor va ikkalasi bir vaqtda yashaydi:

- **Mahalliy rejim** — hech qanday server yoʻq. Oʻz Gemini kalitingizni
  kiritasiz, barcha maʼlumot faqat qurilmada qoladi, ilova Google'ga
  toʻgʻridan-toʻgʻri murojaat qiladi. Ilova internetsiz ham ochiladi.
- **Daho Cloud** — hisob ochasiz: maʼlumot qurilmalar orasida sinxronlanadi,
  obuna orqali modellar ochiladi, tokenlar va narx nazorat qilinadi, fon
  vazifalari ilova yopiq boʻlsa ham serverda bajariladi.
  Oʻrnatish: [`docs/CLOUD.md`](docs/CLOUD.md).

## Nimalar bor

**Chat tarafi**
- Gemini bilan oqim (streaming) tarzida suhbat, oʻzbek tilida
- Model roʻyxati Google’dan **jonli olinadi** — yangi model chiqsa oʻzi paydo
  boʻladi, eskisi ishlamay qolsa avtomatik almashtiriladi
- Rasm biriktirish — daftar yoki kitob sahifasini surat qilib savol berish
- **Mikrofon**: ovoz yozib olinadi va Gemini orqali matnga oʻgiriladi —
  oʻzbekchani qurilmaning oʻz xizmatidan ancha yaxshi tushunadi
- **Tabiiy ovoz**: Sardor, Madina, Bekzod, Nilufar… — Gemini TTS ovozlari
- Bitta yumaloq input: chapda `+`, oʻngda doim mikrofon; matn yozilsa
  mikrofon yuborish tugmasiga aylanadi
- `+` menyusi: rasm biriktirish, rasm yaratish, video yasash, ilova yasash,
  kurs ochish, hujjat yasash
- **Rasm chizish**: «logotip chizib ber» desangiz kifoya — rasm chatning
  oʻzida chiqadi (mavjud rasmni «buni oʻzgartir» deb tahrirlash ham mumkin)
- **Artifactlar**: AI yasagan HTML ilova, oʻyin, test, kalkulyator yoki
  diagramma darhol ilova ichida ochiladi va ishlaydi. Chatda xom kod
  koʻrinmaydi — bitta ▶ tugmali ixcham kartochka boʻladi, va artifact faqat
  siz soʻraganingizda yasaladi (token bekorga sarflanmaydi)

**Mini ilovalar**
AI yasagan ilovani nom va emoji ikonka bilan «Ilovalarim» boʻlimiga qoʻshasiz —
telefondagi oddiy ilovadek grid koʻrinishida turadi va toʻliq ekranda ochiladi.
Ilovalar oʻz maʼlumotini saqlaydi (hisob, natija, roʻyxat) — qumbox ichida
xavfsiz saqlash qatlami ishlaydi, ilova ilovaning oʻz maʼlumotiga tegmaydi.
Yasalgan ilova avtomatik sinovdan oʻtadi: xato boʻlsa darhol ogohlantiradi.
Havola bilan qoʻshilgan ilovalar ham bor. ChatGPT, Google, Instagram kabi saytlar
boshqa ilova ichida ochilishni taqiqlaydi (`X-Frame-Options`) — ular telefon
brauzerida ochiladi. Har bir havolali ilova uchun buni qoʻlda ham sozlash mumkin.

**Kurslar**
«IELTS 7.0 olmoqchiman» deysiz — agent 40-100 ta mavzudan iborat kurs ochadi.
Istagan mavzuni bosasiz: vizual, misollar va interaktiv testdan iborat dars
oʻsha zahoti yasaladi. Progress saqlanadi.

**Video studiya**
Mavzuni yozasiz — ssenariy, sahna rasmlari, diktor ovozi va subtitr avtomatik
tayyorlanadi. Subtitr uslubi (oʻlcham, rang, chekka, joylashuv, fon),
qahramonlar (koʻrinishi va ovozi), sahna matni va rasm soʻrovi — hammasi
tahrirlanadi. Video **telefonning oʻzida** yigʻiladi (canvas + MediaRecorder),
9:16 / 16:9 / 1:1 formatlarda.

**Daho Code** ⌨️ — yuqori navbardagi uchinchi tab (Chat · Agent · Code).
Telefondagi dasturchi agent. Koʻp fayldan iborat loyiha yuritadi:
fayllarni oʻzi oʻqiydi va yozadi (`read_file`, `write_file`, `edit_file`,
`delete_file`), GitHub bilan ishlaydi (repolarni koʻradi, fayl koʻchiradi, yangi
repo ochadi, bitta commit bilan push qiladi) va loyihani **internetga chiqarib
jonli havola beradi**.

- *Koʻrinish* — loyiha telefonning oʻzida ishlaydi: `<link href="style.css">` va
  `<script src="app.js">` avtomatik birlashtiriladi, server kerak emas.
- *Nashr* — GitHub Pages orqali haqiqiy public URL. Oʻz domeningizni kiritsangiz
  CNAME fayli oʻzi qoʻshiladi; DNS koʻrsatmasi shu yerda yozilgan.
- *Shablonlar* — 🌐 Veb sayt · 📱 Android ilova (APK) · 🤖 Telegram bot · 🧱 Fullstack.
- *Model tanlash* — har bir loyihaga alohida model (sarlavhadagi chip).
- *Skrinshot* — xatoning suratini yuborsangiz, agent oʻqib tuzatadi.
- *Oʻz ishini sinaydi* — `test_app` bilan loyihani telefonda haqiqatan ishga
  tushiradi: JS xatolarini, boʻsh sahifani, qaysi tugma va matn chiqqanini
  koʻradi. Xato boʻlsa oʻzi tuzatib qayta sinaydi. Bot va Node kodi esa
  GitHub Actions da ishga tushirilib, logi oʻqiladi.
- *GitHub Actions* — agent ish oqimi yozadi, ishga tushiradi va natijani kuzatadi.
  **APK shu yoʻl bilan yigʻiladi**: kod → push → run_workflow → tayyor fayl.

**Savol berish va birga ishlash** 💬
Vaziyat noaniq boʻlsa agent taxmin qilmaydi — variantlar bilan savol beradi va
javobingizni kutadi. Yuqoridagi qatorda **necha soniyadan beri** ishlayotgani va
**hozir aynan nima qilayotgani** koʻrinib turadi. Ish ketayotganda qoʻshimcha
fikr yozsangiz — toʻxtatmasdan hisobga oladi va rejasini oʻzgartiradi.

**Fon rejimi** ⏳
Agent ishi boshqa boʻlimga oʻtganingizda ham davom etadi — pastda ingichka qatorda
nima bajarilayotgani koʻrinadi va uni istalgan joydan toʻxtatasiz. Ish davomida
ekran oʻchmaydi (Wake Lock). Ilova yopilib qolsa, ochilganda tugallanmagan ish
belgilanadi.

**Chiroyli natijalar** 📊
Chat javoblarida grafiklar chiziladi: ustunli, gorizontal, chiziqli, doira va
raqamli kartochkalar. Har bir grafikda legenda, bosilganda qiymat va **Jadval**
tugmasi bor. Ranglar rang koʻrmaslikka (CVD) qarshi tekshirilgan palitradan.
Javoblarda markdown jadvallar va emoji ham ishlatiladi.

**Joylashuv, kamera va jonli maʼlumot** 🗺️
- «Konkuk universitetiga bormoqchiman» → agent joylashuvingizni aniqlaydi,
  manzilni xaritadan topadi va chatda **jonli kuzatuv kartasi** chiqaradi:
  OpenStreetMap xaritasi, masofa, «Xaritada ochish» (telefon xaritasida
  yoʻl-yoʻriq) va kuzatuv rejimi — yurganingiz sayin masofa yangilanadi.
- Metro liniyasi, avtobus raqami, jadval, narx kabi **jonli maʼlumot** Google
  qidiruvi orqali tekshiriladi — model oʻzidan oʻylab topmaydi.
- `+` menyusida **Kamera** — surat olib darhol savol berasiz — va
  **Joylashuvim** tugmasi bor.
- Mikrofon ishlamasa: Sozlamalar → **«Mikrofonni tekshirish»** har bosqichni
  alohida sinab, muammo qayerdaligini aytadi.

**Ilova qiyofasi** 🎨
Sozlamalar → «Ilova qiyofasi»: telefondan rasm tanlaysiz va yangi nom yozasiz.
Ishlab turgan ilova oʻz ikonkasini almashtira olmaydi, shuning uchun Daho barcha
oʻlchamdagi ikonkalarni telefonning oʻzida yasab, GitHub’dagi oʻz repozitoriysiga
yozadi va APK’ni qaytadan yigʻadi — bir necha daqiqadan soʻng yangi nom va
ikonkali APK’ni oʻrnatasiz. GitHub token kerak.

**Nusxalash** 📋
Xabar matnini bosib turib belgilash mumkin, ikki marta bossangiz butun xabar
nusxalanadi. Har bir javob ostida «Nusxa» tugmasi ham bor.

**Hujjatlar**
Har qanday javobni **Word (.docx)**, **PDF**, **slayd (.pptx)** yoki matn
qilib yuklab olasiz — hammasi qurilmada yasaladi.

**Hujjatga rasm qoʻshish** 🖼
Word (.docx) yoki PDF faylni biriktirib «shu kitobga 5 ta rasm qoʻshib ber»
desangiz: matn oʻqiladi, mazmunga mos rasmlar chiziladi va **mos joylarga
qoʻyilgan yangi .docx** telefoningizga saqlanadi (rasm ostida izoh bilan).
.docx ning matni telefonda ochiladi — hujjat serverga yuborilmaydi.

**Agent tarafi**
- *Bugun* — kunlik xulosa: darslar, muddati kelgan vazifalar, ish vaqti
- *Jadval* — haftalik dars jadvali
- *Vazifalar* — uy vazifalari va deadline'lar
- *Loyihalar* — kurs ishi/diplom kabi katta ishlar bosqichlari bilan
- *Konspekt* — fanlar boʻyicha yozuvlar, markdown qoʻllab-quvvatlanadi
- *Ish vaqti* — taymer va kunlik/haftalik statistika
- *Artifactlar* — AI yasagan barcha ilova va rasmlar galereyasi

**Eng muhimi:** agentning "qoʻllari" bor. Chatda oddiy gapirsangiz kifoya —
jadvalni yozadi, vazifa qoʻshadi, konspekt saqlaydi, loyiha rejasini tuzadi,
ish vaqtingizni qaydga oladi.

> «Dushanba 9:00 da matematik analiz, 11:00 da fizika» → jadvalga tushadi
> «Payshanbagacha algoritmlardan referat» → vazifa boʻlib qoʻshiladi
> «Hosila mavzusini tushuntir va saqlab qoʻy» → tushuntiradi va konspekt qiladi
> «Formulalarni yodlash uchun test ilovasi yasab ber» → ishlaydigan ilova beradi

## Veb versiya (desktop va mobil)

Bir xil ilova brauzerda ham ishlaydi:

- **Bitta interfeys** — mobilda yon panel surilib chiqadi, keng ekranda
  (≥960px) doim ochiq turadi; matn va suhbat maydoni oʻqishga qulay
  kenglikda markazlashadi. Boʻlimlar, tugmalar va imkoniyatlar aynan bir xil.
- **PWA** — brauzerdan «oʻrnatish» mumkin, oʻz ikonkasi bilan alohida oyna
  boʻlib ochiladi (Sozlamalar → «Ilovani qurilmaga oʻrnatish»).
- **Oflayn** — service worker ilova qobigʻini keshlaydi, internet uzilsa ham
  ochiladi va mahalliy maʼlumot bilan ishlayveradi.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # natija: dist/ — istalgan statik hostingga
```

`main` ga push qilinganda GitHub Pages ga avtomatik nashr qilinadi
(`.github/workflows/web.yml`). Bulut kerak boʻlsa repo secret'lariga
`VITE_SUPABASE_URL` va `VITE_SUPABASE_ANON_KEY` ni qoʻshing.

## Daho Cloud — obuna va nazorat

Bulut yoqilganda ilovada uchta yangi narsa paydo boʻladi.

**Hisob** (yuqori navbardagi ☁ tugmasi)
- Reja, qolgan kredit, bugungi va oylik sarf
- Rejada ochiq modellar va ularning token narxi
- Sinxronizatsiya holati
- Rejalar roʻyxati va obuna soʻrovi

**Fon vazifalari** — obuna ochsa. Vazifani navbatga qoʻyasiz
(matn, qidiruv, reja, rasm), ilovani yopsangiz ham server bajaradi,
natija tayyor boʻlishi bilan qurilmangizga tushadi va konspektga saqlanadi.

**Admin panel** (faqat administratorlar)
- *Umumiy* — foydalanuvchi soni, pullik obunalar, oylik daromad, token va
  kredit sarfi, modellar boʻyicha taqsimot
- *Odamlar* — qidiruv, reja berish (muddat bilan), kredit qoʻshish,
  bloklash, admin qilish
- *Rejalar* — narx, oylik kredit, kunlik chegara, fon limitlari va
  **har bir model uchun token narxi** (1M kirish / 1M chiqish / chaqiruv)
- *Soʻrovlar* — obuna soʻrovlarini tasdiqlash yoki rad etish
- *Sozlama* — gateway'ni toʻxtatish, roʻyxatni yopish, zaxira narx,
  admin pochtalari

Ishlash tartibi: obunachi soʻrovi `ai-gateway` edge funksiyasi orqali
oʻtadi — u rejani va kreditni tekshiradi, javob oqimini uzatib turib
tokenni sanaydi va kreditdan yechadi. Oʻz kalitini kiritganlar esa
avvalgidek toʻgʻridan-toʻgʻri Google'ga chiqadi (Sozlamalar → «AI qayerdan
ishlaydi»).

## APK ni olish

Har bir push'dan soʻng GitHub Actions APK yigʻadi:

1. Repozitoriyning **Actions** boʻlimiga kiring
2. Oxirgi **«APK yasash»** ishga tushishini oching
3. Pastdagi **Artifacts** dan `daho-apk` ni yuklab oling
4. ZIP ichidagi `daho.apk` ni telefonga koʻchiring va oʻrnating
   («Nomaʼlum manbalardan oʻrnatish» ruxsatini bering)

## Birinchi ishga tushirish

Ilova ochilganda Sozlamalar oynasi chiqadi. U yerga bepul Gemini API kalitini
kiriting:

1. https://aistudio.google.com/apikey ga kiring
2. Google hisobingiz bilan kiring va **Create API key** bosing
3. Kalitni nusxalab, ilovadagi «API kalit» maydoniga qoʻying

Kalit faqat telefoningizning xotirasida saqlanadi.

## Oʻzi yigʻib olish

```bash
npm install
npm run dev          # brauzerda sinash
npm run build        # veb qismini yigʻish
npx cap sync android # Android loyihasiga koʻchirish
cd android && ./gradlew assembleDebug
# natija: android/app/build/outputs/apk/debug/app-debug.apk
```

Kerak: Node.js 20+, JDK 17, Android SDK (compileSdk 34).

## Texnik tafsilotlar

- React 18 + TypeScript + Vite
- Capacitor 6 (Android), minSdk 23
- Gemini `streamGenerateContent` (SSE) + function calling
- Ovoz: `@capacitor-community/text-to-speech` va
  `@capacitor-community/speech-recognition` — qurilmaning oʻz xizmatlari
- Saqlash: `localStorage` (asosiy manba), zaxira nusxa JSON fayl sifatida
- Bulut: Supabase (Postgres + RLS + Auth + Edge Functions/Deno).
  Sinxronizatsiya elementma-element ishlaydi: har bir suhbat/konspekt/vazifa
  alohida satr, oxirgi yozgan qoladi. Maxfiy sozlamalar (API kalit, GitHub
  tokeni) hech qachon yuborilmaydi.
- PWA: `public/manifest.webmanifest` + `public/sw.js` (ilova qobigʻi keshi)

### Ovoz haqida eslatma

Oʻzbekcha nutq sintezi hamma telefonda ham oʻrnatilgan boʻlmaydi. Agar ovoz
chiqmasa, Play Store'dan **Google Text-to-Speech** ni yangilang yoki
Sozlamalardan boshqa tilni tanlang.
