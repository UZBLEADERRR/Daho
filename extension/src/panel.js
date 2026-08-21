/*
 * Panel — sahifadan yigʻilgan maʼlumotni modelga yuboradi.
 *
 * Kalit brauzerning oʻz omborida saqlanadi va hech qayerga yuborilmaydi;
 * soʻrov bevosita Google ga ketadi.
 */

import { runAgent, savedNotes } from './agent.js';

const $ = (id) => document.getElementById(id);

/* ---------- kalit ---------- */

async function getKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  return apiKey || '';
}

async function showSetup(show) {
  $('setup').hidden = !show;
  $('main').hidden = show;
}

$('save').addEventListener('click', async () => {
  const key = $('key').value.trim();
  if (!key) return;
  await chrome.storage.local.set({ apiKey: key });
  await showSetup(false);
});

$('settings').addEventListener('click', async () => {
  await showSetup($('setup').hidden);
});

/* ---------- sahifa ---------- */

async function showSource() {
  const res = await chrome.runtime.sendMessage({ type: 'daho:page' });
  $('source').textContent = res?.ok ? res.data.manba : 'ochilmadi';
}

/* ---------- chiqish ---------- */

function render(text) {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>');
  $('out').innerHTML = `<p>${html}</p>`;
}

async function showNotes() {
  const notes = await savedNotes();
  $('notes-wrap').hidden = notes.length === 0;
  $('notes').innerHTML = notes
    .map(
      (n, i) =>
        `<div class="note" data-i="${i}"><b>${n.title.replace(/</g, '&lt;')}</b>` +
        `<i>${new Date(n.at).toLocaleString()} · ${n.content.length} belgi</i></div>`,
    )
    .join('');

  $('notes').querySelectorAll('.note').forEach((el) => {
    el.addEventListener('click', async () => {
      const list = await savedNotes();
      render(list[Number(el.dataset.i)].content);
    });
  });
}

/* ---------- agent ---------- */

async function work(task) {
  const key = await getKey();
  if (!key) return showSetup(true);

  $('run').disabled = true;
  $('out').textContent = '';
  $('steps').textContent = 'boshlandi…';

  const labels = { read_page: 'sahifa oʻqilmoqda', open_tab: 'havola ochilmoqda', save_note: 'saqlanmoqda' };

  try {
    const text = await runAgent(task, key, (step) => {
      $('steps').textContent = labels[step] ?? step;
    });
    $('steps').textContent = '';
    render(text || '(javob boʻsh)');
    await showNotes();
  } catch (err) {
    $('steps').textContent = '';
    $('out').innerHTML = `<p class="err">${String(err?.message ?? err)}</p>`;
  } finally {
    $('run').disabled = false;
  }
}

/* ---------- hodisalar ---------- */

document.querySelectorAll('.quick button').forEach((btn) => {
  btn.addEventListener('click', () => void work(btn.dataset.ask));
});

$('run').addEventListener('click', () => {
  const q = $('ask').value.trim();
  if (q) void work(q);
});

$('ask').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('run').click();
});

(async () => {
  await showSetup(!(await getKey()));
  await showSource();
  await showNotes();
})();
