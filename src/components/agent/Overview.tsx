import { useMemo } from 'react';
import { useStore } from '../../lib/store';
import { DAYS } from '../../lib/types';
import { fmtDuration, todayISO, weekdayIndex } from '../../lib/utils';
import { Empty } from '../ui';
import type { AgentSection } from './sections';

export function Overview({ onNavigate }: { onNavigate: (s: AgentSection) => void }) {
  const state = useStore((s) => s);
  const day = weekdayIndex();
  const today = todayISO();

  const lessons = useMemo(
    () => state.schedule.filter((i) => i.day === day).sort((a, b) => a.start.localeCompare(b.start)),
    [state.schedule, day],
  );

  const nextLesson = useMemo(() => {
    const nowHM = new Date().toTimeString().slice(0, 5);
    return lessons.find((l) => l.end > nowHM) ?? null;
  }, [lessons]);

  const dueTasks = useMemo(
    () =>
      state.tasks
        .filter((t) => !t.done && (!t.due || t.due <= today))
        .slice(0, 5),
    [state.tasks, today],
  );

  const openCount = state.tasks.filter((t) => !t.done).length;
  const running = state.timeLogs.find((l) => !l.end) ?? null;
  const todayMinutes = Math.round(
    state.timeLogs
      .filter((l) => l.end && todayISO(new Date(l.start)) === today)
      .reduce((sum, l) => sum + ((l.end ?? 0) - l.start), 0) / 60000,
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? 'Tunni ham ishga aylantiryapsiz' : hour < 12 ? 'Xayrli tong' : hour < 18 ? 'Xayrli kun' : 'Xayrli kech';

  return (
    <div className="scroll">
      <div className="pad">
        <div style={{ marginBottom: 4, fontSize: 21, fontWeight: 620, letterSpacing: '-0.02em' }}>
          {greeting}
          {state.settings.userName ? `, ${state.settings.userName}` : ''}
        </div>
        <div className="muted" style={{ marginBottom: 16 }}>
          {DAYS[day]} · {today}
        </div>

        <div className="stat-grid">
          <button className="stat" onClick={() => onNavigate('jadval')}>
            <b>{lessons.length}</b>
            <span>bugungi dars</span>
          </button>
          <button className="stat" onClick={() => onNavigate('vazifalar')}>
            <b>{openCount}</b>
            <span>ochiq vazifa</span>
          </button>
          <button className="stat" onClick={() => onNavigate('vaqt')}>
            <b>{todayMinutes}</b>
            <span>daqiqa ish</span>
          </button>
        </div>

        {running && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <div className="between">
              <div className="grow">
                <div className="tiny">Hozir davom etmoqda</div>
                <div style={{ fontSize: 15, fontWeight: 550 }}>{running.label}</div>
              </div>
              <div className="chip accent">{fmtDuration(Date.now() - running.start)}</div>
            </div>
          </div>
        )}

        <div className="section-label">Bugungi darslar</div>
        {lessons.length === 0 ? (
          <Empty title="Bugun dars yoʻq" hint="Jadval boʻlimidan darslarni qoʻshing." />
        ) : (
          lessons.map((l) => (
            <div
              className="lesson"
              key={l.id}
              style={l.id === nextLesson?.id ? { borderColor: 'var(--accent)' } : undefined}
            >
              <span className="lesson-time">
                {l.start}
                <small>{l.end}</small>
              </span>
              <span className="grow">
                <div style={{ fontSize: 14.5, fontWeight: 550 }}>{l.subject}</div>
                <div className="tiny">{[l.room, l.teacher].filter(Boolean).join(' · ')}</div>
              </span>
              {l.id === nextLesson?.id && <span className="chip accent">keyingi</span>}
            </div>
          ))
        )}

        <div className="section-label">Muddati kelgan vazifalar</div>
        {dueTasks.length === 0 ? (
          <Empty title="Hammasi joyida" hint="Muddati kelgan vazifa yoʻq." />
        ) : (
          dueTasks.map((t) => (
            <button
              className="list-item"
              key={t.id}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => onNavigate('vazifalar')}
            >
              <div className="grow" style={{ fontSize: 14.5 }}>
                {t.title}
              </div>
              {t.due && (
                <span className="chip" style={t.due < today ? { color: 'var(--danger)' } : undefined}>
                  {t.due}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
