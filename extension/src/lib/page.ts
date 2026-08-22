/** Joriy varaqdagi matnni oladi (content script orqali). */

export interface PageInfo {
  title: string;
  url: string;
  text: string;
  selection: string;
  words: number;
}

const EMPTY: PageInfo = { title: '', url: '', text: '', selection: '', words: 0 };

export async function currentPage(): Promise<PageInfo> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return EMPTY;

  try {
    const info = (await chrome.tabs.sendMessage(tab.id, { type: 'daho:page' })) as PageInfo;
    if (info?.url) return info;
  } catch {
    /* content script hali yuklanmagan — pastda qaytadan quyamiz */
  }

  // chrome:// va doʻkon sahifalarida skript ishlamaydi — sarlavha bilan cheklanamiz.
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: location.href,
        text: (document.body?.innerText ?? '').slice(0, 24_000),
        selection: (window.getSelection()?.toString() ?? '').trim().slice(0, 8000),
      }),
    });
    const value = result?.result as Omit<PageInfo, 'words'> | undefined;
    if (value) return { ...value, words: value.text ? value.text.split(/\s+/).length : 0 };
  } catch {
    /* ruxsat yoʻq */
  }

  return { ...EMPTY, title: tab.title ?? '', url: tab.url ?? '' };
}
