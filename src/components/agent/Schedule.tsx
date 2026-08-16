import { useState } from 'react';
import { setState, useStore } from '../../lib/store';
import { DAYS, type ScheduleItem } from '../../lib/types';
import { uid, weekdayIndex } from '../../lib/utils';
import { Plus, Trash } from '../Icons';
import { Empty, Sheet } from '../ui';

const KIND_LABEL: Record<string, string> = {
  maruza: 'Maʼruza',
  amaliyot: 'Amaliyot',
  lab: 'Laboratoriya',
  boshqa: 'Boshqa',
};

const EMPTY: Omit<ScheduleItem, 'id'> = {
  day: 0,
  start: '09:00',
  end: '10:20',
  subject: '',
  room: '',
  teacher: '',
  kind: 'maruza',
};

export function Schedule() {
  const schedule = useStore((s) => s.schedule);
  const [draft, setDraft] = useState<(Omit<ScheduleItem, 'id'> & { id?: string }) | null>(null);
  const today = weekdayIndex();

  const save = () => {
    if (!draft || !draft.subject.trim()) return;
    const item: ScheduleItem = {
      ...draft,
      id: draft.id ?? uid('s_'),
      subject: draft.subject.trim(),
    };
    setState((s) => ({
      schedule: [...s.schedule.filter((i) => i.id !== item.id), item].sort(
        (a, b) => a.day - b.day || a.start.localeCompare(b.start),
      ),
    }));
    setDraft(null);
  };

  const remove = (id: string) => {
    setState((s) => ({ schedule: s.schedule.filter((i) => i.id !== id) }));
    setDraft(null);
  };

  return (
    <div className="scroll">
      <div className="pad">
        <div className="between" style={{ marginBottom: 12 }}>
          <div className="h2" style={{ margin: 0 }}>
            Dars jadvali
          </div>
          <button className="btn mini" onClick={() => setDraft({ ...EMPTY, day: today })}>
            <Plus size={15} /> Dars
          </button>
        </div>

        {schedule.length === 0 ? (
          <Empty
            title="Jadval boʻsh"
            hint="Darslarni qoʻlda qoʻshing yoki chatda “jadvalimni yozib ol” deb aytib bering — agent oʻzi kiritadi."
          />
        ) : (
          DAYS.map((dayName, dayIndex) => {
            const items = schedule.filter((i) => i.day === dayIndex);
            if (!items.length) return null;
            return (
              <div className="day-block" key={dayName}>
                <div className={dayIndex === today ? 'day-title today' : 'day-title'}>
                  {dayName}
                  {dayIndex === today && <span className="chip accent">bugun</span>}
                </div>
                {items.map((item) => (
                  <button
                    className="lesson"
                    key={item.id}
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => setDraft({ ...item })}
                  >
                    <span className="lesson-time">
                      {item.start}
                      <small>{item.end}</small>
                    </span>
                    <span className="grow">
                      <div style={{ fontSize: 14.5, fontWeight: 550 }}>{item.subject}</div>
                      <div className="tiny">
                        {[item.room, item.teacher, item.kind && KIND_LABEL[item.kind]]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </span>
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>

      {draft && (
        <Sheet title={draft.id ? 'Darsni tahrirlash' : 'Yangi dars'} onClose={() => setDraft(null)}>
          <div className="field">
            <label>Fan nomi</label>
            <input
              autoFocus
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Matematik analiz"
            />
          </div>
          <div className="field">
            <label>Hafta kuni</label>
            <select
              value={draft.day}
              onChange={(e) => setDraft({ ...draft, day: Number(e.target.value) })}
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Boshlanish</label>
              <input
                type="time"
                value={draft.start}
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Tugash</label>
              <input
                type="time"
                value={draft.end}
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Xona</label>
              <input
                value={draft.room ?? ''}
                onChange={(e) => setDraft({ ...draft, room: e.target.value })}
                placeholder="304-a"
              />
            </div>
            <div className="field">
              <label>Turi</label>
              <select
                value={draft.kind ?? 'maruza'}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as ScheduleItem['kind'] })
                }
              >
                <option value="maruza">Maʼruza</option>
                <option value="amaliyot">Amaliyot</option>
                <option value="lab">Laboratoriya</option>
                <option value="boshqa">Boshqa</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Oʻqituvchi</label>
            <input
              value={draft.teacher ?? ''}
              onChange={(e) => setDraft({ ...draft, teacher: e.target.value })}
            />
          </div>

          <div className="row" style={{ marginTop: 6 }}>
            {draft.id && (
              <button className="btn ghost" onClick={() => remove(draft.id!)}>
                <Trash size={15} />
              </button>
            )}
            <button className="btn grow" onClick={save} disabled={!draft.subject.trim()}>
              Saqlash
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
