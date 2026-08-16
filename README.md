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
- **Artifactlar**: AI yasagan HTML ilova, oʻyin, test, kalkulyator yoki
  diagramma darhol ilova ichida ochiladi va ishlaydi

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
