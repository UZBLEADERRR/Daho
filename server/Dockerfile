# Daho fon serveri.
# Terminal imkoniyati uchun git va python ham qoʻshiladi.
FROM node:20-slim

# ffmpeg — audio/video bilan ishlash uchun (keng qoʻllaniladi).
# Qolgan kutubxonalarni agent ish paytida oʻzi oʻrnatadi:
#   pip install --break-system-packages pandas matplotlib
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git python3 python3-pip python3-venv ffmpeg ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV NODE_ENV=production
ENV WORK_DIR=/tmp/daho-work
EXPOSE 8080
CMD ["node", "src/index.js"]
