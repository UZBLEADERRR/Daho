# ------------------------------------------------------------------
#  1-bosqich — veb ilovani yigʻamiz
# ------------------------------------------------------------------
# Shu sababli server nafaqat fon ishchisi, balki Daho’ning oʻzini ham
# beradi: Railway manzilini ochgan odam ilovani koʻradi, JSON emas.
FROM node:20-slim AS web
WORKDIR /build

# Kontekst — repozitoriy ildizi (railway.json: dockerfilePath=server/Dockerfile).
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ------------------------------------------------------------------
#  2-bosqich — server
# ------------------------------------------------------------------
# Terminal imkoniyati uchun git va python ham qoʻshiladi.
FROM node:20-slim

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

# Yigʻilgan veb ilova — Express shu papkadan beradi.
COPY --from=web /build/dist ./public

# Brauzer kengaytmasi — tayyor arxiv qilib qoʻyamiz, foydalanuvchi
# repozitoriyni klonlamasdan bitta havoladan yuklab oladi.
COPY extension ./extension
RUN cd extension && zip -qr ../public/daho-extension.zip . && cd .. && rm -rf extension

ENV NODE_ENV=production
ENV WORK_DIR=/tmp/daho-work
EXPOSE 8080
CMD ["node", "src/index.js"]
