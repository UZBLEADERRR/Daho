import type { CodeFile } from './types';

export interface ProjectTemplate {
  id: string;
  name: string;
  icon: string;
  hint: string;
  /** Agentga qanday loyiha ekanini tushuntiruvchi qoʻshimcha koʻrsatma */
  brief: string;
  files: CodeFile[];
}

const STATIC_FILES: CodeFile[] = [
  {
    path: 'index.html',
    content: `<!doctype html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Yangi loyiha</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <h1>Salom, dunyo!</h1>
    <p>Bu Daho Code’da yaratilgan loyiha.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  },
  {
    path: 'style.css',
    content: `:root { color-scheme: dark; }

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #0e0e12;
  color: #ededf0;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

h1 { font-size: 28px; letter-spacing: -0.02em; }
`,
  },
  { path: 'app.js', content: "console.log('Loyiha ishga tushdi');\n" },
];

/* ---------- Android APK (Capacitor) ---------- */

const APK_WORKFLOW = `name: APK yasash

on:
  push:
    branches: ['**']
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: android-actions/setup-android@v3

      - name: Paketlar
        run: npm install

      - name: Veb qismini yigʻish
        run: npm run build

      - name: Android loyihasini tayyorlash
        run: |
          npx cap add android || true
          npx cap sync android

      - name: APK yigʻish
        working-directory: android
        run: |
          chmod +x gradlew
          ./gradlew assembleDebug --no-daemon

      - name: APK ni yuklash
        uses: actions/upload-artifact@v4
        with:
          name: apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
          if-no-files-found: error
`;

const APK_FILES: CodeFile[] = [
  ...STATIC_FILES.map((f) => ({ ...f, path: f.path === 'index.html' ? 'index.html' : f.path })),
  {
    path: 'package.json',
    content: `{
  "name": "daho-ilova",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "build": "node build.js"
  },
  "dependencies": {
    "@capacitor/android": "^6.2.0",
    "@capacitor/core": "^6.2.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.2.0"
  }
}
`,
  },
  {
    path: 'build.js',
    content: `// Statik fayllarni "dist" papkaga koʻchiradi — Capacitor shu yerdan oladi.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

for (const file of ['index.html', 'style.css', 'app.js']) {
  cpSync(file, \`dist/\${file}\`);
}
console.log('dist tayyor');
`,
  },
  {
    path: 'capacitor.config.json',
    content: `{
  "appId": "uz.daho.ilova",
  "appName": "Ilova",
  "webDir": "dist"
}
`,
  },
  { path: '.github/workflows/apk.yml', content: APK_WORKFLOW },
];

/* ---------- Telegram bot ---------- */

const BOT_WORKFLOW = `name: Telegram bot

on:
  schedule:
    - cron: '*/5 * * * *'   # har 5 daqiqada yangi xabarlarni oladi
  workflow_dispatch:

permissions:
  contents: write

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Xabarlarni qayta ishlash
        env:
          BOT_TOKEN: \${{ secrets.BOT_TOKEN }}
        run: node bot.js

      - name: Holatni saqlash
        run: |
          git config user.name "daho-bot"
          git config user.email "bot@users.noreply.github.com"
          git add state.json
          git diff --staged --quiet || git commit -m "bot holati"
          git push
`;

const BOT_FILES: CodeFile[] = [
  {
    path: 'bot.js',
    content: `// Telegram bot — GitHub Actions har 5 daqiqada ishga tushiradi.
// BOT_TOKEN repozitoriy Secrets'ida saqlanadi.
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('BOT_TOKEN yoʻq — repo Settings > Secrets ga qoʻshing');
  process.exit(1);
}

const API = \`https://api.telegram.org/bot\${TOKEN}\`;

function loadState() {
  try {
    return JSON.parse(readFileSync('state.json', 'utf8'));
  } catch {
    return { offset: 0 };
  }
}

async function send(chatId, text) {
  await fetch(\`\${API}/sendMessage\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

/** Bitta xabarga javob matnini tayyorlaydi. */
function reply(text) {
  const t = (text || '').trim().toLowerCase();
  if (t === '/start') return 'Salom! Men Daho Code yasagan botman. /yordam deb yozing.';
  if (t === '/yordam') return 'Buyruqlar:\\n/start — boshlash\\n/vaqt — hozirgi vaqt';
  if (t === '/vaqt') return 'Hozir: ' + new Date().toLocaleString('uz-UZ');
  return 'Tushunmadim. /yordam deb yozing.';
}

const state = loadState();
const res = await fetch(\`\${API}/getUpdates?offset=\${state.offset}&timeout=0\`);
const data = await res.json();

for (const update of data.result ?? []) {
  state.offset = update.update_id + 1;
  const message = update.message;
  if (!message?.chat?.id) continue;
  await send(message.chat.id, reply(message.text));
}

writeFileSync('state.json', JSON.stringify(state, null, 2));
console.log('Qayta ishlandi:', (data.result ?? []).length, 'ta yangilanish');
`,
  },
  { path: 'state.json', content: '{\n  "offset": 0\n}\n' },
  {
    path: 'package.json',
    content: `{
  "name": "daho-telegram-bot",
  "private": true,
  "type": "module",
  "version": "1.0.0"
}
`,
  },
  { path: '.github/workflows/bot.yml', content: BOT_WORKFLOW },
  {
    path: 'README.md',
    content: `# Telegram bot

## Ishga tushirish
1. @BotFather'dan token oling.
2. Bu repozitoriyda: Settings → Secrets and variables → Actions → New secret
   nomi \`BOT_TOKEN\`, qiymati — tokeningiz.
3. Actions boʻlimida ish oqimini yoqing.

Bot har 5 daqiqada yangi xabarlarni oladi va javob beradi.
Darhol javob berish uchun doimiy server kerak — bu variant bepul, lekin kechikadi.
`,
  },
];

/* ---------- Fullstack (frontend + API) ---------- */

const FULLSTACK_FILES: CodeFile[] = [
  ...STATIC_FILES,
  {
    path: 'api/server.js',
    content: `// Oddiy backend — Node'ning oʻz http moduli, tashqi kutubxonasiz.
// Telefonda ishlamaydi; serverda yoki GitHub Codespaces'da ishga tushiriladi.
import { createServer } from 'node:http';

const PORT = process.env.PORT || 3000;
const items = [];

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();

  if (req.url === '/api/items' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(items));
  }

  if (req.url === '/api/items' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const item = JSON.parse(body);
      items.push({ id: items.length + 1, ...item });
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(items.at(-1)));
    } catch {
      res.statusCode = 400;
      return res.end('{"error":"notoʻgʻri JSON"}');
    }
  }

  res.statusCode = 404;
  res.end('{"error":"topilmadi"}');
});

server.listen(PORT, () => console.log('API ishlayapti:', PORT));
`,
  },
  {
    path: 'package.json',
    content: `{
  "name": "daho-fullstack",
  "private": true,
  "type": "module",
  "version": "1.0.0",
  "scripts": {
    "start": "node api/server.js"
  }
}
`,
  },
  {
    path: 'README.md',
    content: `# Fullstack loyiha

- \`index.html\`, \`style.css\`, \`app.js\` — frontend. GitHub Pages'da bepul turadi.
- \`api/server.js\` — backend. Uni ishlatish uchun server kerak
  (Render, Fly.io, Railway yoki oʻz VPS'ingiz). Telefonda ishlamaydi.

Frontend'da API manzilini oʻzgartiring, soʻng «Nashr» tugmasini bosing.
`,
  },
];

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'statik',
    name: 'Veb sayt',
    icon: '🌐',
    hint: 'HTML + CSS + JS. Telefonda ishlaydi, havola beriladi.',
    brief:
      'Bu statik veb loyiha. Faqat HTML, CSS va JS ishlat. GitHub Pages orqali chiqariladi.',
    files: STATIC_FILES,
  },
  {
    id: 'apk',
    name: 'Android ilova (APK)',
    icon: '📱',
    hint: 'GitHub Actions APK yigʻib beradi.',
    brief:
      'Bu Capacitor asosidagi Android loyihasi. Veb qismini (index.html, style.css, app.js) ' +
      'yozasan; APK ni GitHub Actions yigʻadi. `.github/workflows/apk.yml` allaqachon bor. ' +
      'Foydalanuvchi "APK yasab ber" desa: kodni yoz → github_push → run_workflow("apk.yml") → ' +
      'check_workflow bilan kuzat va tayyor boʻlgach havolani ber.',
    files: APK_FILES,
  },
  {
    id: 'bot',
    name: 'Telegram bot',
    icon: '🤖',
    hint: 'Actions har 5 daqiqada xabarlarni oladi.',
    brief:
      'Bu Telegram bot loyihasi. Mantiq `bot.js` faylining `reply()` funksiyasida. ' +
      'Bot GitHub Actions cron orqali har 5 daqiqada `getUpdates` qiladi — bepul, lekin ' +
      'javob darhol emas. Foydalanuvchiga BOT_TOKEN ni repo Secrets ga qoʻshishni eslat.',
    files: BOT_FILES,
  },
  {
    id: 'fullstack',
    name: 'Fullstack',
    icon: '🧱',
    hint: 'Frontend + Node API kodi.',
    brief:
      'Bu fullstack loyiha: frontend statik fayllar, backend `api/server.js`. ' +
      'Backend telefonda ishlamaydi — uni tashqi hostda ishga tushirish kerakligini ' +
      'foydalanuvchiga ayt. Frontend GitHub Pages orqali chiqariladi.',
    files: FULLSTACK_FILES,
  },
];

export function templateById(id: string): ProjectTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
