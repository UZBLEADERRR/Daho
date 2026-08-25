# ------------------------------------------------------------------
#  1-bosqich — veb ilovani yigʻamiz
# ------------------------------------------------------------------
# Shu sababli server nafaqat fon ishchisi, balki Daho’ning oʻzini ham
# beradi: Railway manzilini ochgan odam ilovani koʻradi, JSON emas.
FROM node:22-slim AS web
WORKDIR /build

# Kontekst — repozitoriy ildizi (railway.json: dockerfilePath=server/Dockerfile).
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public

# Bulut (roʻyxatdan oʻtish, obuna, sinxronizatsiya) build vaqtida
# yoqiladi: Vite `import.meta.env` ni kodga singdiradi. Railway xizmat
# oʻzgaruvchilarini build argument sifatida uzatadi — shu ikkitasi
# boʻlmasa ilova avvalgidek faqat qurilmada ishlaydi.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build \
  && node -e "console.log('[daho] bulut:', process.env.VITE_SUPABASE_URL ? 'yoqilgan' : 'oʻchiq')"

# ------------------------------------------------------------------
#  2-bosqich — server
# ------------------------------------------------------------------
# Terminal imkoniyati uchun git va python ham qoʻshiladi.
# Node 22: @supabase/supabase-js Realtime mijozi uchun NATIV WebSocket kerak.
# Node 20 da u yaratilishdayoq yiqilar va serverning hamma chaqiruvi
# «Supabase'ga ulanib bo'lmadi» bo'lib qaytardi.
FROM node:22-slim

# ffmpeg — audio/video bilan ishlash uchun (keng qoʻllaniladi).
# Qolgan kutubxonalarni agent ish paytida oʻzi oʻrnatadi:
#   pip install --break-system-packages pandas matplotlib
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git python3 python3-pip python3-venv ffmpeg ca-certificates curl unzip zip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/src ./src

# Baza sxemasi — server koʻtarilganda oʻzi tekshirib quyadi.
COPY supabase/setup.sql ./sql/setup.sql

# Yigʻilgan veb ilova — Express shu papkadan beradi.
COPY --from=web /build/dist ./public

# Brauzer kengaytmasi — tayyor arxiv qilib qoʻyamiz, foydalanuvchi
# repozitoriyni klonlamasdan bitta havoladan yuklab oladi.
# `pack.mjs` manifestni Doʻkon talablari boʻyicha tekshiradi va arxivga
# faqat kerakli fayllarni qoʻyadi (pack.mjs va README tushmaydi). Manifest
# buzuq boʻlsa build shu yerda toʻxtaydi — buzuq arxiv tarqalmasin.
# Server oʻz domenini biladi — kengaytmaga singdiramiz, shunda
# foydalanuvchi manzilni qoʻlda yozmaydi.
ARG DAHO_SERVER_URL=""
ENV DAHO_SERVER_URL=$DAHO_SERVER_URL

COPY extension ./extension
RUN node extension/pack.mjs && rm -rf extension

ENV NODE_ENV=production
ENV WORK_DIR=/tmp/daho-work
EXPOSE 8080
CMD ["node", "src/index.js"]
