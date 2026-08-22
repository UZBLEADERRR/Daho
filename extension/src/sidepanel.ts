/**
 * Yon panel — kengaytmaning asosiy oynasi.
 *
 * Sahifa matnini kontekst sifatida oladi, javobni oqim bilan koʻrsatadi
 * va suhbatni bulutga yozadi — shu suhbat telefondagi ilovada ham
 * koʻrinadi.
 */

import {
  models,
  newId,
  quota,
  recentChats,
  saveChat,
  stream,
  type ChatTurn,
  type CloudChat,
  type Model,
} from './lib/api';
import { session, signIn } from './lib/auth';
import { server } from './lib/config';
import { currentPage, type PageInfo } from './lib/page';
import { $, el, renderMarkdown, tokenLabel } from './lib/ui';

const TASKS: Record<string, (page: PageInfo, selection: string) => string> = {
  qisqacha: (page) => `Quyidagi sahifani oʻzbek tilida qisqacha aytib ber. Asosiy fikrlarni roʻyxat qilib yoz.\n\nSahifa: ${page.title}`,
  tarjima: (_page, selection) => `Quyidagi matnni oʻzbek tiliga tabiiy qilib tarjima qil:\n\n${selection}`,
  tushuntir: (_page, selection) => `Quyidagi joyni sodda tilda tushuntir:\n\n${selection}`,
  savol: () => '',
};

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

let chatId = newId();
let history: Turn[] = [];
let page: PageInfo = { title: '', url: '', text: '', selection: '', words: 0 };
let model = '';
let modelList: Model[] = [];
let busy: AbortController | null = null;

/* ------------------------------------------------------------------ */
/*  Karkas                                                             */
/* ------------------------------------------------------------------ */

function header(): HTMLElement {
  const head = el('div', 'head');
  head.appendChild(el('div', 'mark', 'D'));
  const brand = el('div', 'brand grow');
  brand.append(document.createTextNode('Daho'), el('span', '', '.'));
  head.appendChild(brand);

  const past = el('button', 'chip', 'Tarix');
  past.onclick = () => void showHistory();
  head.appendChild(past);

  const fresh = el('button', 'chip', '+ Yangi');
  fresh.onclick = () => {
    chatId = newId();
    history = [];
    void draw();
  };
  head.appendChild(fresh);
  return head;
}

function contextRow(): HTMLElement {
  const ctx = el('div', 'ctx');
  ctx.appendChild(el('span', 'grow trunc', page.title || page.url || 'Sahifa'));
  if (page.selection) ctx.appendChild(el('span', 'chip', 'tanlov bor'));
  else if (page.words) ctx.appendChild(el('span', 'tiny', `${page.words} soʻz`));
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Suhbat                                                             */
/* ------------------------------------------------------------------ */

function threadView(): HTMLElement {
  const thread = el('div', 'thread');

  if (!history.length) {
    const empty = el('div', 'empty');
    empty.appendChild(
      el('div', '', 'Sahifa haqida soʻrang yoki pastdagi tugmalardan birini bosing.'),
    );
    thread.appendChild(empty);

    const suggest = el('div', 'suggest');
    for (const [id, label] of [
      ['qisqacha', 'Qisqacha aytib ber'],
      ['tushuntir', 'Tanlanganini tushuntir'],
      ['tarjima', 'Tarjima qil'],
    ] as const) {
      const button = el('button', '', label);
      button.onclick = () => void runTask(id);
      suggest.appendChild(button);
    }
    thread.appendChild(suggest);
    return thread;
  }

  for (const turn of history) {
    if (turn.role === 'user') {
      thread.appendChild(el('div', 'user', turn.text));
    } else {
      const answer = el('div', 'answer');
      renderMarkdown(answer, turn.text);
      thread.appendChild(answer);
    }
  }
  return thread;
}

function composer(): HTMLElement {
  const wrap = el('div', 'composer');

  const box = el('div', 'composer-box');
  const input = el('textarea', 'grow');
  input.rows = 1;
  input.placeholder = 'Sahifa boʻyicha savol…';
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  };

  const send = el('button', 'send', busy ? '■' : '↑');
  const fire = () => {
    if (busy) {
      busy.abort();
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    void ask(text);
  };
  send.onclick = fire;
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      fire();
    }
  };

  box.append(input, send);
  wrap.appendChild(box);

  const bar = el('div', 'bar');
  const picker = el('select');
  picker.style.width = 'auto';
  picker.style.flex = '1 1 auto';
  for (const m of modelList) {
    const option = el('option');
    option.value = m.slug;
    option.textContent = m.name;
    if (m.slug === model) option.selected = true;
    picker.appendChild(option);
  }
  picker.onchange = () => {
    model = picker.value;
    void chrome.storage.local.set({ model });
  };
  bar.appendChild(picker);
  wrap.appendChild(bar);

  return wrap;
}

