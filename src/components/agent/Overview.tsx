import { useMemo, useState } from 'react';
import {
  CAPABILITY_GROUPS,
  capabilityCount,
  type Capability,
  type CapabilityGroup,
} from '../../lib/capabilities';
import { updateView, useStore } from '../../lib/store';
import { Sheet } from '../ui';
import { DAYS } from '../../lib/types';
import { fmtDuration, todayISO, weekdayIndex } from '../../lib/utils';
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

  const writingBooks = useMemo(
    () => state.books.filter((b) => b.stage !== 'tayyor' && b.chapters.length).slice(0, 2),
    [state.books],
  );

  const todayAutomations = useMemo(
    () =>
      state.automations
        .filter((a) => a.enabled && (!a.days.length || a.days.includes(day)))
        .sort((a, b) => a.time.localeCompare(b.time)),
    [state.automations, day],
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

        <Capabilities />

        {/* Yozilayotgan kitoblar — jarayon uzun, shuning uchun bosh sahifada. */}
        {writingBooks.map((b) => {
          const done = b.chapters.filter((c) => c.done).length;
          const pct = b.chapters.length ? Math.round((done / b.chapters.length) * 100) : 0;
          return (
            <button
              className="card"
              key={b.id}
              style={{ display: 'block', width: '100%', textAlign: 'left', borderColor: 'var(--accent)' }}
              onClick={() => {
                updateView({ bookId: b.id });
                onNavigate('kitoblar');
              }}
            >
              <div className="tiny">📚 Kitob yozilmoqda</div>
              <div style={{ fontSize: 15, fontWeight: 550, marginTop: 2 }}>{b.title}</div>
              <div className="progress">
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="tiny" style={{ marginTop: 5 }}>
                {done} / {b.chapters.length} bob
              </div>
            </button>
          );
        })}

        {/* Bugun ishga tushadigan avtomatik topshiriqlar */}
        {todayAutomations.length > 0 && (
          <button
            className="card"
            style={{ display: 'block', width: '100%', textAlign: 'left' }}
            onClick={() => onNavigate('avto')}
          >
            <div className="tiny">🔁 Bugungi avtomatik topshiriqlar</div>
            {todayAutomations.slice(0, 3).map((a) => (
              <div key={a.id} style={{ fontSize: 14, marginTop: 4 }}>
                {a.time} — {a.title}
              </div>
            ))}
          </button>
        )}

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

        {lessons.length > 0 && <div className="section-label">Bugungi darslar</div>}
        {lessons.length === 0 ? null : (
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

        {dueTasks.length > 0 && <div className="section-label">Muddati kelgan vazifalar</div>}
        {dueTasks.length === 0 ? null : (
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

/* ------------------------------------------------------------------ */
/*  Nima qila olaman — imkoniyatlar galereyasi                         */
/* ------------------------------------------------------------------ */

function Capabilities() {
  const settings = useStore((s) => s.settings);
  const [open, setOpen] = useState<CapabilityGroup | null>(null);

  const ready = (cap: Capability): boolean => {
    if (cap.needs === 'gemini') return Boolean(settings.apiKey);
    if (cap.needs === 'github') return Boolean(settings.githubToken);
    if (cap.needs === 'ulanish') return (settings.connectors ?? []).some((c) => c.enabled);
    return true;
  };

  const start = (cap: Capability) => {
    setOpen(null);
    updateView({ tab: 'chat', draft: cap.prompt });
  };

  return (
    <>
      <div className="between" style={{ margin: '18px 0 10px' }}>
        <div className="section-label" style={{ padding: 0 }}>
          Nima qila olaman
        </div>
        <span className="tiny">{capabilityCount()} ta imkoniyat</span>
      </div>

      <div className="cap-groups">
        {CAPABILITY_GROUPS.map((g) => (
          <button className="cap-group" key={g.id} onClick={() => setOpen(g)}>
            <span className="cap-group-icons">
              {g.items.slice(0, 4).map((i) => (
                <i key={i.id}>{i.icon}</i>
              ))}
            </span>
            <b>{g.title}</b>
            <i>{g.hint}</i>
            <span className="cap-group-count">{g.items.length}</span>
          </button>
        ))}
      </div>

      {open && (
        <Sheet title={open.title} onClose={() => setOpen(null)}>
          <p className="muted" style={{ marginTop: 0 }}>{open.hint}</p>
          {open.items.map((cap) => {
            const on = ready(cap);
            return (
              <button className="cap-item" key={cap.id} onClick={() => start(cap)}>
                <span className="cap-item-icon">{cap.icon}</span>
                <span className="grow">
                  <b>{cap.title}</b>
                  <i>{cap.what}</i>
                  {!on && (
                    <em>
                      {cap.needs === 'gemini'
                        ? 'Gemini kaliti kerak'
                        : cap.needs === 'github'
                          ? 'GitHub tokeni kerak'
                          : 'Avval ilova ulash kerak'}
                    </em>
                  )}
                </span>
                <span className="cap-item-go">›</span>
              </button>
            );
          })}
        </Sheet>
      )}
    </>
  );
}
