/*
 * Fon xizmati — panelni ochadi va sahifa maʼlumotini oladi.
 */

/*
 * Panelni ochish.
 *
 * `sidePanel.open()` faqat foydalanuvchi harakati ichida ishlaydi va
 * baʼzan jimgina yiqiladi, shuning uchun belgini bosishni Chrome’ning
 * oʻziga topshiramiz — bu eng ishonchli yoʻl. Yon panel yoʻq brauzerda
 * (Chrome 114 dan eski, baʼzi Chromium qurilmalari) alohida oyna
 * ochiladi, aks holda bosganda hech narsa boʻlmasdi.
 */
const hasSidePanel = Boolean(chrome.sidePanel);

if (hasSidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[daho] panel sozlanmadi:', err));
} else {
  chrome.action.onClicked.addListener(() => void openWindow());
}

/** Zaxira yoʻl — panelni oddiy oyna qilib ochamiz. */
function openWindow() {
  return chrome.windows.create({
    url: chrome.runtime.getURL('src/panel.html'),
    type: 'popup',
    width: 460,
    height: 900,
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  // Kengaytma qayta yuklanganda eski menyu qolib ketadi va
  // `create` «duplicate id» deb yiqiladi.
  await chrome.contextMenus.removeAll().catch(() => undefined);
  chrome.contextMenus.create({
    id: 'daho-analyze',
    title: 'Daho bilan tahlil qilish',
    contexts: ['page', 'selection', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'daho-analyze') return;
  if (hasSidePanel && tab?.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      return;
    } catch {
      /* pastdagi zaxira yoʻl */
    }
  }
  await openWindow();
});

/**
 * Havolani yangi varaqda ochib, undan maʼlumot oladi.
 * Varaq ish tugagach yopiladi — foydalanuvchi ekrani toʻlib ketmasin.
 */
async function readUrl(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    // Sahifa yuklanishini kutamiz.
    await new Promise((resolve) => {
      const done = (id, info) => {
        if (id === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }, 15000);
    });
    await new Promise((r) => setTimeout(r, 1200));

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/collect.js'] });
    return await chrome.tabs.sendMessage(tab.id, { type: 'daho:collect' });
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'daho:open') return undefined;
  readUrl(msg.url)
    .then(reply)
    .catch((err) => reply({ ok: false, error: String(err?.message ?? err) }));
  return true;
});

/**
 * Tahlil qilinadigan varaq.
 *
 * Panel alohida oyna boʻlib ochilgan boʻlsa, «joriy oyna» — panelning
 * oʻzi boʻlib chiqadi. Shuning uchun kengaytma sahifasi boʻlsa oddiy
 * veb varaqni qidiramiz.
 */
async function activeTab() {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current?.url && /^https?:/.test(current.url)) return current;

  const others = await chrome.tabs.query({ active: true });
  return others.find((t) => t.url && /^https?:/.test(t.url)) ?? current;
}

/** Panel soʻraganda sahifadan maʼlumot yigʻamiz. */
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'daho:page') return undefined;

  (async () => {
    const tab = await activeTab();
    if (!tab?.id) return reply({ ok: false, error: 'Faol varaq topilmadi' });

    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'daho:collect' });
      return reply(res);
    } catch {
      // Content script hali yuklanmagan boʻlsa — majburan kiritamiz.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/collect.js'],
        });
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'daho:collect' });
        return reply(res);
      } catch (err) {
        return reply({
          ok: false,
          error:
            'Bu sahifadan maʼlumot olib boʻlmadi. Brauzer ichki sahifalarida '
            + '(chrome://, doʻkon) kengaytma ishlamaydi.',
        });
      }
    }
  })();

  return true;
});
