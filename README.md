# Daho

Universitet uchun shaxsiy AI yordamchi va agent. Butunlay telefonda ishlaydi —
**hech qanday server yoʻq**. Barcha maʼlumot (suhbatlar, konspektlar, jadval,
vazifalar) faqat qurilmaning oʻzida saqlanadi, Gemini API ga esa ilova
toʻgʻridan-toʻgʻri murojaat qiladi.

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

**Hujjatlar**
Har qanday javobni **Word (.docx)**, **PDF**, **slayd (.pptx)** yoki matn
qilib yuklab olasiz — hammasi qurilmada yasaladi.

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
- Saqlash: `localStorage`, zaxira nusxa JSON fayl sifatida chiqariladi

### Ovoz haqida eslatma

Oʻzbekcha nutq sintezi hamma telefonda ham oʻrnatilgan boʻlmaydi. Agar ovoz
chiqmasa, Play Store'dan **Google Text-to-Speech** ni yangilang yoki
Sozlamalardan boshqa tilni tanlang.
