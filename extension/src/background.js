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
