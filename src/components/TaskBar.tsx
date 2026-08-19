import { useEffect, useState } from 'react';
import { stopTask, useTasks } from '../lib/tasks';
import { Close, Stop } from './Icons';

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
  kitob: '📖',
};

/**
 * Hozir nima bajarilayotganini koʻrsatuvchi suzuvchi tugmacha.
 *
 * Muhim: bu qator sahifa tartibini SURMAYDI — ustida suzib turadi.
 * Avval u oddiy blok edi va ish boshlanganda butun ekran pastga siljib,
 * interfeys sakrab ketardi.
 */
export function TaskBar() {
  const tasks = useTasks();
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);

  // Sekundomer uchun har soniyada yangilanadi.
  useEffect(() => {
    if (!tasks.length) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [tasks.length]);

  useEffect(() => {
    if (!tasks.length) setOpen(false);
  }, [tasks.length]);

  if (!tasks.length) return null;

  const first = tasks[0];

  if (!open) {
    return (
      <div className="taskpill-wrap">
        <button className="taskpill" onClick={() => setOpen(true)}>
          <span className="taskbar-dot" />
          <span className="taskbar-kind">{KIND_LABEL[first.kind] ?? '⚙️'}</span>
          <span className="taskpill-text">
            {tasks.length > 1 ? `${tasks.length} ta ish` : first.note || first.title}
          </span>
          <span className="taskbar-time">{elapsed(first.startedAt)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="taskpill-wrap open">
      <div className="taskbar">
        <div className="between" style={{ padding: '0 2px 4px' }}>
          <span className="tiny">Bajarilmoqda</span>
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setOpen(false)}>
            <Close size={15} />
          </button>
        </div>
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
    </div>
  );
}
