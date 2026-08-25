import { useMemo, useState } from 'react';
import { Markdown } from '../Markdown';
import { setState, useStore } from '../../lib/store';
import type { Note } from '../../lib/types';
import { relativeTime, uid } from '../../lib/utils';
import { Plus, Trash } from '../Icons';
import { Empty, Sheet } from '../ui';

export function Notes() {
  const notes = useStore((s) => s.notes);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('hammasi');
  const [draft, setDraft] = useState<(Partial<Note> & { id?: string }) | null>(null);
  const [preview, setPreview] = useState<Note | null>(null);

  const subjects = useMemo(
    () => ['hammasi', ...new Set(notes.map((n) => n.subject).filter(Boolean))],
    [notes],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter(
      (n) =>
        (subject === 'hammasi' || n.subject === subject) &&
        (!q || (n.title + n.content).toLowerCase().includes(q)),
    );
  }, [notes, query, subject]);

  const save = () => {
    if (!draft?.title?.trim()) return;
    const now = Date.now();
    const note: Note = {
      id: draft.id ?? uid('n_'),
      title: draft.title.trim(),
      content: draft.content ?? '',
      subject: (draft.subject ?? '').trim() || 'Umumiy',
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    };
    setState((s) => ({
      notes: draft.id ? s.notes.map((n) => (n.id === draft.id ? note : n)) : [note, ...s.notes],
    }));
    setDraft(null);
  };

  const remove = (id: string) => {
    setState((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    setDraft(null);
    setPreview(null);
  };

  return (
    <div className="scroll">
      {subjects.length > 1 && (
        <div className="seg">
          {subjects.map((s) => (
            <button key={s} className={subject === s ? 'on' : ''} onClick={() => setSubject(s)}>
              {s === 'hammasi' ? 'Hammasi' : s}
            </button>
          ))}
        </div>
      )}

      <div className="pad">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Konspektlardan qidirish…"
          style={{ marginBottom: 10 }}
        />
        <button
          className="btn wide ghost"
          style={{ marginBottom: 12 }}
          onClick={() => setDraft({ title: '', content: '', subject: '' })}
        >
          <Plus size={16} /> Konspekt qoʻshish
        </button>

        {visible.length === 0 ? (
          <Empty
            title="Konspekt yoʻq"
            hint="Chatda mavzuni tushuntirtirib, “buni saqlab qoʻy” deng — agent konspekt qilib yozadi."
          />
        ) : (
          visible.map((note) => (
            <button
              className="card"
              key={note.id}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 9 }}
              onClick={() => setPreview(note)}
            >
              <div className="between">
                <div className="grow" style={{ fontSize: 15, fontWeight: 560 }}>
                  {note.title}
                </div>
                <span className="chip">{note.subject}</span>
              </div>
              <div
                className="muted"
                style={{
                  marginTop: 4,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {note.content.replace(/[#*`>_]/g, '').slice(0, 160)}
              </div>
              <div className="tiny" style={{ marginTop: 6 }}>
                {relativeTime(note.updatedAt)}
              </div>
            </button>
          ))
        )}
      </div>

      {preview && (
        <Sheet title={preview.title} onClose={() => setPreview(null)}>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="chip accent">{preview.subject}</span>
            <span className="tiny">{relativeTime(preview.updatedAt)}</span>
          </div>
          <Markdown text={preview.content} />
          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="btn ghost"
              onClick={() => {
                setDraft({ ...preview });
                setPreview(null);
              }}
            >
              Tahrirlash
            </button>
            <button
              className="btn ghost grow"
              style={{ color: 'var(--danger)' }}
              onClick={() => remove(preview.id)}
            >
              <Trash size={15} /> Oʻchirish
            </button>
          </div>
        </Sheet>
      )}

      {draft && (
        <Sheet title={draft.id ? 'Konspektni tahrirlash' : 'Yangi konspekt'} onClose={() => setDraft(null)}>
          <div className="field">
            <label>Sarlavha</label>
            <input
              autoFocus
              value={draft.title ?? ''}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Fan</label>
            <input
              value={draft.subject ?? ''}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Umumiy"
              list="daho-subjects"
            />
            <datalist id="daho-subjects">
              {subjects
                .filter((s) => s !== 'hammasi')
                .map((s) => (
                  <option key={s} value={s} />
                ))}
            </datalist>
          </div>
          <div className="field">
            <label>Matn (markdown)</label>
            <textarea
              style={{ minHeight: 200 }}
              value={draft.content ?? ''}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </div>
          <button className="btn wide" onClick={save} disabled={!draft.title?.trim()}>
            Saqlash
          </button>
        </Sheet>
      )}
    </div>
  );
}
