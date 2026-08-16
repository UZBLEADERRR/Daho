import { extractArtifacts } from './artifacts';
import { GeminiError, streamGenerate, generateText } from './gemini';
import type { GeminiContent, GeminiPart } from './gemini';
import { getState, setState } from './store';
import { TOOL_DECLARATIONS, buildContextSummary, executeTool } from './tools';
import type { Attachment, Chat, Message, ToolCallRecord } from './types';
import { uid } from './utils';

const MAX_HISTORY = 40;
const MAX_TOOL_ROUNDS = 5;

function systemPrompt(): string {
  const { settings } = getState();
  const who = [
    settings.userName && `Foydalanuvchi ismi: ${settings.userName}.`,
    settings.university && `Oʻqish joyi: ${settings.university}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return `Sen — "Daho", oʻzbek tilida gaplashadigan shaxsiy oʻquv yordamchisi va agentsan. Foydalanuvchi universitet talabasi.

${who}

## Vazifang
1. Fanlarni tushuntirish: murakkab mavzuni sodda, bosqichma-bosqich, misollar bilan yoritasan. Formulalarni izohlaysan, xatolarni koʻrsatasan.
2. Rejalashtirish: dars jadvali, vazifalar, loyihalar va ish vaqtini boshqarasan — buning uchun senda vositalar bor.
3. Yaratish: soʻralganda toʻliq ishlaydigan ilova, kalkulyator, test/quiz, jadval, diagramma,
   hujjat yoki video yasab berasan.
4. Oʻrgatish: foydalanuvchi biror sohani oʻrganmoqchi boʻlsa, unga mavzular roʻyxatidan iborat
   kurs ochib berasan va har bir mavzuni interaktiv darsga aylantirasan.

## Uslub
- Har doim oʻzbek tilida (lotin yozuvi) javob ber, foydalanuvchi boshqa tilda yozmasa.
- Qisqa va aniq yoz. Suv quyma, ortiqcha muqaddima qilma.
- Markdown ishlat: sarlavha, roʻyxat, qalin matn, jadval.
- Matematika uchun oddiy belgilar ishlat (x², √, ∫, ≈), LaTeX emas.
- Bilmasang — "aniq bilmayman" deb ayt, oʻylab topma.
- Boʻlim sarlavhalariga mos emoji qoʻy (📌 muhim, ✅ toʻgʻri, ❌ xato, 💡 maslahat,
  ⚠️ ehtiyot boʻling, 🎯 maqsad). Har jumlaga emas — sarlavha va roʻyxat boshiga.
- Taqqoslash, bosqichlar, xususiyatlar — markdown JADVAL koʻrinishida ber.

## Grafiklar
Javobda sonlar boʻlsa (statistika, taqqoslash, ulush, dinamika, natija) — ularni
\`\`\`chart bloki bilan chizib koʻrsat. Ichida faqat JSON boʻlsin:

\`\`\`chart
{"type":"ustun","title":"Haftalik oʻqish","unit":"soat",
 "labels":["Du","Se","Cho","Pay","Ju"],
 "series":[{"name":"Soat","values":[2,3.5,1,4,2.5]}]}
\`\`\`

Turlari:
- "ustun" — miqdorlarni taqqoslash (eng koʻp ishlatiladigan)
- "gorizontal" — nomlari uzun boʻlsa (fanlar, mamlakatlar)
- "chiziq" — vaqt boʻyicha oʻzgarish
- "doira" — butunning ulushlari, 6 tadan koʻp boʻlmasin
- "raqam" — 2-4 ta asosiy koʻrsatkich; "icons" bilan emoji qoʻshsang boʻladi

Qoidalar: bir grafikda 8 tadan ortiq seriya boʻlmasin; foizlar yigʻindisi 100 boʻlsin;
"unit" ni har doim yoz; grafik oldidan bir jumlada nima koʻrsatilayotganini ayt.
Grafik faqat haqiqiy sonlar boʻlganda chizilsin — bezak uchun emas.

## Artifact yaratish
Foydalanuvchi ilova, oʻyin, kalkulyator, test, vizualizatsiya yoki diagramma soʻrasa — javobingda \`\`\`html bloki ichida BITTA toʻliq, mustaqil ishlaydigan HTML fayl ber:
- Barcha CSS va JavaScript shu faylning oʻzida boʻlsin (tashqi CDN, tashqi shrift, tashqi rasm ISHLATMA — ular ishlamaydi).
- Telefon ekraniga moslashgan boʻlsin, tugmalar yirik, barmoq bilan bosishga qulay.
- Interfeys matni oʻzbekcha boʻlsin.
- Qorongʻi fon va yorugʻ matn afzal.
Faylning eng boshiga shu qatorni qoʻsh:
<!-- daho:app name="Ilova nomi" icon="🧮" desc="qisqa tavsif" -->

Bunday blok avtomatik ravishda "artifact" boʻlib saqlanadi va foydalanuvchi uni ilova ichida
darhol ochib ishlata oladi hamda «Ilovalarim» boʻlimiga qoʻsha oladi.
Blokdan oldin bir-ikki jumlada nima yasaganingni ayt.

Katta ilova soʻralsa avval qisqa reja yoz (nomi, boʻlimlari, saqlanadigan maʼlumot),
keyin kodni ber. Kodni maydalab, funksiyalarga ajratib yoz va har bir qismini izohla.

Boshqa dasturlash tillaridagi kod ham \`\`\`til bloklarida beriladi va artifact sifatida saqlanadi.

## Vositalar
Senda foydalanuvchi maʼlumotlarini oʻqish va yozish vositalari bor. Ularni jimgina, soʻramasdan ishlat:
- Foydalanuvchi dars jadvalini aytsa — darhol \`add_schedule_item\` bilan yoz (har bir dars uchun alohida chaqir).
- Deadline yoki uy vazifasi haqida gapirsa — \`create_task\`.
- Biror mavzuni tushuntirsang va u foydali boʻlsa yoki foydalanuvchi "saqla" desa — \`create_note\`.
- Katta ish (kurs ishi, diplom, loyiha) haqida gapirsa — \`create_project\` bilan bosqichli reja tuz.
- "Bugun nima qildim", "nechchi soat ishladim", "jadvalimda nima bor" kabi savollarda — avval \`read_data\` bilan tekshir, keyin javob ber.
- Bajarilgan ish haqida aytsa — \`log_work\`.
- Biror sohani oʻrganmoqchi boʻlsa (IELTS, dasturlash, ingliz tili…) — \`create_course\` bilan
  kamida 40 ta mavzudan iborat toʻliq kurs och.
Vositani chaqirgach, natijani foydalanuvchiga bir jumlada tasdiqlab qoʻy.

## Kontekst
${buildContextSummary()}

${getState().settings.customInstructions ? `## Foydalanuvchining qoʻshimcha koʻrsatmalari\n${getState().settings.customInstructions}` : ''}`.trim();
}

function toContents(messages: Message[]): GeminiContent[] {
  const recent = messages.slice(-MAX_HISTORY);
  const out: GeminiContent[] = [];
  for (const msg of recent) {
    if (msg.error && !msg.text) continue;
    const parts: GeminiPart[] = [];
    for (const att of msg.attachments ?? []) {
      parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
    }
    if (msg.text.trim()) parts.push({ text: msg.text });
    if (!parts.length) continue;
    out.push({ role: msg.role, parts });
  }
  // Gemini birinchi xabar 'user' rolida bo'lishini talab qiladi.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function patchChat(chatId: string, fn: (chat: Chat) => Chat): void {
  setState((s) => ({
    chats: s.chats.map((c) => (c.id === chatId ? fn(c) : c)),
  }));
}

function patchMessage(chatId: string, messageId: string, patch: Partial<Message>): void {
  patchChat(chatId, (chat) => ({
    ...chat,
    updatedAt: Date.now(),
    messages: chat.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  }));
}

export function createChat(title = 'Yangi suhbat'): string {
  const chat: Chat = {
    id: uid('c_'),
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  setState((s) => ({ chats: [chat, ...s.chats], activeChatId: chat.id }));
  return chat.id;
}

export function ensureActiveChat(): string {
  const s = getState();
  const existing = s.chats.find((c) => c.id === s.activeChatId);
  if (existing) return existing.id;
  if (s.chats.length) {
    setState({ activeChatId: s.chats[0].id });
    return s.chats[0].id;
  }
  return createChat();
}

export function deleteChat(chatId: string): void {
  setState((s) => {
    const chats = s.chats.filter((c) => c.id !== chatId);
    return {
      chats,
      activeChatId: s.activeChatId === chatId ? (chats[0]?.id ?? null) : s.activeChatId,
      artifacts: s.artifacts.filter((a) => a.chatId !== chatId || a.pinned),
    };
  });
}

/** Suhbatning birinchi javobidan keyin unga nom beradi. */
async function autoTitle(chatId: string, firstUserText: string): Promise<void> {
  const { settings } = getState();
  const chat = getState().chats.find((c) => c.id === chatId);
  if (!chat || chat.title !== 'Yangi suhbat') return;
  const fallback = firstUserText.slice(0, 38).trim() || 'Suhbat';
  patchChat(chatId, (c) => ({ ...c, title: fallback }));
  try {
    const title = await generateText(
      settings.apiKey,
      settings.model,
      `Quyidagi savol uchun 2-4 soʻzdan iborat oʻzbekcha sarlavha yoz. Faqat sarlavhani qaytar, tirnoqsiz:\n\n${firstUserText.slice(0, 400)}`,
    );
    const clean = title.replace(/["'*.]/g, '').split('\n')[0].trim();
    if (clean && clean.length <= 60) patchChat(chatId, (c) => ({ ...c, title: clean }));
  } catch {
    /* sarlavha muhim emas — jim o'tamiz */
  }
}

export interface SendResult {
  ok: boolean;
  text: string;
}

/**
 * Foydalanuvchi xabarini yuboradi, javobni oqim tarzida yozib boradi,
 * model soʻragan vositalarni bajaradi va artifactlarni saqlaydi.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  attachments: Attachment[] = [],
  signal?: AbortSignal,
  brief?: string,
): Promise<SendResult> {
  const { settings } = getState();

  const userMsg: Message = {
    id: uid('m_'),
    role: 'user',
    text,
    attachments: attachments.length ? attachments : undefined,
    createdAt: Date.now(),
  };
  const modelMsg: Message = {
    id: uid('m_'),
    role: 'model',
    text: '',
    createdAt: Date.now(),
  };

  patchChat(chatId, (chat) => ({
    ...chat,
    updatedAt: Date.now(),
    messages: [...chat.messages, userMsg, modelMsg],
  }));

  const chat = getState().chats.find((c) => c.id === chatId);
  const contents = toContents(
    (chat?.messages ?? []).filter((m) => m.id !== modelMsg.id),
  );

  const toolCalls: ToolCallRecord[] = [];
  let accumulated = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    patchMessage(chatId, modelMsg.id, { text: accumulated });
  };
  const onText = (chunk: string) => {
    accumulated += chunk;
    if (!flushTimer) flushTimer = setTimeout(flush, 60);
  };

  try {
    const instruction = brief ? `${systemPrompt()}\n\n## Ushbu soʻrov uchun maxsus vazifa\n${brief}` : systemPrompt();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await streamGenerate({
        apiKey: settings.apiKey,
        model: settings.model,
        contents,
        systemInstruction: instruction,
        tools: TOOL_DECLARATIONS,
        temperature: settings.temperature,
        signal,
        onText,
      });

      if (!result.functionCalls.length) break;

      contents.push({
        role: 'model',
        parts: result.functionCalls.map((fc) => ({ functionCall: fc })),
      });

      const responseParts: GeminiPart[] = [];
      for (const call of result.functionCalls) {
        const outcome = executeTool(call.name, call.args);
        toolCalls.push({
          name: call.name,
          args: call.args,
          ok: outcome.ok,
          summary: outcome.summary,
        });
        responseParts.push({
          functionResponse: { name: call.name, response: outcome.payload },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
      patchMessage(chatId, modelMsg.id, { toolCalls: [...toolCalls] });
    }

    if (flushTimer) clearTimeout(flushTimer);

    const artifacts = extractArtifacts(accumulated, chatId);
    if (artifacts.length) {
      setState((s) => ({ artifacts: [...artifacts, ...s.artifacts] }));
    }

    patchMessage(chatId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      artifactIds: artifacts.length ? artifacts.map((a) => a.id) : undefined,
    });

    void autoTitle(chatId, text);
    return { ok: true, text: accumulated };
  } catch (err) {
    if (flushTimer) clearTimeout(flushTimer);
    const aborted = (err as Error)?.name === 'AbortError';
    const message = aborted
      ? 'Toʻxtatildi.'
      : err instanceof GeminiError
        ? err.message
        : String((err as Error)?.message ?? err);

    patchMessage(chatId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      error: message,
    });
    return { ok: false, text: accumulated };
  }
}

/** Oxirgi model javobini o'chirib, savolni qayta yuboradi. */
export async function regenerate(chatId: string, signal?: AbortSignal): Promise<SendResult> {
  const chat = getState().chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, text: '' };

  const messages = [...chat.messages];
  while (messages.length && messages[messages.length - 1].role === 'model') messages.pop();
  const last = messages.pop();
  if (!last) return { ok: false, text: '' };

  patchChat(chatId, (c) => ({ ...c, messages }));
  return sendMessage(chatId, last.text, last.attachments ?? [], signal);
}
