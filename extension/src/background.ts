/**
 * Fon xizmati.
 *
 * Ikkita ish qiladi: yon panelni ochadi va sichqoncha oʻng tugma
 * menyusidagi buyruqlarni qabul qiladi.
 */

type MenuContext = chrome.contextMenus.CreateProperties['contexts'];

const ACTIONS: Array<{ id: string; title: string; contexts: MenuContext }> = [
  { id: 'daho-explain', title: 'Daho: tanlanganini tushuntir', contexts: ['selection'] },
  { id: 'daho-translate', title: 'Daho: oʻzbekchaga tarjima qil', contexts: ['selection'] },
  { id: 'daho-summary', title: 'Daho: sahifani qisqacha aytib ber', contexts: ['page'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const a of ACTIONS) {
      chrome.contextMenus.create({ id: a.id, title: a.title, contexts: a.contexts });
    }
  });
  // Ikonka bosilganda yon panel ochilsin.
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const task =
    info.menuItemId === 'daho-translate'
      ? 'tarjima'
      : info.menuItemId === 'daho-summary'
        ? 'qisqacha'
        : 'tushuntir';

  void chrome.storage.session
    .set({ pending: { task, selection: info.selectionText ?? '' } })
    .then(() => chrome.sidePanel.open({ tabId: tab.id! }));
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'daho:open-panel' && sender.tab?.id) {
    void chrome.sidePanel.open({ tabId: sender.tab.id });
    reply({ ok: true });
    return true;
  }
  return undefined;
});
