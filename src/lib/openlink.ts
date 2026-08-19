import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

/**
 * Tashqi havolalar.
 *
 * Koʻp yirik saytlar (ChatGPT, Google, Instagram, GitHub…) javob sarlavhasida
 * `X-Frame-Options` yoki `frame-ancestors` qoʻyadi — ular boshqa ilova ichida,
 * ya'ni iframe’da ochilmaydi. Brauzer «ERR_BLOCKED_BY_RESPONSE» deb boʻsh sahifa
 * koʻrsatadi. Bunday saytlarni telefonning brauzerida ochamiz.
 */

/** Iframe’ni taqiqlashi maʼlum saytlar. */
const BLOCKED = [
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'google.com',
  'accounts.google.com',
  'youtube.com',
  'gemini.google.com',
  'aistudio.google.com',
  'claude.ai',
  'anthropic.com',
  'github.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  't.me',
  'telegram.org',
  'linkedin.com',
  'tiktok.com',
  'reddit.com',
  'amazon.com',
  'yandex.ru',
  'mail.ru',
];

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Sayt iframe ichida ochilmasligi ehtimoli katta boʻlsa — rost. */
export function blocksEmbedding(url: string): boolean {
  try {
    const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, '').toLowerCase();
    return BLOCKED.some((b) => host === b || host.endsWith(`.${b}`));
  } catch {
    return false;
  }
}

/**
 * Havolani ochadi.
 *
 * Android’da Capacitor Browser plagini orqali — sahifa ilovaning USTIDA,
 * «Custom Tab» boʻlib ochiladi: foydalanuvchi ilovadan chiqib ketmaydi,
 * orqaga tugmasi bilan darhol qaytadi. Vebda esa yangi ilova oynasi.
 */
export function openExternal(url: string): boolean {
  const target = normalizeUrl(url);

  if (Capacitor.isNativePlatform()) {
    void Browser.open({
      url: target,
      presentationStyle: 'popover',
      toolbarColor: getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim() || '#09090b',
    }).catch(() => {
      // Plagin ishlamasa — pastdagi oddiy yoʻl.
      window.open(target, '_blank');
    });
    return true;
  }
  try {
    // Diqqat: 'noopener' berilsa window.open HAR DOIM null qaytaradi va
    // pastdagi zaxira yoʻl ham ishlab, oyna ikki marta ochilib ketadi.
    const win = window.open(target, '_blank');
    if (win) {
      try {
        win.opener = null;
      } catch {
        /* ahamiyatsiz */
      }
      return true;
    }
  } catch {
    /* pastdagi zaxira yoʻlga oʻtamiz */
  }
  try {
    // Zaxira: koʻrinmas havolani «bosamiz» — WebView buni tashqariga chiqaradi.
    const a = document.createElement('a');
    a.href = target;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}
