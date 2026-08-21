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