async function draw(): Promise<void> {
  const root = $('#root');
  root.textContent = '';
  root.append(header(), contextRow(), threadView(), composer());
  const thread = root.querySelector('.thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}

/**
 * Bulutdagi suhbatlar.
 *
 * Telefonda yoki vebda boshlangan suhbatni shu yerdan davom ettirish
 * mumkin — sinxronlash aynan shu joyda koʻrinadi.
 */
async function showHistory(): Promise<void> {
  const root = $('#root');
  root.textContent = '';
  root.appendChild(header());

  const list = el('div', 'thread');
  list.appendChild(el('div', 'section', 'Barcha qurilmalardagi suhbatlar'));

  const chats = await recentChats().catch(() => [] as CloudChat[]);
  if (!chats.length) {
    list.appendChild(el('div', 'empty', 'Hali suhbat yoʻq.'));
  }

  for (const chat of chats) {
    const row = el('button', 'chat-row');
    row.appendChild(el('span', 'grow trunc', chat.title || 'Nomsiz suhbat'));
    row.appendChild(el('span', 'tiny', when(chat.updatedAt)));
    row.onclick = () => {
      chatId = chat.id;
      history = chat.messages
        .filter((m) => m.role === 'user' || m.role === 'model' || m.role === 'assistant')
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }) as Turn);
      void draw();
    };
    list.appendChild(row);
  }

  root.appendChild(list);

  const back = el('div', 'composer');
  const button = el('button', 'btn ghost wide', 'Orqaga');
  button.onclick = () => void draw();
  back.appendChild(button);
  root.appendChild(back);
}

