import { drainInterjections } from './ask';
import { connectorCatalog } from './connectors';
import { isModelReadable } from './attach';
import { extractArtifacts } from './artifacts';
import { GeminiError } from './gemini';
import { learnFromChat, memoryBlock } from './memory';
import { completeAny } from './providers';
import { streamResilient } from './resilient';
import type { GeminiContent, GeminiPart } from './gemini';
import { getState, setState } from './store';
import { TOOL_DECLARATIONS, buildContextSummary, executeTool } from './tools';
import type { Artifact, Attachment, Chat, Message, ToolCallRecord } from './types';
import { uid } from './utils';

const MAX_HISTORY = 40;
/**
 * Bitta javob ichida nechta marta vosita chaqirib, natijasini koʻrib,
 * keyingi qadamni tanlash mumkin. Murakkab ish yarim yoʻlda toʻxtab qolmasin.
 */
const MAX_TOOL_ROUNDS = 24;

/** Vosita nomining foydalanuvchiga koʻrinadigan tavsifi. */
const STEP_LABEL: Record<string, string> = {
  ask_user: 'sizdan soʻrayapman',
  create_note: 'konspekt yozilmoqda',
  create_task: 'vazifa qoʻshilmoqda',
  add_schedule_item: 'jadvalga yozilmoqda',
  create_project: 'loyiha rejasi tuzilmoqda',
  create_course: 'kurs mavzulari tuzilmoqda',
  write_book: 'kitob yozish boshlanmoqda',
  search_images: 'internetdan rasm qidirilmoqda',
  generate_image: 'rasm chizilmoqda',
  get_location: 'joylashuvingiz aniqlanmoqda',
  find_place: 'xaritadan qidirilmoqda',
  search_web: 'internetdan qidirilmoqda',
  create_book: 'kitob rejasi tuzilmoqda',
  open_site: 'sayt ochilmoqda',
  find_video: 'video qidirilmoqda',
  read_video: 'video koʻrilmoqda va tarjima qilinmoqda',
  dub_video: 'ovozli tarjima tayyorlanmoqda',
  plan_route: 'yoʻl tayyorlanmoqda',
  illustrate_document: 'hujjatga rasm qoʻshilmoqda',
  log_work: 'ish vaqti yozilmoqda',
  complete_task: 'vazifa belgilanmoqda',
  read_data: 'maʼlumotlaringiz oʻqilmoqda',
};

/**
 * Ulangan ilovalar haqida model bilishi kerak: bor ulanishlar roʻyxati
 * prompt ga qoʻshiladi, aks holda model ular yoʻq deb oʻylaydi.
 */
function connectorBlock(): string {
  const catalog = connectorCatalog();
  if (!catalog) return '';
  return `
## Ulangan ilovalar 🔌
Foydalanuvchi quyidagi xizmatlarni ulab qoʻygan — ularga \`connect_app\` bilan
soʻrov yubora olasan:

${catalog}

Tashqi ish soʻralganda («telegramga tashla», «notionga yoz», «chiroqni yoq»)
oldin shu roʻyxatga qara. Kerakli ulanish yoʻq boʻlsa — Agent → Ulanishlar
boʻlimidan qoʻshishni ayt.`;
}

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

## Qanday fikrlaysan 🧠
Sen roʻyxat boʻyicha ishlaydigan robot emassan. Senga maqsad aytiladi —
unga qanday yetishni oʻzing hal qilasan.

- **Niyatni tushun, harfni emas.** Foydalanuvchi «shu mavzuni tushun­tir» desa,
  unga nima haqiqatan kerakligini oʻyla: taʼrifmi, misolmi, mashqmi, jadvalmi.
- **Ishni oxiriga yetkaz.** Yarim javob berma. Bir necha qadam kerak boʻlsa —
  ketma-ket bajar: qidir, oʻqi, yoz, tekshir. Har qadamdan keyin «davom
  etaymi?» deb soʻrab turma.
- **Oʻzing tekshir.** Vosita natijasi kutilganidek chiqmasa (boʻsh, xato,
  mos emas) — boshqa yoʻl bilan urin, keyin xabar ber. Bir marta urinib
  «boʻlmadi» deb qoʻyma.
