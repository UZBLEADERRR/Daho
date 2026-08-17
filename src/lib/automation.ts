/**
 * Avtomatlashtirish — belgilangan vaqtda oʻzi ishga tushadigan topshiriq.
 *
 * Foydalanuvchi topshiriqni oʻzi yozadi («Bugungi eng muhim IT yangiliklarini
 * top va qisqacha yozib ber»), vaqtini va kunlarini belgilaydi. Ilova ochiq
 * boʻlganda soat kelganda topshiriq oʻzi bajariladi va natija suhbatga tushadi.
 *
 * Ilova yopiq boʻlgan vaqt ham hisobga olinadi: ochilganda oʻtkazib
 * yuborilgan topshiriqlar (oxirgi 12 soat ichidagilar) bajariladi —
 * shunda ertalabki xabar tushdan keyin ilovani ochganingizda ham keladi.
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { createChat, sendMessage } from './agent';
import { runCodeAgent } from './codeagent';
import { getState, setState } from './store';
import { noteTask, startTask } from './tasks';
import type { Automation } from './types';
import { uid } from './utils';

const TICK_MS = 30_000;
/** Ilova yopiq boʻlgan vaqtdagi topshiriqlar shu muddat ichida bajariladi */
const CATCHUP_MS = 12 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export interface AutomationDraft {
  title: string;
  prompt: string;
  time: string;
  days: number[];
  target?: 'chat' | 'kod';
  projectId?: string;
  freshChat?: boolean;
  model?: string;
}

export function createAutomation(draft: AutomationDraft): Automation {
  const item: Automation = {
    id: uid('auto_'),
    title: draft.title.trim() || 'Nomsiz topshiriq',
    prompt: draft.prompt.trim(),
    time: /^\d{2}:\d{2}$/.test(draft.time) ? draft.time : '08:00',
    days: draft.days ?? [],
    enabled: true,
    target: draft.target ?? 'chat',
    projectId: draft.projectId,
    freshChat: draft.freshChat ?? false,
    model: draft.model,
    createdAt: Date.now(),
  };
  setState((s) => ({ automations: [item, ...s.automations] }));
  void ensurePermission();
  return item;
}

export function patchAutomation(id: string, patch: Partial<Automation>): void {
  setState((s) => ({
    automations: s.automations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  }));
}

export function deleteAutomation(id: string): void {
  setState((s) => ({ automations: s.automations.filter((a) => a.id !== id) }));
}

/* ------------------------------------------------------------------ */
/*  Vaqt hisobi                                                        */
/* ------------------------------------------------------------------ */

/** 0=Dushanba … 6=Yakshanba (JS da 0=Yakshanba). */
function dayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function runsOnDay(item: Automation, date: Date): boolean {
  return !item.days.length || item.days.includes(dayIndex(date));
}

/** Shu topshiriq hozir bajarilishi kerakmi? */
function isDue(item: Automation, now: Date): boolean {
  if (!item.enabled || !item.prompt.trim()) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const target = minutesOf(item.time);
  if (nowMinutes < target) return false;
  if (!runsOnDay(item, now)) return false;

  // Bugungi belgilangan vaqt.
  const due = new Date(now);
  due.setHours(Math.floor(target / 60), target % 60, 0, 0);

  // Bugun allaqachon bajarilgan boʻlsa — takrorlamaymiz.
  if (item.lastRunAt && item.lastRunAt >= due.getTime()) return false;
  // Juda eski (ilova uzoq yopiq turgan) — oʻtkazib yuboramiz.
  if (now.getTime() - due.getTime() > CATCHUP_MS) return false;
  return true;
}

/** Keyingi ishga tushish vaqti — UI da koʻrsatish uchun. */
export function nextRunAt(item: Automation): number | null {
  if (!item.enabled) return null;
  const now = new Date();
  for (let i = 0; i < 8; i += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    day.setHours(Math.floor(minutesOf(item.time) / 60), minutesOf(item.time) % 60, 0, 0);
    if (day.getTime() <= now.getTime()) continue;
    if (!runsOnDay(item, day)) continue;
    return day.getTime();
  }
  return null;
}

