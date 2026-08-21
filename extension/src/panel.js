/*
 * Panel — sahifadan yigʻilgan maʼlumotni modelga yuboradi.
 *
 * Kalit brauzerning oʻz omborida saqlanadi va hech qayerga yuborilmaydi;
 * soʻrov bevosita Google ga ketadi.
 */

const $ = (id) => document.getElementById(id);
const MODEL = 'gemini-flash-latest';

let pageData = null;

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

async function loadPage() {
  const res = await chrome.runtime.sendMessage({ type: 'daho:page' });
  if (!res?.ok) {
    $('source').textContent = 'ochilmadi';
    $('out').innerHTML = `<p class="err">${res?.error ?? 'Sahifa oʻqilmadi'}</p>`;
    return null;
  }
  pageData = res.data;
  $('source').textContent = pageData.manba;
  return pageData;
}

/* ---------- model ---------- */

function render(text) {
  // Oddiy markdown: sarlavha, roʻyxat, qalin matn.
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

async function analyze(question) {
  const key = await getKey();
  if (!key) return showSetup(true);

  if (!pageData) {
    const loaded = await loadPage();
    if (!loaded) return undefined;
  }

  $('run').disabled = true;
  $('out').textContent = 'Oʻqilmoqda…';

  const prompt =
    'Quyida foydalanuvchi ochib turgan sahifadan olingan maʼlumot bor. '
    + 'Savolga oʻzbek tilida, qisqa va aniq javob ber. Markdown ishlat.\n\n'
    + `Savol: ${question}\n\n`
    + `Sahifa maʼlumoti:\n${JSON.stringify(pageData, null, 1).slice(0, 60000)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6 },
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? `Xato ${res.status}`);

    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
      .trim();

    render(text || '(javob boʻsh)');
  } catch (err) {
    $('out').innerHTML = `<p class="err">${String(err?.message ?? err)}</p>`;
  } finally {
    $('run').disabled = false;
  }
}

/* ---------- hodisalar ---------- */

document.querySelectorAll('.quick button').forEach((btn) => {
  btn.addEventListener('click', () => void analyze(btn.dataset.ask));
});

$('run').addEventListener('click', () => {
  const q = $('ask').value.trim();
  if (q) void analyze(q);
});

$('ask').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('run').click();
});

(async () => {
  await showSetup(!(await getKey()));
  await loadPage();
})();
