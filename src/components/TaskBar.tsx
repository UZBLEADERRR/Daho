import { stopTask, useTasks } from '../lib/tasks';
import { Stop } from './Icons';

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
          <button onClick={() => stopTask(t.id)} aria-label="Toʻxtatish">
            <Stop size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