export function describeDays(days: number[]): string {
  if (!days.length) return 'har kuni';
  const names = ['Du', 'Se', 'Cho', 'Pay', 'Ju', 'Sha', 'Yak'];
  if (days.length === 5 && [0, 1, 2, 3, 4].every((d) => days.includes(d))) return 'ish kunlari';
  if (days.length === 2 && days.includes(5) && days.includes(6)) return 'dam olish kunlari';
  return [...days].sort((a, b) => a - b).map((d) => names[d]).join(', ');
}

/* ------------------------------------------------------------------ */
/*  Bildirishnoma                                                      */
/* ------------------------------------------------------------------ */

let permissionAsked = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionAsked) return true;
  permissionAsked = true;
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await LocalNotifications.requestPermissions();
      return res.display === 'granted';
    }
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    return true;
  } catch {
    return false;
  }
}

async function notify(title: string, body: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 100000),
            title,
            body: body.slice(0, 180),
            smallIcon: 'ic_stat_icon_config_sample',
          },
        ],
      });
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body: body.slice(0, 180) });
    }
  } catch {
    /* bildirishnoma ishlamasa ham natija suhbatda turadi */
  }
}

/* ------------------------------------------------------------------ */
/*  Bajarish                                                           */
/* ------------------------------------------------------------------ */

function stampDate(): string {
  return new Date().toLocaleDateString('uz-UZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Topshiriqni hoziroq bajaradi (qoʻlda ham chaqirsa boʻladi). */
export async function runAutomation(id: string): Promise<void> {
  const item = getState().automations.find((a) => a.id === id);
  if (!item) return;

  patchAutomation(id, { lastRunAt: Date.now() });

  await startTask(
    { kind: 'avto', targetId: id, title: item.title, note: 'bajarilmoqda' },
    async (signal, taskId) => {
      const prompt =
        `${item.prompt}\n\n` +
        `(Bu avtomatik topshiriq. Bugun: ${stampDate()}. ` +
        `Javobni toʻliq va tayyor holda ber — foydalanuvchi keyinroq oʻqiydi.)`;

      try {
        if (item.target === 'kod' && item.projectId) {
          const res = await runCodeAgent(item.projectId, prompt, signal, [], (step) =>
            noteTask(taskId, step),
          );
          patchAutomation(id, { lastOk: res.ok, lastResult: res.text.slice(0, 400) });
        } else {
          // Suhbat: yangisi yoki shu topshiriqning oʻz suhbati.
          let chatId = item.chatId;
          if (item.freshChat || !chatId || !getState().chats.some((c) => c.id === chatId)) {
            chatId = createChat(`🔁 ${item.title}`);
            patchAutomation(id, { chatId });
          }
          const res = await sendMessage(chatId, prompt, [], signal, undefined, (step) =>
            noteTask(taskId, step),
          );
          patchAutomation(id, { lastOk: res.ok, lastResult: res.text.slice(0, 400) });
          if (res.ok && res.text.trim()) {
            await notify(item.title, res.text.replace(/[#*`_>]/g, '').trim());
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        patchAutomation(id, {
          lastOk: false,
          lastResult: String((err as Error)?.message ?? err).slice(0, 300),
        });
      }
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Soat                                                               */
/* ------------------------------------------------------------------ */

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const { automations, settings } = getState();
  if (!automations.length || !settings.apiKey) return;

  const now = new Date();
  for (const item of automations) {
    if (!isDue(item, now)) continue;
    // Ketma-ket bajaramiz — bir vaqtda bir nechta model soʻrovi qilmaslik uchun.
    // eslint-disable-next-line no-await-in-loop
    await runAutomation(item.id);
  }
}

/** Ilova ochilganda bir marta chaqiriladi. */
export function startScheduler(): () => void {
  if (timer) return () => undefined;
  // Ochilishda darhol tekshiramiz — oʻtkazib yuborilganlar bajarilsin.
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);

  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisible);
  };
}
