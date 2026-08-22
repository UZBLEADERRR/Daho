/*
 * Kengaytma ichidagi agent.
 *
 * Ilovadagi Daho bilan bir xil ishlaydi: topshiriq berasiz, u vositalarni
 * chaqirib ishni oxiriga yetkazadi. Farqi — bu yerda ochiq sahifa ham
 * vosita: agent siz koʻrib turgan narsani oʻqiy oladi.
 *
 * Haqiqiy yuborish ishlari (Instagram izohi, Direct, YouTube javobi)
 * ilovaning oʻzida qoladi — u yerda tarix, limit va hisobot bor.
 * Telegram bu yerda ham bor, chunki bot uchun bitta token yetarli.
 */

import { aiFetch, session } from './cloud.js';

const MAX_ROUNDS = 12;

/* ------------------------------------------------------------------ */
/*  Sozlamalar                                                         */
/* ------------------------------------------------------------------ */

export async function settings() {
  const s = await chrome.storage.local.get([
    'apiKey',
    'model',
    'serverUrl',
    'serverSecret',
    'tgToken',
  ]);
  return {
    apiKey: s.apiKey ?? '',
    model: s.model ?? 'gemini-flash-latest',
    serverUrl: (s.serverUrl ?? '').replace(/\/+$/, ''),
    serverSecret: s.serverSecret ?? '',
    tgToken: (s.tgToken ?? '').trim(),
  };
}

/* ------------------------------------------------------------------ */
/*  Vositalar                                                          */
/* ------------------------------------------------------------------ */

export const AGENT_TOOLS = [
  {
    name: 'read_page',
    description:
      'Hozir ochiq sahifadan maʼlumot oladi — YouTube (sarlavha, tavsif, '
      + 'SUBTITR matni va izohlar), Telegram (xabarlar), Instagram (post va '
      + 'izohlar) yoki oddiy matn. Sahifa haqida gap ketsa SHUNDAN boshla.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'open_tab',
    description:
      'Havolani yangi varaqda ochib undan maʼlumot oladi, keyin varaqni '
      + 'yopadi. Boshqa video yoki maqola kerak boʻlsa shu.',
    parameters: {
      type: 'OBJECT',
      properties: { url: { type: 'STRING', description: 'Toʻliq havola' } },
      required: ['url'],
    },
  },
  {
    name: 'write_code',
    description:
      'Kod yozadi va uni «Kod» boʻlimiga qoʻyadi — foydalanuvchi nusxalab '
      + 'yoki yuklab oladi. Skript, uslub, sozlama fayli — hammasi shu '
      + 'orqali. Kodni oddiy javob matnida bermaslikka harakat qil.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filename: { type: 'STRING', description: 'Masalan: script.py' },
        language: { type: 'STRING', description: 'python, javascript, sql…' },
        content: { type: 'STRING', description: 'Faylning toʻliq mazmuni' },
        note: { type: 'STRING', description: 'Bir jumlada: bu nima qiladi' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'save_note',
    description:
      'Tayyor matnni saqlaydi — qoʻllanma, tahlil, javob matnlari. '
      + '«Vositalar» boʻlimida turadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        content: { type: 'STRING', description: 'Markdown matn' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'server_status',
    description:
      'Daho serverining holatini oʻqiydi: sozlanganmi, fon ishchisi nima '
      + 'qilyapti, oxirgi xato nima, terminal band mi. «Serverda nima '
      + 'boʻlyapti», «loglarni koʻrsat» degan savolga shu javob beradi.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'http_get',
    description:
      'Ochiq havoladan matn yoki JSON oladi (faqat GET). API, RSS, '
      + 'holat sahifasi — shular uchun. Sahifani odam koʻrgandek oʻqish '
      + 'kerak boʻlsa `open_tab` yaxshiroq.',
    parameters: {
      type: 'OBJECT',
      properties: { url: { type: 'STRING' } },
      required: ['url'],
    },
  },
  {
    name: 'telegram',
    description:
      'Telegram boti orqali ishlaydi (token sozlamalarda).\n'
      + '- `me` — bot ishlayaptimi\n'
      + '- `updates` — yangi xabarlar va kim yozgani\n'
      + '- `send` — xabar yuborish (`chat_id`, `message`)\n'
      + 'Xabar yuborishdan oldin matnni koʻrsatib tasdiq ol.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'me | updates | send' },
        chat_id: { type: 'STRING' },
        message: { type: 'STRING' },
      },
      required: ['action'],
    },
  },
];

