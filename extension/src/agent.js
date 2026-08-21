/*
 * Kengaytma ichidagi agent.
 *
 * Paneldagi tugmalar faqat «savol berib javob olish» edi. Bu esa haqiqiy
 * agent: sahifadan maʼlumot oladi, kerak boʻlsa vositalarni chaqiradi va
 * ishni oxiriga yetkazadi.
 *
 * Vositalar ataylab kam: kengaytma sahifani oʻqiydi va matn tayyorlaydi,
 * haqiqiy yuborish ishlarini (Instagram izohiga javob, Direct) ilovaning
 * oʻzi rasmiy API orqali bajaradi — u yerda cheklovlar ham, tarix ham bor.
 */

const MODEL = 'gemini-flash-latest';
const MAX_ROUNDS = 8;

export const AGENT_TOOLS = [
  {
    name: 'read_page',
    description:
      'Hozir ochiq sahifadan maʼlumot oladi — YouTube (sarlavha, tavsif, '
      + 'izohlar), Telegram (xabarlar), Instagram (post va izohlar) yoki '
      + 'oddiy matn. Ishni SHUNDAN boshla.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'open_tab',
    description: 'Yangi varaqda havolani ochadi va undan maʼlumot oladi.',
    parameters: {
      type: 'OBJECT',
      properties: { url: { type: 'STRING', description: 'Toʻliq havola' } },
      required: ['url'],
    },
  },
  {
    name: 'save_note',
    description:
      'Tayyor natijani saqlaydi — qoʻllanma, xulosa, javob matnlari. '
      + 'Foydalanuvchi keyin nusxalab oladi yoki yuklab oladi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        content: { type: 'STRING', description: 'Markdown matn' },
      },
      required: ['title', 'content'],
    },
  },
];

/* ------------------------------------------------------------------ */

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

/** Saqlangan natijalar — panel koʻrsatadi. */
export async function savedNotes() {
  const { notes } = await chrome.storage.local.get('notes');
  return notes ?? [];
}

async function saveNote(title, content) {
  const notes = await savedNotes();
  const next = [{ title, content, at: Date.now() }, ...notes].slice(0, 30);
  await chrome.storage.local.set({ notes: next });
  return next.length;
}

async function runTool(name, args) {
  if (name === 'read_page') return { sahifa: await collectCurrent() };
  if (name === 'open_tab') return { sahifa: await collectUrl(args.url) };
  if (name === 'save_note') {
    const count = await saveNote(args.title, args.content);
    return { saqlandi: args.title, jami: count };
  }
  return { xato: `Nomaʼlum vosita: ${name}` };
}

/* ------------------------------------------------------------------ */

const SYSTEM = `Sen Daho — brauzerdagi yordamchisan. Foydalanuvchi ochib
turgan sahifa ustida ishlaysan.

Qanday ishlaysan:
- Ishni \`read_page\` bilan boshla — nima ochiq turganini koʻr.
- Topshiriqni OXIRIGACHA bajar. Yarim javob berma, «davom etaymi?» deb
  soʻrama.
- Uzun natija (qoʻllanma, tahlil, javob matnlari) tayyor boʻlsa
  \`save_note\` bilan saqla — foydalanuvchi keyin nusxalab oladi.
- Javob oʻzbek tilida, markdown bilan. Qisqa va aniq.

Izohlarga javob tayyorlashda: har biriga ALOHIDA javob yoz, ismini
ishlat, savoliga mos boʻlsin. Bir xil matnni koʻchirma.

Narx, muddat, shaxsiy shart haqidagi savolga oʻzingdan javob berma —
«egasi aniqlaydi» deb qoldir.`;

/**
 * Agentni ishga tushiradi.
 * @param {string} task Foydalanuvchi topshirigʻi
 * @param {(step: string) => void} onStep Nima qilinayotgani
 */
export async function runAgent(task, apiKey, onStep) {
  const contents = [{ role: 'user', parts: [{ text: task }] }];
  let answer = '';

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM }] },
          tools: [{ functionDeclarations: AGENT_TOOLS }],
          generationConfig: { temperature: 0.6 },
        }),
      },
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

    // Fikrlash imzosi bilan birga aynan qaytariladi.
    contents.push({ role: 'model', parts });

    const responses = [];
    for (const call of calls) {
      onStep?.(call.name);
      let result;
      try {
        result = await runTool(call.name, call.args ?? {});
      } catch (err) {
        result = { xato: String(err?.message ?? err) };
      }
      responses.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return answer || 'Qadamlar tugadi — vazifa juda katta boʻlishi mumkin.';
}