function when(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'hozir';
  if (minutes < 60) return `${minutes} daq`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat`;
  return `${Math.round(hours / 24)} kun`;
}

/* ------------------------------------------------------------------ */
/*  Soʻrov yuborish                                                    */
/* ------------------------------------------------------------------ */

function buildMessages(question: string): ChatTurn[] {
  const context = page.selection
    ? `Foydalanuvchi shu joyni tanladi:\n"""${page.selection}"""`
    : page.text
      ? `Sahifa matni:\n"""${page.text.slice(0, 12_000)}"""`
      : '';

  const turns: ChatTurn[] = [
    {
      role: 'system',
      content:
        'Sen Daho — oʻzbek tilida javob beradigan yordamchisan. Qisqa, aniq va ' +
        'sodda yoz. Sahifa matni berilgan boʻlsa faqat shunga tayan, oʻzingdan ' +
        `toʻqima. Sahifa: ${page.title} (${page.url})`,
    },
  ];
  if (context) turns.push({ role: 'system', content: context });
  for (const turn of history) turns.push({ role: turn.role, content: turn.text });
  turns.push({ role: 'user', content: question });
  return turns;
}

async function ask(question: string): Promise<void> {
  if (busy) return;
  history.push({ role: 'user', text: question });
  history.push({ role: 'assistant', text: '' });
  await draw();

  const answer = $('#root').querySelector<HTMLElement>('.answer:last-of-type');
  busy = new AbortController();

  try {
    const full = await stream(
      model,
      buildMessages(question),
      (chunk) => {
        history[history.length - 1].text += chunk;
        if (answer) renderMarkdown(answer, history[history.length - 1].text);
        const thread = $('#root').querySelector('.thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
      },
      busy.signal,
    );
    history[history.length - 1].text = full;
  } catch (err) {
    const message = String((err as Error).message ?? err);
    history[history.length - 1].text =
      (err as Error).name === 'AbortError' ? '_Toʻxtatildi._' : `⚠ ${message}`;
  } finally {
    busy = null;
    await draw();
    void persist();
  }
}

async function runTask(task: string): Promise<void> {
  const prompt = TASKS[task]?.(page, page.selection);
  if (!prompt) return;
  if ((task === 'tarjima' || task === 'tushuntir') && !page.selection) {
    history.push({ role: 'assistant', text: 'Avval sahifadagi matnni belgilang.' });
    await draw();
    return;
  }
  await ask(prompt);
}

/** Suhbatni bulutga yozadi — ilovada ham koʻrinadi. */
async function persist(): Promise<void> {
  if (history.length < 2) return;
  const chat: CloudChat = {
    id: chatId,
    title: history[0]?.text.slice(0, 60) || page.title || 'Kengaytma suhbati',
    messages: history.map((t, i) => ({
      id: `${chatId}-${i}`,
      role: t.role === 'user' ? 'user' : 'model',
      text: t.text,
      createdAt: Date.now(),
    })),
    updatedAt: Date.now(),
  };
  await saveChat(chat).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/*  Kirish ekranlari                                                   */
/* ------------------------------------------------------------------ */

function renderSetup(): void {
  const root = $('#root');
  root.textContent = '';
  const wrap = el('div', 'auth');
  wrap.appendChild(el('div', 'mark', 'D'));
  wrap.appendChild(el('h1', '', 'Sozlash kerak'));
  wrap.appendChild(el('p', '', 'Kengaytma qaysi Daho serveriga ulanishini koʻrsating.'));
  const open = el('button', 'btn wide', 'Sozlash sahifasi');
  open.onclick = () => chrome.runtime.openOptionsPage();
  wrap.appendChild(open);
  root.appendChild(wrap);
}

function renderSignIn(): void {
  const root = $('#root');
  root.textContent = '';
  const wrap = el('div', 'auth');
  wrap.appendChild(el('div', 'mark', 'D'));
  wrap.appendChild(el('h1', '', 'Daho hisobiga kiring'));
  wrap.appendChild(el('p', '', 'Suhbatlaringiz telefon va veb bilan sinxron boʻladi.'));

  const emailField = el('label', 'field');
  emailField.appendChild(el('span', '', 'Email'));
  const email = el('input');
  email.type = 'email';
  emailField.appendChild(email);

  const passField = el('label', 'field');
  passField.appendChild(el('span', '', 'Parol'));
  const password = el('input');
  password.type = 'password';
  passField.appendChild(password);

  const error = el('div', 'tiny');
  error.style.color = 'var(--danger)';

  const submit = el('button', 'btn wide', 'Kirish');
  const go = async () => {
    error.textContent = '';
    submit.disabled = true;
    try {
      await signIn(email.value, password.value);
      await boot();
    } catch (err) {
      error.textContent = String((err as Error).message ?? err);
      submit.disabled = false;
    }
  };
  submit.onclick = () => void go();
  password.onkeydown = (e) => {
    if (e.key === 'Enter') void go();
  };

  wrap.append(emailField, passField, error, submit);
  root.appendChild(wrap);
  email.focus();
}

/* ------------------------------------------------------------------ */
/*  Ishga tushish                                                      */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  if (!(await server())) return renderSetup();
  if (!(await session())) return renderSignIn();

  page = await currentPage();

  try {
    modelList = await models();
  } catch {
    modelList = [];
  }
  const saved = await chrome.storage.local.get('model');
  model = modelList.some((m) => m.slug === saved.model)
    ? String(saved.model)
    : (modelList[0]?.slug ?? '');

  if (!modelList.length) {
    const root = $('#root');
    root.textContent = '';
    const wrap = el('div', 'auth');
    wrap.appendChild(el('h1', '', 'Model topilmadi'));
    wrap.appendChild(
      el('p', '', 'Tarifingizda ochiq model yoʻq yoki serverga ulanib boʻlmadi.'),
    );
    root.appendChild(wrap);
    return;
  }

  await draw();

  // Popup yoki oʻng tugma menyusi topshiriq qoldirgan boʻlsa — bajaramiz.
  const pending = (await chrome.storage.session.get('pending')).pending as
    | { task: string; selection: string }
    | undefined;
  if (pending?.task) {
    await chrome.storage.session.remove('pending');
    if (pending.selection) page.selection = pending.selection;
    if (pending.task.startsWith('savol:')) await ask(pending.task.slice(6));
    else await runTask(pending.task);
  }

  // Kvota tugab qolsa foydalanuvchi bilsin.
  const q = await quota();
  if (q && q.tokensLeft <= 0) {
    const warn = el('div', 'error', 'Oylik token chegarangiz tugadi. Ilovadagi «Tariflar» boʻlimiga qarang.');
    $('#root').insertBefore(warn, $('#root').children[2] ?? null);
  } else if (q) {
    const chip = document.querySelector('.head .chip');
    if (chip) chip.textContent = `${tokenLabel(q.tokensLeft)} · + Yangi`;
  }
}

// Varaq almashsa kontekstni yangilaymiz.
chrome.tabs.onActivated.addListener(() => {
  void currentPage().then((p) => {
    page = p;
    if (!history.length) void draw();
  });
});

void boot();
