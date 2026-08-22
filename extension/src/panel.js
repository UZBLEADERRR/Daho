import {
  account,
  limits,
  resetPassword,
  session,
  signIn,
  signOut,
  signUp,
} from './cloud.js';
/*
 * Panel — kengaytmaning yuzi.
 *
 * Ilovadagi Daho bilan bir xil tuzilish: yuqorida model tanlash, uchta
 * boʻlim (Suhbat, Kod, Vositalar), pastda yozish maydoni. Suhbat davom
 * etadi — har savol yangi boshlanmaydi.
 */

import { listModels, runAgent, savedCode, savedNotes, serverFetch, settings, tg }
  from './agent.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ */
/*  Boʻlimlar                                                          */
/* ------------------------------------------------------------------ */

const PANES = ['chat', 'code', 'tools', 'settings', 'setup'];
let current = 'chat';

function show(name) {
  current = name;
  for (const p of PANES) {
    const el = $(`pane-${p}`);
    if (el) el.hidden = p !== name;
  }
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  // Yozish maydoni faqat suhbatda kerak.
  $('composer-wrap').hidden = name !== 'chat';

  /*
   * Kirish ekranida boshqa hech narsa koʻrinmasin — ilovaning oʻzida
   * ham shunday: avval hisob, keyin qolgani.
   */
  const kirishda = name === 'setup';
  document.querySelector('.tabs').hidden = kirishda;
  $('model').hidden = kirishda;
  $('open-settings').hidden = kirishda;

  if (name === 'code') void renderCode();
  if (name === 'tools') void renderTools();
}

document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => show(b.dataset.tab));
});

$('open-settings').addEventListener('click', () => {
  show(current === 'settings' ? 'chat' : 'settings');
});

/* ------------------------------------------------------------------ */
/*  Suhbat                                                             */
/* ------------------------------------------------------------------ */

/** Xotiradagi suhbat — panel yopilsa ham saqlanadi. */
let thread = [];

async function loadThread() {
  const { thread: saved } = await chrome.storage.local.get('thread');
  thread = Array.isArray(saved) ? saved : [];
  renderThread();
}

async function saveThread() {
  // Uzoq suhbat panelni ogʻirlashtiradi va tokenni yeydi.
  await chrome.storage.local.set({ thread: thread.slice(-40) });
}

