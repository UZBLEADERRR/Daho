# Daho

Universitet uchun shaxsiy AI yordamchi va agent. Butunlay telefonda ishlaydi —
**hech qanday server yoʻq**. Barcha maʼlumot (suhbatlar, kitoblar, konspektlar,
jadval, vazifalar) faqat qurilmaning oʻzida saqlanadi; AI xizmatlariga ilova
toʻgʻridan-toʻgʻri murojaat qiladi.

Asosiy model — Gemini, lekin **Kimi, Qwen, DeepSeek, GPT va boshqalarni ham
ulash mumkin**: bittasi band boʻlsa Daho oʻzi ishlaydigan modelga oʻtadi.

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

**Koʻp model — istaganingizni yoqib, istaganingizni oʻchirasiz** 🔌
Sozlamalar → *AI modellar* boʻlimida OpenRouter, OpenAI, Kimi (Moonshot),
Qwen (DashScope), DeepSeek, Groq, Mistral, Together yoki **oʻz serveringizni**
ulaysiz (OpenAI-mos boʻlishi kifoya). Har bir provayder uchun kalit kiritasiz,
model roʻyxati oʻzi olinadi. Keraksiz modellarni bittalab oʻchirib qoʻyasiz —
ular tanlash roʻyxatlarida ham, zaxira model sifatida ham koʻrinmaydi.

*Rollar* — koʻp agentli ish uchun: bosh agent, dasturchi, dizayner,
tekshiruvchi va muharrir uchun alohida model tanlaysiz. Turli provayderdan
model qoʻysangiz, bittasining limiti tugaganda ish toʻxtamaydi.

**Uzluksiz ishlash — kuchsiz model ham vazifasini tugatadi** ♾️
Lite va kichik modellar uzun javobni oxirigacha yozolmaydi: `MAX_TOKENS` bilan
uzilib qoladi. Daho buni sezadi va **uzilgan joydan davom ettirib matnni ulab
ketadi** — siz buni sezmaysiz. Server band boʻlsa (429/503, «overloaded»)
kutib qayta uradi, ikki urinishdan keyin esa boshqa modelga oʻtadi. Nechta
marta davom ettirishni Sozlamalardan oʻzgartirasiz.

**Kitob yozish** 📚
«Kitob yozmoqchiman» deysiz — Daho avval **savol beradi** (janr, kim uchun,
ohang, necha bob, rasm kerakmi), keyin ishga tushadi:

1. **Izchillik hujjati** — qahramonlar (yoshi, koʻrinishi, xarakteri), muhit,
   atamalar, ohang va yagona vizual uslub bitta joyda qayd etiladi.
2. **Tuzilma** — boblar roʻyxati, har biriga qisqacha mazmun.
3. **Muqova** — kitob nomi va uslubiga mos rasm.
4. **Boblar** — bittalab yoziladi. Har bob yozilgach undan xulosa chiqarilib
   keyingisiga uzatiladi, shuning uchun **30-bobdagi qahramon 3-bobdagidan
   farq qilmaydi** va voqea uzilib qolmaydi.
5. **Rasmlar** — har bobga muqova bilan bir uslubdagi illyustratsiya.

Tayyor kitobni Word, PDF yoki matn qilib yuklab olasiz. Yoqmagan bobni
alohida qayta yozdirasiz. Yozish fonda ketadi — boshqa boʻlimga oʻtsangiz ham
davom etadi, ilova yopilib qolsa oʻsha joydan davom ettiriladi.

**Avtomatlashtirish — belgilangan vaqtda oʻzi bajaradi** 🔁
Agent → *Avto* boʻlimida topshiriqni **oʻzingiz yozasiz** («Bugungi eng muhim
yangiliklarni topib qisqacha yozib ber»), vaqtini va kunlarini belgilaysiz.
Soat kelganda topshiriq oʻzi bajariladi, natija suhbatga tushadi va
bildirishnoma keladi. Belgilangan vaqtda ilova yopiq boʻlsa — keyingi
ochilishda (12 soat ichida) bajariladi. Topshiriqni Code loyihasiga ham
yoʻnaltirsangiz boʻladi, har biriga alohida model tanlanadi.