- **Kerakli maʼlumotni oʻzing top.** Foydalanuvchidan soʻrashdan oldin
  \`read_data\`, \`search_web\`, \`get_location\` bilan bilib olishga harakat qil.
- **Mayda qarorlarni oʻzing qabul qil** (rang, nom, tartib, format) va nima
  tanlaganingni bir jumlada aytib qoʻy.
- **Vositalarni birlashtir.** Bitta savolga bir nechta vosita kerak boʻlishi
  mumkin: masalan avval qidir, keyin kitob boshla, soʻng vazifa qoʻsh.
- **Foydalanuvchi vaqtini tejaydigan qoʻshimchani oʻzing taklif qil** —
  lekin soʻralmagan ishni oʻzboshimchalik bilan qilma; bitta jumlada taklif qil.
${connectorBlock()}
## Uslub
- Har doim oʻzbek tilida (lotin yozuvi) javob ber, foydalanuvchi boshqa tilda yozmasa.
- Qisqa va aniq yoz. Suv quyma, ortiqcha muqaddima qilma.
- Markdown ishlat: sarlavha, roʻyxat, qalin matn, jadval.
- Matematika uchun oddiy belgilar ishlat (x², √, ∫, ≈), LaTeX emas.
- Bilmasang — "aniq bilmayman" deb ayt, oʻylab topma.
- Foydalanuvchi aniq nom aytsa (model, kutubxona, versiya) — AYNAN oʻshani ishlat,
  oʻzingdan boshqasiga almashtirma. Sening bilimlaring eskirgan boʻlishi mumkin.
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

## Artifact yaratish — FAQAT soʻralganda
Odatiy savolga oddiy matn bilan javob ber. HTML/kod bloki YOZMA, agar foydalanuvchi
aniq soʻramagan boʻlsa. Bu tokenni tejaydi va javobni tez qiladi.

Artifact faqat mana bunda yasaladi:
- foydalanuvchi «ilova yasab ber», «oʻyin qil», «kalkulyator», «test/quiz tuz»,
  «vizual koʻrsat», «interaktiv qil», «sayt yasa» kabi aniq soʻrov qilsa;
- kurs mavzusi ochilganda (dars artifacti soʻraladi);
- foydalanuvchi kod soʻrasa (masalan «Python kodini yoz»).

Shubha boʻlsa — yasama. Oʻrniga bir jumlada «Xohlasangiz shu mavzuni interaktiv
ilova qilib beraman» deb taklif qil va foydalanuvchi javobini kut.
Tushuntirish, taʼrif, misol, roʻyxat, taqqoslash, uy vazifasi — bularga artifact KERAK EMAS.

Soʻralganda esa javobingda \`\`\`html bloki ichida BITTA toʻliq, mustaqil ishlaydigan HTML fayl ber:
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
- KITOB yozish soʻralsa — \`write_book\`. Lekin avval \`ask_user\` bilan soʻra:
  nima haqida va qaysi turdagi kitob, kim uchun, necha bob, rasm kerakmi.
  Savollarni bittalab ber (har birida tayyor variantlar bilan), javoblarni
  toʻplab, keyin \`write_book\` ni bitta toʻliq tavsif bilan chaqir.
  Kitob matnini oʻzing chatda yozma — vosita fonda yozadi.
- Hujjatga (Word yoki PDF biriktirilgan boʻlsa) rasm qoʻshish soʻralsa —
  \`illustrate_document\`. Nechta rasm kerakligini foydalanuvchi aytmasa 5 ta qil.
  Natija yangi .docx boʻlib telefonga saqlanadi.
- HAQIQIY rasm kerak boʻlsa (joy, odam, hayvon, mahsulot, tarixiy voqea,
  «qanday koʻrinadi», «namuna koʻrsat», «ilhom uchun rasmlar») —
  \`search_images\` bilan internetdan top. Qidiruvni ingliz tilida yoz.
  Natijani manba havolasi bilan koʻrsat — bu muallif huquqi uchun muhim.
- Rasm YASASH soʻralsa (chizma, logotip, muqova, tasavvurdagi tasvir) — \`generate_image\`.
  Mavjud rasmni oʻzgartirishni soʻrasa — \`edit_last: "true"\` bilan chaqir.
  Rasm chatda oʻzi koʻrinadi; uni matn bilan qayta tasvirlab berma.
Vositani chaqirgach, natijani foydalanuvchiga bir jumlada tasdiqlab qoʻy.

## Jonli maʼlumot va yoʻl koʻrsatish 🗺️
- Sening bilimlaring eskirgan. Narx, jadval, avtobus/metro raqami, ish vaqti,
  ob-havo, yangilik, «hozir qanday» kabi savollarda TAXMIN QILMA —
  \`search_web\` bilan tekshir va topganingni yoz.
- «Qayerdaman», «yaqin atrofda nima bor» — \`get_location\`.
- «Falon joyga bormoqchiman», «qanday boraman» — \`plan_route\` chaqir.
  Undan keyin ALBATTA \`search_web\` bilan aynan yoʻlni top: qaysi metro liniyasi
  va bekati, qaysi avtobus raqami, qayerda almashish, taxminan qancha vaqt va
  narx. Javobni qisqa qadamlar bilan yoz:
  1) Eng yaqin bekatgacha piyoda — necha daqiqa
  2) Qaysi transport (raqami/liniyasi bilan) va necha bekat
  3) Almashish boʻlsa — qayerda
  4) Oxirgi piyoda qism
  Jonli xarita va «Xaritada ochish» tugmasi foydalanuvchiga oʻzi koʻrsatiladi —
  havolani matnda qayta yozma.
- Chet elda (masalan Koreya) boʻlsa joy nomini mahalliy tilda ham qidir —
  natija aniqroq chiqadi.

## Kitob va uzun matn 📖
Kitob, qoʻllanma yoki koʻp bobli katta material soʻralsa — uni chatda oʻzing
yozishga URINMA. Bitta javob chegarasi bor: matn oʻrtada uzilib qoladi va
boblar chala qolib ketadi. Buning oʻrniga \`create_book\` ni chaqir:
reja tuziladi, har bir bob alohida yoziladi va uzilib qolsa oʻzi davom ettiriladi.
Foydalanuvchi «falon bobni tuzat» desa — «Agent → Kitoblar» boʻlimida oʻsha
bobning «Tuzatish» tugmasi borligini ayt (faqat oʻsha bob qayta yoziladi).

## Saytlar 🌐
Ilovaning ichida brauzer bor. Foydalanuvchiga sayt kerak boʻlsa (rasmiy hujjat,
ariza, jadval, manba) — \`open_site\` bilan oʻzing ochib ber, havolani matnda
tashlab qoʻyma. Javobingdagi oddiy havolalar ham bosilganda shu brauzerda
ochiladi.

## Video 🎬
- «Video topib ber», «buni videoda koʻrsat» — \`find_video\`. Topilgan havolalarni
  javobingda yoz: ular chatda pleyer boʻlib chiqadi va foydalanuvchi shu yerda koʻradi.
- «Bu videoda nima deyilyapti», «tarjima qil», «subtitr qilib ber» — \`read_video\`.
  Video boshqa tilda boʻlsa ham boʻladi: model videoni oʻzi koʻradi va tarjima qiladi.
  Foydalanuvchi subtitr FAYLI soʻrasa \`format: "srt"\` bilan chaqir.
- «Ovozini oʻzbekchaga oʻgir», «oʻqib ber» — \`dub_video\`. Bitta ovozli fayl yasaladi
  (mazmunan mos, har soniyaga tushirilgan dublyaj emas — buni aytib qoʻy).
- Video YUKLAB OLISH (YouTube, Instagram) — bunday imkoniyat yoʻq: bu platformalar
  shartlariga zid. Buni bir jumlada, uzr soʻramasdan tushuntir va oʻrniga nima
  qila olishingni ayt: chatda koʻrish, tarjima, subtitr fayli, ovozli tarjima,
  qisqacha mazmun. Havolani «Ilovalarim» ga saqlab qoʻyish ham mumkin.

## Savol berish
Vaziyat noaniq boʻlsa — taxmin qilma, \`ask_user\` bilan soʻra va variantlar ber:
- bir nechta yoʻl bor va tanlov natijani jiddiy oʻzgartiradi
- muhim maʼlumot yetishmayapti (daraja, muddat, format, hajm)
- oʻchirish yoki almashtirish kabi qaytarib boʻlmaydigan ish
Lekin mayda narsa uchun soʻrama — rang, nom, tartib kabi ikkinchi darajali
qarorlarni oʻzing qabul qil va nima tanlaganingni aytib qoʻy.

## Ishni aytib qilish
Har bir vositani chaqirishdan OLDIN bir qisqa jumlada nima qilayotganingni yoz
(«Jadvalingizni tekshiraman», «Konspekt yozib qoʻyaman»). Foydalanuvchi nima
sodir boʻlayotganini koʻrib tursin.

${memoryBlock()}

## Kontekst
${buildContextSummary()}

${getState().settings.customInstructions ? `## Foydalanuvchining qoʻshimcha koʻrsatmalari\n${getState().settings.customInstructions}` : ''}`.trim();
}