/** Juda sodda markdown — panel tor, ogʻir kutubxona shart emas. */
function md(text) {
  const blocks = String(text).split(/```/);
  return blocks
    .map((part, i) => {
      if (i % 2 === 1) {
        const body = part.replace(/^[\w-]*\n/, '');
        return `<pre>${esc(body)}</pre>`;
      }
      return esc(part)
        .replace(/^#{1,6} (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    })
    .join('');
}

function renderThread() {
  const box = $('thread');
  if (!thread.length) {
    box.innerHTML =
      '<div class="empty"><b>Salom! Men Daho.</b>'
      + 'Ochiq sahifani tahlil qilaman, qoʻllanma yozaman, kod tayyorlayman '
      + 'va Telegramga xabar yuboraman.</div>';
    return;
  }
  box.innerHTML = thread
    .map((m) =>
      m.role === 'user'
        ? `<div class="msg user">${esc(m.text)}</div>`
        : `<div class="msg ${m.error ? 'err' : 'bot'}">${m.error ? esc(m.text) : md(m.text)}</div>`,
    )
    .join('');
  box.lastElementChild?.scrollIntoView({ block: 'end' });
}

const STEP_LABEL = {
  read_page: 'sahifa oʻqilmoqda',
  open_tab: 'havola ochilmoqda',
  write_code: 'kod yozilmoqda',
  save_note: 'saqlanmoqda',
  server_status: 'server holati olinmoqda',
  http_get: 'maʼlumot olinmoqda',
  telegram: 'Telegram',
};

let busy = false;

async function ask(text) {
  if (busy || !text.trim()) return;
  const { apiKey } = await settings();
  if (!apiKey && !(await session())) return show('setup');

  busy = true;
  $('send').disabled = true;
  thread.push({ role: 'user', text });
  renderThread();
  $('ask').value = '';
  $('ask').style.height = 'auto';

  $('steps').hidden = false;
  $('step-text').textContent = 'oʻylanmoqda…';

  try {
    const answer = await runAgent(thread, {
      onStep: (name) => {
        $('step-text').textContent = STEP_LABEL[name] ?? name;
      },
      onSaved: () => {
        if (current === 'code') void renderCode();
        if (current === 'tools') void renderTools();
      },
    });
    thread.push({ role: 'model', text: answer || '(javob boʻsh)' });
  } catch (err) {
    thread.push({ role: 'model', text: String(err?.message ?? err), error: true });
  } finally {
    $('steps').hidden = true;
    busy = false;
    $('send').disabled = false;
    renderThread();
    await saveThread();
  }
}

$('send').addEventListener('click', () => void ask($('ask').value));

$('ask').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void ask($('ask').value);
  }
});

// Maydon matnga qarab oʻssin.
$('ask').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
});

/* ------------------------------------------------------- tez tugmalar */

const QUICK = [
  ['Qisqacha', 'Shu sahifadagi asosiy fikrlarni 5 ta band qilib ayt.'],
  ['Izohlar', 'Izohlarni tahlil qil: mavzular boʻyicha guruhla, nechtadan ekanini ayt, koʻp takrorlanadigan savollarni alohida koʻrsat.'],
  ['Qoʻllanma', 'Bu videodan toʻliq qoʻllanma yoz — bosqichma-bosqich, sarlavhalar bilan. Tayyor boʻlgach save_note bilan saqla.'],
  ['Javoblar', 'Izohlardagi savollarga javob matnlarini tayyorla. Har biriga alohida, ismini ishlatib. Tayyor boʻlgach save_note bilan saqla.'],
  ['Server holati', 'Daho serverida nima boʻlyapti? Holatni olib, tushunarli qilib ayt.'],
  ['Skript yoz', 'Shu sahifadagi maʼlumotni yigʻadigan kichik skript yoz.'],
];

$('quick').innerHTML = QUICK.map(
  ([label], i) => `<button data-i="${i}">${esc(label)}</button>`,
).join('');

$('quick').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => void ask(QUICK[Number(b.dataset.i)][1]));
});

/* ------------------------------------------------------------------ */
/*  Kod                                                                */
/* ------------------------------------------------------------------ */

async function renderCode() {
  const list = await savedCode();
  const box = $('code-list');

  if (!list.length) {
    box.innerHTML =
      '<div class="empty"><b>Hali kod yoʻq</b>'
      + 'Suhbatda kod soʻrang — tayyor fayl shu yerda paydo boʻladi.</div>';
    return;
  }

  box.innerHTML = list
    .map(
      (f, i) => `
      <div class="card" style="cursor:default">
        <b>${esc(f.filename)}</b>
        <i>${esc(f.note || f.language || '')} · ${String(f.content).split('\n').length} qator</i>
        <pre style="margin-top:8px;max-height:220px">${esc(String(f.content).slice(0, 4000))}</pre>
        <div class="row">
          <button class="btn" data-copy="${i}">Nusxa</button>
          <button class="btn" data-down="${i}">Yuklab olish</button>
        </div>
      </div>`,
    )
    .join('');

  box.querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(list[Number(b.dataset.copy)].content);
      b.textContent = 'Nusxalandi';
      setTimeout(() => (b.textContent = 'Nusxa'), 1500);
    });
  });

  box.querySelectorAll('[data-down]').forEach((b) => {
    b.addEventListener('click', () => {
      const f = list[Number(b.dataset.down)];
      const url = URL.createObjectURL(new Blob([f.content], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Vositalar                                                          */
/* ------------------------------------------------------------------ */

async function renderTools() {
  const notes = await savedNotes();
  $('notes').innerHTML = notes.length
    ? notes
        .map(
          (n, i) =>
            `<div class="card" data-note="${i}"><b>${esc(n.title)}</b>`
            + `<i>${new Date(n.at).toLocaleString()} · ${n.content.length} belgi</i></div>`,
        )
        .join('')
    : '<p class="hint">Hali saqlangan natija yoʻq.</p>';

  $('notes').querySelectorAll('[data-note]').forEach((el) => {
    el.addEventListener('click', () => {
      const n = notes[Number(el.dataset.note)];
      thread.push({ role: 'model', text: `### ${n.title}\n\n${n.content}` });
      renderThread();
      show('chat');
    });
  });
}