/* --------------------------------------------------------- bajarish */

async function collectCurrent() {
  const res = await chrome.runtime.sendMessage({ type: 'daho:page' });
  if (!res?.ok) throw new Error(res?.error ?? 'Sahifa oʻqilmadi');
  return res.data;
}

async function collectUrl(url) {
  const res = await chrome.runtime.sendMessage({ type: 'daho:open', url });
  if (!res?.ok) throw new Error(res?.error ?? 'Varaq ochilmadi');
  return res.data;
}

export async function savedNotes() {
  const { notes } = await chrome.storage.local.get('notes');
  return notes ?? [];
}

export async function savedCode() {
  const { code } = await chrome.storage.local.get('code');
  return code ?? [];
}

async function saveNote(title, content) {
  const notes = await savedNotes();
  const next = [{ title, content, at: Date.now() }, ...notes].slice(0, 30);
  await chrome.storage.local.set({ notes: next });
  return next.length;
}

async function saveCode(file) {
  const list = await savedCode();
  const next = [{ ...file, at: Date.now() }, ...list].slice(0, 30);
  await chrome.storage.local.set({ code: next });
  return next.length;
}

/** Daho serveriga soʻrov. */
export async function serverFetch(path, init = {}) {
  const { serverUrl, serverSecret } = await settings();
  if (!serverUrl) throw new Error('Server manzili kiritilmagan (Sozlamalar).');
  const res = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(serverSecret ? { 'x-worker-secret': serverSecret } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Server (${res.status}): ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { matn: text };
  }
}

