# Daho serveri

Telefon oʻchiq boʻlsa ham ishlaydigan fon ishchisi va Daho Code uchun
haqiqiy terminal.

## Nega kerak

Ilova brauzerda ishlaydi, shuning uchun oʻzi hech narsa qila olmaydi:
ilova yopilsa vazifa ham toʻxtaydi. Supabase Edge funksiyalari qisman
yordam beradi, lekin ular qisqa vaqtga moʻljallangan va ularni kimdir
turtib turishi kerak.

Bu server esa **doim ishlab turadi**:

- navbatni oʻzi tekshiradi (standart holda har 10 soniyada);
- uzun ishlarni oxiriga yetkazadi — masalan 12 bobli kitob;
- `npm`, `node`, `python3`, `git` ni ishlata oladi.

## Railway’da koʻtarish

1. [railway.app](https://railway.app) ga kiring → **New Project** →
   **Deploy from GitHub repo** → shu repozitoriyni tanlang.
2. Railway `railway.json` ni oʻqib, `server/Dockerfile` bilan yigʻadi.
   **Root Directory ni oʻzgartirmang** — u `/` boʻlib qolsin. Yigʻish
   konteksti repozitoriy ildizi, `Dockerfile` esa `server/` ichidan
   nusxa oladi. Root Directory `server` qilinsa yoʻllar buziladi.
   Tarmoq (branch) sifatida server kodi turgan tarmoqni tanlang.
3. **Variables** boʻlimiga quyidagilarni qoʻying:

| Oʻzgaruvchi | Nima |
|---|---|
| `SUPABASE_URL` | Supabase loyihangiz manzili |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` kaliti |
| `GEMINI_API_KEY` | Platforma kaliti (obunachilar shundan foydalanadi) |
| `WORKER_SECRET` | Oʻzingiz oʻylab topgan uzun maxfiy soʻz |
| `ENABLE_SHELL` | Terminal kerak boʻlsa `1` (pastdagi ogohlantirishni oʻqing) |
| `POLL_SECONDS` | Ixtiyoriy, standart `10` |
| `BATCH_SIZE` | Ixtiyoriy, standart `3` |

4. Deploy tugagach Railway bergan manzilni oling
   (`https://...up.railway.app`).
5. Ilovada: **Sozlamalar → Daho serveri** → manzil va `WORKER_SECRET` ni
   kiriting → **Ulanishni tekshirish**.

`service_role` kaliti RLS ni chetlab oʻtadi — uni faqat serverda saqlang,
ilovaga yoki repozitoriyga hech qachon qoʻymang.

## Manzillar

| Yoʻl | Nima qiladi |
|---|---|
| `GET /health` | Server holati, nima sozlanmagani, worker statistikasi |
| `POST /tick` | Navbatni darhol tekshirish (`x-worker-secret` kerak) |
| `POST /jobs` | Vazifa qoʻshish (foydalanuvchi tokeni bilan) |
| `GET /jobs/:id` | Vazifa holati |
| `POST /run` | Buyruq bajarish — terminal |

## Server nima uchun EMAS

Server arzon protsessorda turadi va ayni paytda fon vazifalarini ham
bajaradi. Shuning uchun **ogʻir kodlash unga tegishli emas**:

| Ish | Qayerda |
|---|---|
| Video yigʻish va kodlash | **Qurilmada** — telefonda apparat kodlovchi bor, bepul va tez |
| Rasm chizish, koʻrinish | Qurilmada |
| Fon vazifalari, uzun matn | Serverda |
| Kod bajarish, testlar | Serverda |

ffmpeg tasvirda bor, lekin yengil ish uchun: audio ajratish, format
haqida maʼlumot olish, kichik boʻlak kesish.

Ayni paytda koʻpi bilan 2 ta buyruq ishlaydi
(`MAX_PARALLEL_COMMANDS` bilan oʻzgartiriladi). Uchinchisi «server band»
javobini oladi — shunda fon vazifalari toʻxtab qolmaydi.

## Vosita yasab, ishga tushirish

Terminal yoqilgan boʻlsa agent kerakli vositani oʻzi yozib, oʻrnatib va
ishga tushirib, natijani qaytara oladi:

```
pip install --break-system-packages pandas matplotlib
python3 tahlil.py
```

Tasvirda ffmpeg oldindan bor. Qolgan kutubxonalar ish paytida
oʻrnatiladi — shuning uchun tasvir yengil qoladi.

Boshqa xizmatlardan material yuklab olishda oʻsha xizmat shartlariga
eʼtibor bering — bu sizning javobgarligingiz.

## Terminal haqida ogohlantirish

`ENABLE_SHELL=1` qoʻyilsa, `WORKER_SECRET` ni yoki yaroqli foydalanuvchi
tokenini bilgan har kim serverda **istalgan buyruqni** bajara oladi. Har
foydalanuvchiga alohida papka beriladi, vaqt chegarasi bor va maxfiy
kalitlar buyruq muhitiga oʻtmaydi — lekin bu toʻliq izolyatsiya emas.

Shuning uchun:

- terminal standart holda **oʻchiq**;
- `WORKER_SECRET` ni uzun va tasodifiy qiling;
- serverda boshqa muhim narsa saqlamang.

## Mahalliy sinash

```bash
cd server
npm install
WORKER_SECRET=sinov ENABLE_SHELL=1 PORT=8099 npm start

curl localhost:8099/health
curl -X POST localhost:8099/run \
  -H 'content-type: application/json' \
  -H 'x-worker-secret: sinov' \
  -d '{"command":"node -v"}'
```

## Google ulanishi (telefon uchun)

Telefondagi ilova `https://localhost` ichida ishlaydi va Google bunday
manzilga qaytara olmaydi. Shuning uchun server `/oauth/callback` ni ochib
beradi: Google kodni shu yerga qaytaradi, server esa uni
`uz.daho.app://oauth?code=…` deep link bilan ilovaga uzatadi.

Google Cloud Console → **Credentials** → OAuth client (**Web
application**) → **Authorized redirect URIs**:

| Qayerda ishlatasiz | Qaytish manzili |
|---|---|
| Telefon (APK) | `https://<sizniki>.up.railway.app/oauth/callback` |
| Veb versiya | sahifaning oʻz manzili (masalan GitHub Pages havolasi) |

Ikkalasini birdan qoʻshib qoʻysa ham boʻladi. Ilovada aynan qaysi manzil
kerakligi **Sozlamalar → Google hisobi** boʻlimida tayyor holda turadi —
uni koʻchirib qoʻying.

Kod serverda saqlanmaydi: PKCE tufayli u `code_verifier` siz foydasiz,
verifier esa faqat telefonning oʻzida turadi.

Deep link sxemasini oʻzgartirmoqchi boʻlsangiz `APP_DEEP_LINK`
oʻzgaruvchisini qoʻying (standart `uz.daho.app://oauth`) — u
`AndroidManifest.xml` dagi `android:scheme` bilan bir xil boʻlishi kerak.