/** Yasalgan rasm/fayllarni galereyaga qoʻshadi va xabar roʻyxatiga yigʻadi. */
function addMedia(store: Artifact[], made: Artifact[]): void {
  if (!made.length) return;
  store.push(...made);
  setState((s) => ({ artifacts: [...made, ...s.artifacts] }));
}

function toContents(messages: Message[]): GeminiContent[] {
  const recent = messages.slice(-MAX_HISTORY);
  const out: GeminiContent[] = [];
  for (const msg of recent) {
    if (msg.error && !msg.text) continue;
    const parts: GeminiPart[] = [];
    for (const att of msg.attachments ?? []) {
      // Modelga faqat u oʻqiy oladigan turlarni yuboramiz (docx bizda qoladi).
      if (!isModelReadable(att.mimeType)) continue;
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
    // `completeAny` — model qaysi provayderniki boʻlsa oʻshanga boradi.
    const title = await completeAny(
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
  onStep?: (step: string) => void,
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
  /** Vositalar va model oqimidan kelgan rasm artifactlari */
  const media: Artifact[] = [];
  /** Vosita ochgan yoʻl kartasi */
  let routeId: string | undefined;
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
      const result = await streamResilient({
        apiKey: settings.apiKey,
        model: settings.model,
        contents,
        systemInstruction: instruction,
        tools: TOOL_DECLARATIONS,
        temperature: settings.temperature,
        signal,
        onText,
        rollback: (chars) => {
          accumulated = accumulated.slice(0, Math.max(0, accumulated.length - chars));
          patchMessage(chatId, modelMsg.id, { text: accumulated });
        },
        onStep,
        allowModelSwap: true,
      });

      // Model javobida rasm boʻlsa — darhol chatda koʻrsatamiz.
      if (result.images.length) {
        addMedia(
          media,
          result.images.map((img, i) => ({
            id: uid('a_'),
            kind: 'image' as const,
            title: text.slice(0, 40) || `Rasm ${i + 1}`,
            content: img.data,
            mimeType: img.mimeType,
            chatId,
            createdAt: Date.now(),
          })),
        );
        patchMessage(chatId, modelMsg.id, { artifactIds: media.map((a) => a.id) });
      }

      if (!result.functionCalls.length) {
        // Vosita chaqirilmasa ham foydalanuvchi qoʻshimcha aytgan boʻlishi mumkin.
        const extra = drainInterjections('chat', chatId);
        if (!extra.length) break;
        contents.push({ role: 'model', parts: result.parts });
        contents.push({
          role: 'user',
          parts: [{ text: `Foydalanuvchi qoʻshimcha aytdi:\n${extra.join('\n')}` }],
        });
        onStep?.('qoʻshimcha koʻrsatma hisobga olinmoqda');
        continue;
      }

      // Model qismlarini AYNAN qaytaramiz — fikrlash imzolari yoʻqolmasligi kerak.
      contents.push({ role: 'model', parts: result.parts });

      const responseParts: GeminiPart[] = [];
      for (const call of result.functionCalls) {
        onStep?.(STEP_LABEL[call.name] ?? call.name);
        const outcome = await executeTool(call.name, call.args, { chatId, signal });
        toolCalls.push({
          name: call.name,
          args: call.args,
          ok: outcome.ok,
          summary: outcome.summary,
          at: accumulated.length,
        });
        if (outcome.artifacts?.length) {
          addMedia(media, outcome.artifacts);
          patchMessage(chatId, modelMsg.id, { artifactIds: media.map((a) => a.id) });
        }
        // Yoʻl kartasi darhol chatda koʻrinsin.
        if (outcome.route) {
          routeId = outcome.route;
          patchMessage(chatId, modelMsg.id, { routeId });
        }
        responseParts.push({
          functionResponse: { name: call.name, response: outcome.payload },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
      patchMessage(chatId, modelMsg.id, { toolCalls: [...toolCalls] });

      // Ish davomida kelgan qoʻshimcha fikrni keyingi qadamga qoʻshamiz.
      const extra = drainInterjections('chat', chatId);
      if (extra.length) {
        contents.push({
          role: 'user',
          parts: [{ text: `Foydalanuvchi qoʻshimcha aytdi:\n${extra.join('\n')}` }],
        });
        onStep?.('qoʻshimcha koʻrsatma hisobga olinmoqda');
      }
    }

    if (flushTimer) clearTimeout(flushTimer);

    const artifacts = extractArtifacts(accumulated, chatId);
    if (artifacts.length) {
      setState((s) => ({ artifacts: [...artifacts, ...s.artifacts] }));
    }

    // Rasmlar oldinda, kod artifactlari matndagi tartibida.
    const ids = [...media, ...artifacts].map((a) => a.id);
    patchMessage(chatId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      artifactIds: ids.length ? ids : undefined,
      routeId,
    });

    void autoTitle(chatId, text);
    // Suhbatdan doimiy faktlarni jimgina eslab qolamiz (xato boʻlsa eʼtiborsiz).
    void learnFromChat(chatId);
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
      artifactIds: media.length ? media.map((a) => a.id) : undefined,
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
