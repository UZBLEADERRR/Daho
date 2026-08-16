import { useMemo, useState } from 'react';
import { setState, useStore } from '../../lib/store';
import type { Priority, Task } from '../../lib/types';
import { todayISO, uid } from '../../lib/utils';
import { Check, Plus, Trash } from '../Icons';
import { Empty, Sheet } from '../ui';

const PRIORITY_LABEL: Record<Priority, string> = {
  yuqori: 'Yuqori',
  orta: 'Oʻrta',
  past: 'Past',
};

type Filter = 'ochiq' | 'bugun' | 'bajarilgan';

export function Tasks() {
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const [filter, setFilter] = useState<Filter>('ochiq');
  const [draft, setDraft] = useState<(Omit<Task, 'id' | 'createdAt'> & { id?: string }) | null>(
    null,
  );

  const today = todayISO();

  const visible = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      return b.createdAt - a.createdAt;
    });
    if (filter === 'bajarilgan') return sorted.filter((t) => t.done);
    if (filter === 'bugun') return sorted.filter((t) => !t.done && t.due && t.due <= today);
    return sorted.filter((t) => !t.done);
  }, [tasks, filter, today]);

  const toggle = (id: string) =>
    setState((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));

  const save = () => {
    if (!draft || !draft.title.trim()) return;
    const task: Task = {
      id: draft.id ?? uid('t_'),
      createdAt: Date.now(),
      ...draft,
      title: draft.title.trim(),
    };
    setState((s) => ({
      tasks: draft.id ? s.tasks.map((t) => (t.id === draft.id ? task : t)) : [task, ...s.tasks],
    }));
    setDraft(null);
  };

  const remove = (id: string) => {
    setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    setDraft(null);
  };

  return (
    <div className="scroll">
      <div className="seg">
        {(['ochiq', 'bugun', 'bajarilgan'] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f === 'ochiq' ? 'Ochiq' : f === 'bugun' ? 'Muddati keldi' : 'Bajarilgan'}
          </button>
        ))}
      </div>

      <div className="pad">
        <button
          className="btn wide ghost"
          style={{ marginBottom: 12 }}
          onClick={() => setDraft({ title: '', done: false, priority: 'orta', due: '' })}
        >
          <Plus size={16} /> Vazifa qoʻshish
        </button>

        {visible.length === 0 ? (
          <Empty
            title="Vazifa yoʻq"
            hint="Chatda “ertaga fizikadan mustaqil ish topshirishim kerak” deb yozsangiz, agent oʻzi qoʻshadi."
          />
        ) : (
          visible.map((task) => {
            const overdue = !task.done && task.due && task.due < today;
            return (
              <div className="list-item" key={task.id}>
                <button
                  className={task.done ? 'check on' : 'check'}
                  onClick={() => toggle(task.id)}
                  aria-label="Belgilash"
                >
                  <Check size={13} />
                </button>
                <button
                  className="grow"
                  style={{ textAlign: 'left' }}
                  onClick={() =>
                    setDraft({
                      id: task.id,
                      title: task.title,
                      done: task.done,
                      priority: task.priority,
                      due: task.due ?? '',
                      projectId: task.projectId,
                    })
                  }
                >
                  <div className={task.done ? 'done-text' : ''} style={{ fontSize: 14.5 }}>
                    {task.title}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 5 }}>
                    {task.due && (
                      <span
                        className="chip"
                        style={overdue ? { color: 'var(--danger)' } : undefined}
                      >
                        {task.due}
                      </span>
                    )}
                    {task.priority !== 'orta' && (
                      <span className="chip">{PRIORITY_LABEL[task.priority]}</span>
                    )}
                    {task.projectId && (
                      <span className="chip">
                        {projects.find((p) => p.id === task.projectId)?.name ?? 'Loyiha'}
                      </span>
                    )}
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>

      {draft && (
        <Sheet
          title={draft.id ? 'Vazifani tahrirlash' : 'Yangi vazifa'}
          onClose={() => setDraft(null)}
        >
          <div className="field">
            <label>Vazifa</label>
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Fizikadan 5-mavzu konspekti"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Muddat</label>
              <input
                type="date"
                value={draft.due ?? ''}
                onChange={(e) => setDraft({ ...draft, due: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Muhimlik</label>
              <select
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
              >
                <option value="past">Past</option>
                <option value="orta">Oʻrta</option>
                <option value="yuqori">Yuqori</option>
              </select>
            </div>
          </div>
          {projects.length > 0 && (
            <div className="field">
              <label>Loyiha</label>
              <select
                value={draft.projectId ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, projectId: e.target.value || undefined })
                }
              >
                <option value="">— yoʻq —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="row" style={{ marginTop: 6 }}>
            {draft.id && (
              <button className="btn ghost" onClick={() => remove(draft.id!)}>
                <Trash size={15} />
              </button>
            )}
            <button className="btn grow" onClick={save} disabled={!draft.title.trim()}>
              Saqlash
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
