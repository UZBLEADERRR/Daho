import { useEffect, useMemo, useState } from 'react';
import { setState, useStore } from '../../lib/store';
import type { TimeLog } from '../../lib/types';
import { fmtDuration, fmtTime, todayISO, uid } from '../../lib/utils';
import { Play, Stop, Trash } from '../Icons';
import { Empty } from '../ui';

export function TimeTracker() {
  const timeLogs = useStore((s) => s.timeLogs);
  const [label, setLabel] = useState('');
  const [now, setNow] = useState(Date.now());

  const running = timeLogs.find((l) => !l.end) ?? null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const start = () => {
    const log: TimeLog = {
      id: uid('w_'),
      label: label.trim() || 'Oʻqish',
      start: Date.now(),
    };
    setState((s) => ({ timeLogs: [log, ...s.timeLogs] }));
    setLabel('');
  };

  const stop = () => {
    if (!running) return;
    setState((s) => ({
      timeLogs: s.timeLogs.map((l) => (l.id === running.id ? { ...l, end: Date.now() } : l)),
    }));
  };

  const finished = useMemo(() => timeLogs.filter((l) => l.end), [timeLogs]);

  const stats = useMemo(() => {
    const today = todayISO();
    const weekStart = Date.now() - 7 * 86_400_000;
    let todayMs = 0;
    let weekMs = 0;
    for (const log of finished) {
      const dur = (log.end ?? 0) - log.start;
      if (todayISO(new Date(log.start)) === today) todayMs += dur;
      if (log.start >= weekStart) weekMs += dur;
    }
    return { todayMs, weekMs, count: finished.length };
  }, [finished]);

  const grouped = useMemo(() => {
    const map = new Map<string, TimeLog[]>();
    for (const log of finished) {
      const key = todayISO(new Date(log.start));
      map.set(key, [...(map.get(key) ?? []), log]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  }, [finished]);

  return (
    <div className="scroll">
      <div className="pad">
        <div className="stat-grid">
          <div className="stat">
            <b>{Math.round(stats.todayMs / 60000)}</b>
            <span>bugun, daqiqa</span>
          </div>
          <div className="stat">
            <b>{(stats.weekMs / 3_600_000).toFixed(1)}</b>
            <span>hafta, soat</span>
          </div>
          <div className="stat">
            <b>{stats.count}</b>
            <span>jami seans</span>
          </div>
        </div>

        <div className="card">
          {running ? (
            <>
              <div className="timer-big">{fmtDuration(now - running.start)}</div>
              <div className="muted" style={{ textAlign: 'center', marginBottom: 12 }}>
                {running.label}
              </div>
              <button className="btn wide" onClick={stop} style={{ background: 'var(--danger)' }}>
                <Stop size={15} /> Toʻxtatish
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label>Nima ustida ishlayapsiz?</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Matematik analiz — mustaqil ish"
                  onKeyDown={(e) => e.key === 'Enter' && start()}
                />
              </div>
              <button className="btn wide" onClick={start}>
                <Play size={15} /> Vaqtni boshlash
              </button>
            </>
          )}
        </div>

        <div className="section-label">Qaydlar</div>

        {grouped.length === 0 ? (
          <Empty title="Qayd yoʻq" hint="Taymerni ishga tushiring yoki chatda “bugun 2 soat fizika oʻqidim” deb yozing." />
        ) : (
          grouped.map(([date, logs]) => {
            const total = logs.reduce((sum, l) => sum + ((l.end ?? 0) - l.start), 0);
            return (
              <div className="day-block" key={date}>
                <div className="day-title">
                  {date === todayISO() ? 'Bugun' : date}
                  <span className="chip">{fmtDuration(total)}</span>
                </div>
                {logs.map((log) => (
                  <div className="list-item" key={log.id}>
                    <div className="grow">
                      <div style={{ fontSize: 14.5 }}>{log.label}</div>
                      <div className="tiny">
                        {fmtTime(log.start)} — {fmtTime(log.end ?? 0)}
                        {log.note ? ` · ${log.note}` : ''}
                      </div>
                    </div>
                    <div className="chip accent">
                      {fmtDuration((log.end ?? 0) - log.start)}
                    </div>
                    <button
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      onClick={() =>
                        setState((s) => ({
                          timeLogs: s.timeLogs.filter((l) => l.id !== log.id),
                        }))
                      }
                      aria-label="Oʻchirish"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