async function checkServer() {
  const dot = $('server-state').querySelector('.dot-ok');
  $('server-title').textContent = 'tekshirilmoqda…';
  try {
    const h = await serverFetch('/health');
    dot.classList.toggle('dot-off', !h.ok);
    $('server-title').textContent = h.ok ? 'ishlayapti' : 'sozlanmagan';
    $('server-sub').textContent = h.ok
      ? `bajarilgan: ${h.worker?.done ?? 0} · xato: ${h.worker?.failed ?? 0}`
        + ` · terminal: ${h.terminal?.active ?? 0}/${h.terminal?.max ?? 0}`
      : `yetishmayapti: ${(h.yetishmayapti ?? []).join(', ')}`;
  } catch (err) {
    dot.classList.add('dot-off');
    $('server-title').textContent = 'ulanmadi';
    $('server-sub').textContent = String(err?.message ?? err).slice(0, 140);
  }
}

async function checkTelegram() {
  const dot = $('tg-state').querySelector('.dot-ok');
  $('tg-title').textContent = 'tekshirilmoqda…';
  try {
    const me = await tg('getMe');
    dot.classList.remove('dot-off');
    $('tg-title').textContent = `@${me.username}`;
    $('tg-sub').textContent = 'bot ishlayapti — suhbatda «telegram» deb soʻrang';
  } catch (err) {
    dot.classList.add('dot-off');
    $('tg-title').textContent = 'ulanmadi';
    $('tg-sub').textContent = String(err?.message ?? err).slice(0, 140);
  }
}

$('server-check').addEventListener('click', () => void checkServer());
$('tg-check').addEventListener('click', () => void checkTelegram());

/* ------------------------------------------------------------------ */
/*  Modellar                                                           */
/* ------------------------------------------------------------------ */

