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
};

/**
 * Ekranning pastida turuvchi ingichka qator: hozir nima bajarilayotganini
 * koʻrsatadi. Foydalanuvchi boshqa boʻlimga oʻtsa ham ish davom etadi.
 */
export function TaskBar() {
  const tasks = useTasks();
  const [, tick] = useState(0);

  // Sekundomer uchun har soniyada yangilanadi.
  useEffect(() => {
    if (!tasks.length) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [tasks.length]);

  if (!tasks.length) return null;

  return (
    <div className="taskbar">
      {tasks.map((t) => (
        <div className="taskbar-item" key={t.id}>
          <span className="taskbar-dot" />
          <span className="taskbar-kind">{KIND_LABEL[t.kind] ?? '⚙️'}</span>
          <span className="grow">
            <b>{t.title}</b>
            <i>{t.note}</i>
          </span>
          <span className="taskbar-time">{elapsed(t.startedAt)}</span>
          <button onClick={() => stopTask(t.id)} aria-label="Toʻxtatish">
            <Stop size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