**Jonli suhbat** 🎙
Yozish tugmasi yonidagi toʻlqin belgisini bosing: gapirasiz, **gapingiz
tugagach mikrofon oʻzi toʻxtaydi**, Daho ovoz bilan javob beradi va yana
tinglashga oʻtadi — telefonni quloqqa tutib suhbatlashasiz. Javoblar ovoz
uchun qisqa va sodda boʻladi.

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
- *Model tanlash* — har bir loyihaga alohida model (sarlavhadagi chip),
  barcha ulangan provayderlardan.
- *Skrinshot* — ikki tomonlama: siz xatoning suratini yuborasiz, agent esa
  **oʻz ishini rasmda koʻradi**. `screenshot` vositasi ilovani ishga tushirib
  suratga oladi va rasmni modelga qaytaradi — shunda u matn sigʻmaganini,
  tugma qiyshayganini yoki rang oʻqilmasligini oʻz koʻzi bilan koʻrib tuzatadi.
- *Oʻz ishini sinaydi* — `test_app` bilan loyihani telefonda haqiqatan ishga
  tushiradi: JS xatolarini, boʻsh sahifani, qaysi tugma va matn chiqqanini
  koʻradi. Xato boʻlsa oʻzi tuzatib qayta sinaydi. Bot va Node kodi esa
  GitHub Actions da ishga tushirilib, logi oʻqiladi.
- *GitHub Actions* — agent ish oqimi yozadi, ishga tushiradi va natijani kuzatadi.
  **APK shu yoʻl bilan yigʻiladi**: kod → push → run_workflow → tayyor fayl.

**Haqiqiy agentdek ishlaydi** 🤖
Katta topshiriq berilganda Daho Code kodga sakramaydi:

1. **Soʻraydi** — qaysi ekranlar, kim uchun, maʼlumot qayerda saqlanadi,
   koʻrinishi qanday boʻlsin. Javoblarni `save_spec` bilan yozib qoʻyadi va
   oxirigacha shunga amal qiladi. Kichik tuzatishda savol bermaydi.
2. **Reja tuzadi** — `plan_write` bilan 4-12 qadam. Reja ish maydonida
   belgilanadigan roʻyxat boʻlib turadi: nima bajarildi, nima qoldi.
3. **Boʻlib beradi** — `spawn_agent` bilan **yordamchi agentlar** chaqiradi:
   `kod` (mantiq va maʼlumot), `dizayn` (CSS, joylashuv — u skrinshot koʻrib
   ishlaydi), `tekshir` (xato qidiradi va tuzatadi), `matn` (yozuvlar).
   Har biri **oʻz modelida** ishlaydi va bosh agentga hisobot qaytaradi.
4. **Sinaydi** — har qadamdan keyin `test_app` (xato bormi) va `screenshot`
   (koʻrinishi qandayligi). Xato boʻlsa tuzatib qayta sinaydi.
5. **Toʻxtamaydi** — reja tugamasdan jim qolsa oʻziga turtki beradi va davom
   etadi. Qadamlar chegarasi 60 (Sozlamalardan 150 gacha).

Bilmagan narsasini `web_search` bilan qidiradi — taxmin qilib yozmaydi.
Arxitektura ham jiddiy: 4 ta fayl bilan cheklanmaydi, `css/`, `js/store.js`,
`js/ui.js`, `js/api.js` kabi tuzilma yasaydi va har fayl bitta ish qiladi.

**Savol berish va birga ishlash** 💬
Vaziyat noaniq boʻlsa agent taxmin qilmaydi — variantlar bilan savol beradi va
javobingizni kutadi. Yuqoridagi qatorda **necha soniyadan beri** ishlayotgani va
**hozir aynan nima qilayotgani** koʻrinib turadi. Ish ketayotganda qoʻshimcha
fikr yozsangiz — toʻxtatmasdan hisobga oladi va rejasini oʻzgartiradi.

