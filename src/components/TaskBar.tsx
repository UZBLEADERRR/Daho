import { useEffect, useState } from 'react';
import { stopTask, useTasks } from '../lib/tasks';
import { Stop } from './Icons';

function elapsed(from: number): string {
  const sec = Math.max(0, Math.round((Date.now() - from) / 1000));
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  return `${min}:${String(sec % 60).padStart(2, '0')}`;
}

const KIND_LABEL: Record<string, string> = {
  chat: '💬',
  code: '⌨️',
  video: '🎬',
  dars: '🎓',
  rasm: '🖼',
  kitob: '📚',
  avto: '🔁',
};

/**
 * Ekranning eng pastidagi ingichka qator: hozir nima bajarilayotgani.
 *
 * Ataylab suzuvchi emas — avvalgi suzuvchi tugmacha yuqoridagi boʻlim
 * tugmalarini yopib qoʻyardi. Bu qator hech narsani bosmaydi va matn
 * oʻqishga xalaqit bermaydi.
 */
export function TaskBar({ hide }: { hide?: { kind: string; targetId: string } }) {
  const all = useTasks();
  /*
   * Ekranda koʻrinib turgan ish bu yerda takrorlanmaydi.
   *
   * Suhbat yoki kod oynasida jarayon javob chiqadigan joyda —
   * yuqorida — koʻrsatiladi. Pastda yana bir marta yozilsa ikki
   * joyda bir xil narsa turadi va diqqatni boʻladi. Bu qator
   * faqat FON ishlari uchun qoladi: kitob, video, avtomatlashtirish.
   */
  const tasks = hide
    ? all.filter((t) => !(t.kind === hide.kind && t.targetId === hide.targetId))
    : all;
  const [, tick] = useState(0);

  useEffect(() => {
    if (!tasks.length) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [tasks.length]);

  if (!tasks.length) return null;

  const task = tasks[tasks.length - 1];

  return (
    <div className="taskstrip">
      <span className="taskbar-dot" />
      <span className="taskbar-kind">{KIND_LABEL[task.kind] ?? '⚙️'}</span>
      <span className="taskstrip-text">
        {task.note || task.title}
        {tasks.length > 1 ? ` · yana ${tasks.length - 1} ta ish` : ''}
      </span>
      <span className="taskbar-time">{elapsed(task.startedAt)}</span>
      <button onClick={() => stopTask(task.id)} aria-label="Toʻxtatish">
        <Stop size={13} />
      </button>
    </div>
  );
}
