/*
 * Fon xizmati — panelni ochadi va sahifa maʼlumotini oladi.
 */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'daho-analyze',
    title: 'Daho bilan tahlil qilish',
    contexts: ['page', 'selection', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'daho-analyze' || !tab?.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
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

/** Panel soʻraganda sahifadan maʼlumot yigʻamiz. */
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'daho:page') return undefined;

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