**Fon rejimi va yoʻqolmaydigan holat** ⏳
Agent ishi boshqa boʻlimga oʻtganingizda ham davom etadi — pastda ingichka qatorda
nima bajarilayotgani koʻrinadi va uni istalgan joydan toʻxtatasiz. Ish davomida
ekran oʻchmaydi (Wake Lock). Ilova yopilib qolsa, ochilganda tugallanmagan ish
belgilanadi.

Qaysi boʻlim, qaysi kurs, qaysi kitob va qaysi loyiha ochiqligi ham saqlanadi:
tabni almashtirib qaytsangiz **hech narsa qaytadan boshlanmaydi**, ilovani
yopib qayta ochsangiz ham oʻsha joydan davom etasiz. Kurs darsi tayyorlanishi
ham fon vazifasi — boʻlim almashtirsangiz uzilmaydi.

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
- *Bugun* — kunlik xulosa: darslar, muddati kelgan vazifalar, ish vaqti,
  yozilayotgan kitob va bugungi avtomatik topshiriqlar
- *Kitoblar* — yozilgan va yozilayotgan kitoblar, muqovasi bilan
- *Avto* — belgilangan vaqtda oʻzi bajariladigan topshiriqlar
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

Ilova ochilganda Sozlamalar oynasi chiqadi. Ikki yoʻldan birini tanlang —
**bittasi kifoya**.

### A) OpenRouter bilan (bitta kalit, koʻp model)

1. https://openrouter.ai/keys ga kiring, kalit yasang (`sk-or-…`)
2. Ilovada Sozlamalar → **AI modellar** → «+ Model provayderi ulash» →
   **OpenRouter**
3. Kalitni qoʻyib, **«Model roʻyxatini olish»** ni bosing
4. Tamom — asosiy model oʻzi tanlanadi

Tavsiya qilinadigan modellar (vositalar bilan ishlaydi, yaʼni jadval yozish,
fayl yaratish va kod agenti uchun yaroqli):

| Model | Nima uchun |
|---|---|
| `moonshotai/kimi-k2` | uzun kontekst, kuchli agentlik |
| `qwen/qwen3-coder` | kod yozish |
| `deepseek/deepseek-chat` | narx/samaradorlik |
| `openai/gpt-4o-mini` | tez va barqaror |
| `google/gemini-2.5-flash-image` | **rasm** (muqova, illyustratsiya) |

> ⚠️ Vositalarni (function calling) qoʻllab-quvvatlamaydigan modellar bilan
> suhbat ishlaydi, lekin jadval yozish, kurs ochish, kitob va Code agenti
> ishlamaydi. Yuqoridagi roʻyxatdan tanlash xavfsiz.

### B) Gemini bilan

1. https://aistudio.google.com/apikey ga kiring
2. **Create API key** bosing
3. Kalitni «API kalit» maydoniga qoʻying

Gemini qoʻshimcha imkoniyat beradi: **internet qidiruvi**, **tabiiy ovoz**
(TTS) va **mikrofonni matnga oʻgirish**. OpenRouter bilan ishlaganda ovoz
telefonning oʻz xizmati orqali ketadi. Ikkalasini birga ulasangiz — eng
yaxshisi: Daho har vazifaga mos modelni oʻzi tanlaydi.

Kalitlar faqat telefoningizning xotirasida saqlanadi.

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
- Tashqi modellar: OpenAI-mos `chat/completions` (SSE). Ichkarida hamma narsa
  Gemini shaklida yuritiladi, `providers.ts` tarjima qiladi — shu sababli
  vositalar, rasmlar va koʻp agentli ish istalgan provayderda ishlaydi
- Skrinshot tashqi kutubxonasiz: DOM → SVG `foreignObject` → canvas → PNG
- Ovoz: `@capacitor-community/text-to-speech` va
  `@capacitor-community/speech-recognition` — qurilmaning oʻz xizmatlari
- Saqlash: `localStorage`, zaxira nusxa JSON fayl sifatida chiqariladi

### Ovoz haqida eslatma

Oʻzbekcha nutq sintezi hamma telefonda ham oʻrnatilgan boʻlmaydi. Agar ovoz
chiqmasa, Play Store'dan **Google Text-to-Speech** ni yangilang yoki
Sozlamalardan boshqa tilni tanlang.
