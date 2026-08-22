/**
 * Jonli jarayon — «hozir nima qilinyapti».
 *
 * Avval faqat nuqtalar aylanardi va foydalanuvchi ilova qotib
 * qolganmi yoki ishlayaptimi bilmasdi. Endi har qadam koʻrinadi:
 * qidiruv, oʻqish, yozish, vosita chaqiruvi. Bajarilgani soʻnib
 * qoladi, joriysi puls bilan turadi.
 */
import { useEffect, useState } from 'react';
import type { RunningTask } from '../lib/tasks';

function soniya(from: number): number {
  return Math.max(0, Math.round((Date.now() - from) / 1000));
}

export function ProcessTrail({ task }: { task: RunningTask }) {
  const [, tick] = useState(0);

  // Vaqt hisoblagichi yursin.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const oʻtgan = soniya(task.startedAt);
  const qadamda = soniya(task.stepAt);

  return (
    <div className="process" role="status" aria-live="polite">
      {task.steps.map((step, i) => (
        <div className="process-past" key={`${step}-${i}`}>
          <span className="process-tick">✓</span>
          {step}
        </div>
      ))}

      <div className="process-now">
        <span className="process-dot" />
        <span className="process-text">{task.note || 'oʻylayapti'}</span>
        {qadamda >= 3 && <span className="process-time">{qadamda}s</span>}
      </div>

      {oʻtgan >= 12 && (
        <div className="process-total">
          jami {oʻtgan >= 60 ? `${Math.floor(oʻtgan / 60)}m ${oʻtgan % 60}s` : `${oʻtgan}s`} · toʻxtatish uchun ⏹
        </div>
      )}
    </div>
  );
}
