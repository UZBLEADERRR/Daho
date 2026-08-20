# Daho fon serveri.
# Terminal imkoniyati uchun git va python ham qoʻshiladi.
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 python3-pip ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV NODE_ENV=production
ENV WORK_DIR=/tmp/daho-work
EXPOSE 8080
CMD ["node", "src/index.js"]