/** Telegram Bot API. */
export async function tg(method, body) {
  const { tgToken } = await settings();
  if (!tgToken) throw new Error('Telegram tokeni kiritilmagan (Sozlamalar).');
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram: ${data.description ?? res.status}`);
  return data.result;
}

async function runTool(name, args, ui) {
  if (name === 'read_page') return { sahifa: await collectCurrent() };
  if (name === 'open_tab') return { sahifa: await collectUrl(args.url) };

  if (name === 'save_note') {
    const count = await saveNote(args.title, args.content);
    ui?.onSaved?.();
    return { saqlandi: args.title, jami: count };
  }

  if (name === 'write_code') {
    const count = await saveCode({
      filename: args.filename,
      language: args.language ?? '',
      content: args.content,
      note: args.note ?? '',
    });
    ui?.onSaved?.();
    return {
      yozildi: args.filename,
      qatorlar: String(args.content).split('\n').length,
      jami: count,
      izoh: '«Kod» boʻlimida turibdi.',
    };
  }

  if (name === 'server_status') {
    const health = await serverFetch('/health');
    return { holat: health };
  }

  if (name === 'http_get') {
    const url = String(args.url ?? '');
    if (!/^https?:\/\//.test(url)) return { xato: 'Faqat http(s) havola' };
    const res = await fetch(url);
    const text = await res.text();
    return { status: res.status, matn: text.slice(0, 8000) };
  }

  if (name === 'telegram') {
    if (args.action === 'me') return { bot: await tg('getMe') };
    if (args.action === 'updates') {
      const list = await tg('getUpdates', { limit: 50, timeout: 0 });
      return {
        xabarlar: list
          .map((u) => u.message ?? u.channel_post)
          .filter(Boolean)
          .map((m) => ({
            chat_id: m.chat.id,
            kim: m.from?.first_name ?? m.chat.title ?? '(nomaʼlum)',
            matn: m.text ?? m.caption ?? '',
            sana: new Date(m.date * 1000).toISOString(),
          })),
      };
    }
    if (args.action === 'send') {
      if (!args.chat_id || !args.message) return { xato: 'chat_id va message kerak' };
      const m = await tg('sendMessage', {
        chat_id: args.chat_id,
        text: String(args.message).slice(0, 4096),
      });
      return { yuborildi: true, message_id: m.message_id };
    }
    return { xato: `Nomaʼlum amal: ${args.action}` };
  }

  return { xato: `Nomaʼlum vosita: ${name}` };
}

/* ------------------------------------------------------------------ */

const SYSTEM = `Sen Daho — brauzerdagi yordamchisan. Foydalanuvchi ochib
turgan sahifa ustida ishlaysan, lekin undan tashqarisini ham qila olasan.

Qanday ishlaysan:
- Sahifa haqida gap ketsa ishni \`read_page\` bilan boshla.
- YOUTUBE. \`read_page\` videoning SUBTITRINI qaytaradi (\`subtitr.matn\`,
  har boʻlagi oldida [daqiqa:soniya]). Video mazmuni haqidagi savolga
  FAQAT shu matnga tayanib javob ber — sarlavha va izohlardan taxmin
  qilma. Javobda kerakli joyning vaqtini koʻrsat, masalan «[4:12] da».
  \`hozirgi_vaqt\` — foydalanuvchi hozir koʻrayotgan joy; «shu yerda nima
  dedi?» degan savolda shundan boshla.
  \`subtitr\` boʻsh boʻlsa — videoda subtitr yoʻqligini ochiq ayt va
  mazmunini oʻzingdan toʻqima.
- Topshiriqni OXIRIGACHA bajar. Yarim javob berma, «davom etaymi?» deb
  soʻrama — qilib, keyin natijani koʻrsat.
- Kod yozsang \`write_code\` bilan yoz, javob matniga tiqma.
- Uzun natija (qoʻllanma, tahlil, javob matnlari) \`save_note\` ga.
- Server haqida savol boʻlsa \`server_status\` ni chaqir, taxmin qilma.
- Javob oʻzbek tilida, markdown bilan. Qisqa va aniq — panel tor.

Xabar yuborishdan oldin (Telegram) matnni koʻrsat va tasdiq ol. Bu
haqiqiy odamlarga ketadi va orqaga qaytmaydi.

Izohlarga javob tayyorlashda har biriga ALOHIDA javob yoz, ismini
ishlat. Bir xil matnni koʻchirma — platformalar buni spam deb belgilaydi.

Narx, muddat, shaxsiy shart haqidagi savolga oʻzingdan javob berma —
«egasi aniqlaydi» deb qoldir.`;

/**
 * Agentni ishga tushiradi.
 *
 * @param {Array} history Oldingi xabarlar — suhbat davom etsin
 * @param {object} ui { onStep, onSaved }
 */
export async function runAgent(history, ui = {}) {
  const { apiKey, model } = await settings();
  // Hisobga kirilgan boʻlsa kalit shart emas — soʻrov server orqali oʻtadi.
  if (!apiKey && !(await session())) {
    throw new Error('Daho hisobingizga kiring yoki Sozlamalarda kalit kiriting.');
  }

  const contents = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  let answer = '';

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const res = await aiFetch(
      `/models/${model}:generateContent`,
      {
        contents,
        systemInstruction: { parts: [{ text: SYSTEM }] },
        tools: [{ functionDeclarations: AGENT_TOOLS }],
        generationConfig: { temperature: 0.6 },
      },
      apiKey,
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Xato ${res.status}`);

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('');
    if (text) answer = text;

    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    if (!calls.length) return answer;

    // Fikrlash imzosi bilan birga aynan qaytariladi — zanjir buzilmasin.
    contents.push({ role: 'model', parts });

    const responses = [];
    for (const call of calls) {
      ui.onStep?.(call.name, call.args ?? {});
      let result;
      try {
        result = await runTool(call.name, call.args ?? {}, ui);
      } catch (err) {
        result = { xato: String(err?.message ?? err) };
      }
      responses.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return answer || 'Qadamlar tugadi — vazifa juda katta boʻlishi mumkin.';
}

/* ------------------------------------------------------------------ */
/*  Modellar                                                           */
/* ------------------------------------------------------------------ */

/** Ishlatsa boʻladigan modellar — kalit bilan Google’dan olinadi. */
export async function listModels() {
  const { apiKey } = await settings();
  if (!apiKey) return [];

  const cached = await chrome.storage.local.get(['models', 'modelsAt']);
  // Roʻyxat kamdan-kam oʻzgaradi — bir kun keshda tursin.
  if (cached.models?.length && Date.now() - (cached.modelsAt ?? 0) < 86_400_000) {
    return cached.models;
  }

  const res = await fetch(`${API}/models?pageSize=200`, {
    headers: { 'x-goog-api-key': apiKey },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Xato ${res.status}`);

  const models = (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => ({
      id: String(m.name).replace(/^models\//, ''),
      label: m.displayName ?? String(m.name).replace(/^models\//, ''),
    }))
    // Eski avlodlarni koʻrsatmaymiz — roʻyxat uzun boʻlib ketadi.
    .filter((m) => !/gemini-1\.0|vision|embedding|aqa/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  await chrome.storage.local.set({ models, modelsAt: Date.now() });
  return models;
}
