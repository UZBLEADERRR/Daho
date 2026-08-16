import { useState } from 'react';
import { deleteApp, updateApp } from '../../lib/creations';
import { saveArtifact } from '../../lib/exporter';
import { useStore } from '../../lib/store';
import type { MiniApp } from '../../lib/types';
import { relativeTime, uid } from '../../lib/utils';
import { Back, Download, Refresh, Trash } from '../Icons';
import { Empty, Sheet, toast } from '../ui';

const ICONS = ['🧮', '📊', '🎯', '📝', '🎲', '⏱', '💡', '🔤', '🧠', '📚', '🎨', '🔬', '💰', '🗂', '🏆', '⚡'];

export function Apps() {
  const apps = useStore((s) => s.apps);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<MiniApp | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const running = apps.find((a) => a.id === open);

  const launch = (app: MiniApp) => {
    updateApp(app.id, { opens: app.opens + 1 });
    setOpen(app.id);
  };

  if (running) {
    return (
      <div className="viewer">
        <div className="viewer-head">
          <button className="icon-btn" onClick={() => setOpen(null)} aria-label="Orqaga">
            <Back />
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="artifact-title">
              {running.icon} {running.name}
            </div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="Qayta yuklash"
          >
            <Refresh />
          </button>
        </div>
        <div className="viewer-body">
          <iframe
            key={reloadKey}
            title={running.name}
            srcDoc={running.html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="scroll">
      <div className="pad">
        {apps.length === 0 ? (
          <Empty
            title="Ilova yoʻq"
            hint="Chatda + tugmasidan «Ilova yasash» ni tanlang — AI yasagan ilova shu yerga tushadi va telefoningizda ishlaydi."
          />
        ) : (
          <div className="app-grid">
            {apps.map((app) => (
              <div className="app-tile" key={app.id}>
                <button className="app-open" onClick={() => launch(app)}>
                  <span className="app-icon">{app.icon}</span>
                  <span className="app-name">{app.name}</span>
                </button>
                <button
                  className="app-edit"
                  onClick={() => setEdit(app)}
                  aria-label="Sozlash"
                >
                  ⋯
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {edit && (
        <Sheet title="Ilova sozlamalari" onClose={() => setEdit(null)}>
          <div className="field">
            <label>Nomi</label>
            <input
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Ikonka</label>
            <div className="icon-picker">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  className={edit.icon === icon ? 'on' : ''}
                  onClick={() => setEdit({ ...edit, icon })}
                >
                  {icon}
                </button>
              ))}
            </div>
            <input
              value={edit.icon}
              onChange={(e) => setEdit({ ...edit, icon: e.target.value.slice(0, 4) })}
              placeholder="yoki oʻzingiz yozing"
              style={{ marginTop: 8 }}
            />
          </div>
          <div className="field">
            <label>Tavsif</label>
            <input
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </div>
          <div className="tiny" style={{ marginBottom: 12 }}>
            {relativeTime(edit.createdAt)} · {edit.opens} marta ochilgan
          </div>

          <button
            className="btn wide"
            onClick={() => {
              updateApp(edit.id, {
                name: edit.name.trim() || 'Ilova',
                icon: edit.icon || '🧩',
                description: edit.description,
              });
              setEdit(null);
              toast('Saqlandi');
            }}
          >
            Saqlash
          </button>

          <button
            className="btn ghost wide"
            style={{ marginTop: 8 }}
            onClick={async () => {
              try {
                toast(
                  await saveArtifact({
                    id: uid('a_'),
                    kind: 'html',
                    title: edit.name,
                    content: edit.html,
                    lang: 'html',
                    createdAt: Date.now(),
                  }),
                );
              } catch (err) {
                toast(`Xato: ${(err as Error).message}`);
              }
            }}
          >
            <Download size={15} /> HTML faylni saqlash
          </button>

          <button
            className="btn ghost wide"
            style={{ marginTop: 8, color: 'var(--danger)' }}
            onClick={() => {
              if (window.confirm(`"${edit.name}" oʻchirilsinmi?`)) {
                deleteApp(edit.id);
                setEdit(null);
              }
            }}
          >
            <Trash size={15} /> Oʻchirish
          </button>
        </Sheet>
      )}
    </div>
  );
}
