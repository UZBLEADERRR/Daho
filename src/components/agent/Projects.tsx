import { useState } from 'react';
import { setState, useStore } from '../../lib/store';
import type { Project } from '../../lib/types';
import { uid } from '../../lib/utils';
import { Check, Plus, Trash } from '../Icons';
import { Empty, Sheet } from '../ui';

const STATUS_LABEL: Record<Project['status'], string> = {
  reja: 'Reja',
  jarayonda: 'Jarayonda',
  tugallandi: 'Tugallandi',
};

export function Projects() {
  const projects = useStore((s) => s.projects);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; description: string } | null>(null);
  const [stepText, setStepText] = useState('');

  const open = projects.find((p) => p.id === openId) ?? null;

  const patch = (id: string, fn: (p: Project) => Project) =>
    setState((s) => ({ projects: s.projects.map((p) => (p.id === id ? fn(p) : p)) }));

  const create = () => {
    if (!draft?.name.trim()) return;
    const project: Project = {
      id: uid('p_'),
      name: draft.name.trim(),
      description: draft.description.trim(),
      status: 'reja',
      steps: [],
      createdAt: Date.now(),
    };
    setState((s) => ({ projects: [project, ...s.projects] }));
    setDraft(null);
    setOpenId(project.id);
  };

  const addStep = () => {
    if (!open || !stepText.trim()) return;
    patch(open.id, (p) => ({
      ...p,
      steps: [...p.steps, { id: uid('st_'), title: stepText.trim(), done: false }],
    }));
    setStepText('');
  };

  return (
    <div className="scroll">
      <div className="pad">
        <button
          className="btn wide ghost"
          style={{ marginBottom: 12 }}
          onClick={() => setDraft({ name: '', description: '' })}
        >
          <Plus size={16} /> Yangi loyiha
        </button>

        {projects.length === 0 ? (
          <Empty
            title="Loyiha yoʻq"
            hint="Chatda “kurs ishim uchun reja tuz” deb yozing — agent bosqichlari bilan loyiha yaratadi."
          />
        ) : (
          projects.map((p) => {
            const done = p.steps.filter((s) => s.done).length;
            const pct = p.steps.length ? Math.round((done / p.steps.length) * 100) : 0;
            return (
              <button
                className="card"
                key={p.id}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 9 }}
                onClick={() => setOpenId(p.id)}
              >
                <div className="between">
                  <div className="grow" style={{ fontSize: 15, fontWeight: 570 }}>
                    {p.name}
                  </div>
                  <span className="chip">{STATUS_LABEL[p.status]}</span>
                </div>
                {p.description && (
                  <div className="muted" style={{ marginTop: 4 }}>
                    {p.description}
                  </div>
                )}
                {p.steps.length > 0 && (
                  <>
                    <div className="progress">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <div className="tiny" style={{ marginTop: 6 }}>
                      {done} / {p.steps.length} bosqich · {pct}%
                    </div>
                  </>
                )}
              </button>
            );
          })
        )}
      </div>

      {draft && (
        <Sheet title="Yangi loyiha" onClose={() => setDraft(null)}>
          <div className="field">
            <label>Nomi</label>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Kurs ishi: neyron tarmoqlar"
            />
          </div>
          <div className="field">
            <label>Tavsif</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Maqsad, topshirish muddati…"
            />
          </div>
          <button className="btn wide" onClick={create} disabled={!draft.name.trim()}>
            Yaratish
          </button>
        </Sheet>
      )}

      {open && (
        <Sheet title={open.name} onClose={() => setOpenId(null)}>
          {open.description && <p className="muted">{open.description}</p>}

          <div className="field">
            <label>Holat</label>
            <select
              value={open.status}
              onChange={(e) =>
                patch(open.id, (p) => ({ ...p, status: e.target.value as Project['status'] }))
              }
            >
              <option value="reja">Reja</option>
              <option value="jarayonda">Jarayonda</option>
              <option value="tugallandi">Tugallandi</option>
            </select>
          </div>

          <div className="section-label" style={{ padding: '6px 0' }}>
            Bosqichlar
          </div>
          {open.steps.map((step) => (
            <div className="list-item" key={step.id}>
              <button
                className={step.done ? 'check on' : 'check'}
                onClick={() =>
                  patch(open.id, (p) => ({
                    ...p,
                    steps: p.steps.map((s) =>
                      s.id === step.id ? { ...s, done: !s.done } : s,
                    ),
                  }))
                }
                aria-label="Belgilash"
              >
                <Check size={13} />
              </button>
              <div className={step.done ? 'grow done-text' : 'grow'} style={{ fontSize: 14 }}>
                {step.title}
              </div>
              <button
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={() =>
                  patch(open.id, (p) => ({
                    ...p,
                    steps: p.steps.filter((s) => s.id !== step.id),
                  }))
                }
                aria-label="Oʻchirish"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}

          <div className="row" style={{ marginTop: 4 }}>
            <input
              className="grow"
              value={stepText}
              placeholder="Yangi bosqich…"
              onChange={(e) => setStepText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStep()}
            />
            <button className="btn mini" onClick={addStep}>
              <Plus size={15} />
            </button>
          </div>

          <button
            className="btn wide ghost"
            style={{ marginTop: 14, color: 'var(--danger)' }}
            onClick={() => {
              setState((s) => ({ projects: s.projects.filter((p) => p.id !== open.id) }));
              setOpenId(null);
            }}
          >
            <Trash size={15} /> Loyihani oʻchirish
          </button>
        </Sheet>
      )}
    </div>
  );
}