async function fillModels() {
  const sel = $('model');
  const { model } = await settings();

  // Roʻyxat kelguncha tanlangan model koʻrinib tursin.
  sel.innerHTML = `<option value="${esc(model)}">${esc(model)}</option>`;

  try {
    const models = await listModels();
    if (!models.length) return;
    const has = models.some((m) => m.id === model);
    sel.innerHTML = (has ? models : [{ id: model, label: model }, ...models])
      .map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`)
      .join('');
    sel.value = model;
  } catch {
    // Kalit notoʻgʻri boʻlsa ham panel ishlayversin.
  }
}

$('model').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ model: e.target.value });
});

/* ------------------------------------------------------------------ */
/*  Sozlamalar                                                         */
/* ------------------------------------------------------------------ */

/*
 * Kirish va roʻyxatdan oʻtish.
 *
 * Hech qanday manzil yoki token soʻralmaydi: server manzili kengaytma
 * ichidagi `config.json` da, qolgan hammasi hisob orqali.
 */
let authMode = 'kirish';

document.querySelectorAll('#auth-mode button').forEach((button) => {
  button.addEventListener('click', () => {
    authMode = button.dataset.mode;
    document.querySelectorAll('#auth-mode button').forEach((b) => {
      b.classList.toggle('on', b === button);
    });
    $('name-field').hidden = authMode !== 'royxat';
    $('do-login').textContent = authMode === 'royxat' ? 'Hisob ochish' : 'Kirish';
    $('login-pass').autocomplete = authMode === 'royxat' ? 'new-password' : 'current-password';
    $('login-note').textContent = '';
  });
});

$('do-login').addEventListener('click', async () => {
  const note = $('login-note');
  const email = $('login-email').value.trim();
  const pass = $('login-pass').value;
  if (!email || !pass) {
    note.textContent = 'Pochta va parolni kiriting.';
    return;
  }

  note.textContent = authMode === 'royxat' ? 'Hisob ochilmoqda…' : 'Kirilmoqda…';
  try {
    if (authMode === 'royxat') {
      const done = await signUp(email, pass, $('login-name').value);
      if (!done) {
        note.textContent = 'Pochtangizga tasdiqlash xati yuborildi. Tasdiqlab, keyin kiring.';
        return;
      }
    } else {
      await signIn(email, pass);
    }
    note.textContent = '';
    await fillModels();
    await renderAccount();
    show('chat');
  } catch (err) {
    note.textContent = String(err?.message ?? err);
  }
});

$('do-reset').addEventListener('click', async () => {
  const note = $('login-note');
  const email = $('login-email').value.trim();
  if (!email) {
    note.textContent = 'Avval pochtangizni yozing.';
    return;
  }
  try {
    await resetPassword(email);
    note.textContent = 'Tiklash havolasi pochtangizga yuborildi.';
  } catch (err) {
    note.textContent = String(err?.message ?? err);
  }
});

/* Koʻrinish — ilovadagidek uch holat. */
document.querySelectorAll('#theme-seg button').forEach((button) => {
  button.addEventListener('click', async () => {
    const theme = button.dataset.theme;
    document.querySelectorAll('#theme-seg button').forEach((b) => {
      b.classList.toggle('on', b === button);
    });
    applyTheme(theme);
    await chrome.storage.local.set({ theme });
  });
});

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'tizim' || !theme) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

$('clear-chat').addEventListener('click', async () => {
  thread = [];
  await saveThread();
  renderThread();
  show('chat');
});

/**
 * Hisob holati.
 *
 * Token soni koʻrsatilmaydi — foydalanuvchi «haftalik limitning 64% i
 * qoldi» degan tushunarli raqamni koʻradi.
 */
async function renderAccount() {
  const box = $('account-bar');
  if (!box) return;

  const s = await session();
  if (!s) {
    box.hidden = true;
    return;
  }

  const [acc, win] = await Promise.all([account(), limits()]);
  const plan = acc?.plan?.name ?? 'Reja yoʻq';
  const windows = win
    ? [['soat', win.hour], ['kun', win.day], ['hafta', win.week], ['davr', win.period]]
        .filter(([, w]) => w && !w.unlimited)
    : [];
  const worst = windows.length
    ? windows.reduce((a, b) => (a[1].left_percent <= b[1].left_percent ? a : b))
    : null;

  box.hidden = false;
  box.textContent = '';
  const left = document.createElement('span');
  left.textContent = `${s.email} · ${plan}`;
  const right = document.createElement('span');
  right.className = worst && worst[1].left_percent <= 15 ? 'low' : '';
  right.textContent = worst ? `${worst[0]}: ${worst[1].left_percent}%` : 'limitsiz';
  box.append(left, right);
}

$('do-logout')?.addEventListener('click', async () => {
  await signOut();
  await renderAccount();
  show('setup');
});

async function fillSettings() {
  const { theme } = await chrome.storage.local.get('theme');
  applyTheme(theme ?? 'tizim');
  document.querySelectorAll('#theme-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === (theme ?? 'tizim'));
  });

  // Hisob kartasi — pochta va tarif.
  const s = await session();
  if (!s) return;
  try {
    const acc = await account();
    if (acc?.email) $('acc-email').textContent = acc.email;
    $('acc-plan').textContent = acc?.plan?.name
      ? `${acc.plan.name} tarifi`
      : 'tarif biriktirilmagan';
  } catch {
    $('acc-plan').textContent = 'hisob maʼlumoti olinmadi';
  }
}

/* ------------------------------------------------------------------ */

(async () => {
  const signedIn = Boolean(await session());
  await loadThread();
  await fillSettings();
  await fillModels();
  await renderAccount();
  show(signedIn ? 'chat' : 'setup');
})();
