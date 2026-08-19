/**
 * Havolani ilovaning ichki brauzerida ochish uchun kichik ulagich.
 *
 * Kutubxona qatlami (vositalar, markdown) interfeysga bogʻlanmasligi kerak,
 * shuning uchun ochish soʻrovi shu yerdan oʻtadi. Interfeys tayyor boʻlmasa
 * havola tizim brauzerida ochiladi — hech narsa yoʻqolmaydi.
 */
import { openExternal } from './openlink';

type Listener = (url: string) => void;

let listener: Listener | null = null;

export function onOpenSite(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function openSite(url: string): void {
  if (listener) listener(url);
  else openExternal(url);
}
